import { logger } from "~src/core/logging/logger"
import type {
  BridgeAction,
  BridgeApiPaths,
  BridgeMode,
  RuntimeActionResponse,
  RuntimeBatchWorkerRequest
} from "~src/core/messages/contracts"
import {
  normalizeBatchId,
  normalizeWorkerId,
  toActionMode
} from "~src/core/messages/guards"
import type { PowermaxxSettings } from "~src/core/settings/schema"
import { executeFetchOnlyByOrder } from "~src/features/fetch-send/background/run-fetch-send"
import { sendBridgeWorkerEvent } from "~src/features/bridge/background/bridge-events"
import {
  computeIdleBackoffMs,
  computeRetryBackoffMs,
  isRetryablePollStatus,
  selectResumableBatchStates
} from "~src/features/worker/background/worker-loop-core"

const SESSION_STORAGE_KEY = "powermaxx_batch_worker_sessions_v1"
const REPORTED_STORAGE_KEY = "powermaxx_batch_worker_reported_jobs_v1"
const EXTENSION_VERSION = chrome.runtime.getManifest().version || ""
const ACTIVE_SESSION_STALE_MS = 45000
const MAX_MARKETPLACE_TRANSIENT_RETRY = 2
const TIKTOK_RETRYABLE_ORDER_CODES = new Set([21001001])

type BatchWorkerStopReason =
  | "batch_terminal"
  | "user_stop"
  | "fatal_config"
  | "unrecoverable_auth"
  | "unrecoverable_error"

interface PersistedBatchWorkerSession {
  key: string
  batch_id: string
  worker_id: number
  action: BridgeAction
  mode: BridgeMode
  active: boolean
  last_poll: number | null
  last_error: string | null
  stop_reason: BatchWorkerStopReason | null
  source_tab_id: number | null
  api_paths: BridgeApiPaths
}

interface BatchWorkerSession {
  key: string
  batchId: string
  workerId: number
  action: BridgeAction
  mode: BridgeMode
  sourceTabId: number | null
  apiPaths: Required<BridgeApiPaths>
  settings: PowermaxxSettings
  stopRequested: boolean
  stopReason: BatchWorkerStopReason | null
  lastPoll: number | null
  lastError: string | null
  reportedJobKeys: Set<string>
}

interface BatchJobClaim {
  id: number
  action: BridgeAction
  marketplace: "shopee" | "tiktok_shop"
  identifier: string
  identifierType: "mp_order_id" | "mp_order_sn"
  attemptNo: number
}

const activeWorkerByBatchId = new Map<string, string>()
const activeSessionsByKey = new Map<string, BatchWorkerSession>()

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

const readJsonBody = async (response: Response) => {
  const text = await response.text()

  if (!text) return null

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch (_error) {
    return null
  }
}

const isUnauthenticated = (status: number, data: Record<string, unknown> | null) => {
  if ([401, 403, 419].includes(status)) return true
  const message = String((data?.message as string) || "").toLowerCase()
  return message.includes("unauthenticated")
}

const defaultApiPaths = (): Required<BridgeApiPaths> => ({
  request: "/api/mp-update/request/{batchId}",
  result: "/api/mp-update/result/{batchId}"
})

const normalizeApiPaths = (
  paths: BridgeApiPaths | undefined | null
): Required<BridgeApiPaths> => {
  const defaults = defaultApiPaths()

  const requestPath =
    typeof paths?.request === "string" && paths.request.trim()
      ? paths.request.trim()
      : defaults.request
  const resultPath =
    typeof paths?.result === "string" && paths.result.trim()
      ? paths.result.trim()
      : defaults.result

  return {
    request: requestPath,
    result: resultPath
  }
}

const buildWorkerUrl = (
  baseUrl: string,
  path: string,
  replacements: Record<string, string>
) => {
  let output = path

  Object.entries(replacements).forEach(([key, value]) => {
    output = output.replace(new RegExp(`\\{${key}\\}`, "g"), encodeURIComponent(value))
  })

  return `${baseUrl.replace(/\/+$/, "")}${output.startsWith("/") ? "" : "/"}${output}`
}

const loadPersistedSessions = async (): Promise<PersistedBatchWorkerSession[]> => {
  const storage = await chrome.storage.local.get([SESSION_STORAGE_KEY])
  const raw = storage?.[SESSION_STORAGE_KEY]
  if (!Array.isArray(raw)) return []

  return raw
    .filter((entry) => Boolean(entry) && typeof entry === "object")
    .map((entry) => entry as PersistedBatchWorkerSession)
}

const savePersistedSessions = async (sessions: PersistedBatchWorkerSession[]) => {
  await chrome.storage.local.set({
    [SESSION_STORAGE_KEY]: sessions
  })
}

const upsertPersistedSession = async (session: BatchWorkerSession) => {
  const existing = await loadPersistedSessions()
  const next: PersistedBatchWorkerSession = {
    key: session.key,
    batch_id: session.batchId,
    worker_id: session.workerId,
    action: session.action,
    mode: session.mode,
    active: !session.stopReason && !session.stopRequested,
    last_poll: session.lastPoll,
    last_error: session.lastError,
    stop_reason: session.stopReason,
    source_tab_id: session.sourceTabId,
    api_paths: session.apiPaths
  }

  const updated = existing.filter((entry) => entry.key !== session.key)
  updated.push(next)

  await savePersistedSessions(updated)
}

const removePersistedSession = async (key: string) => {
  const existing = await loadPersistedSessions()
  await savePersistedSessions(existing.filter((entry) => entry.key !== key))
}

const loadPersistedReportedKeys = async (batchId: string): Promise<Set<string>> => {
  const storage = await chrome.storage.local.get([REPORTED_STORAGE_KEY])
  const raw = storage?.[REPORTED_STORAGE_KEY]

  if (!raw || typeof raw !== "object") {
    return new Set<string>()
  }

  const record = raw as Record<string, unknown>
  const list = record[batchId]

  if (!Array.isArray(list)) {
    return new Set<string>()
  }

  return new Set<string>(list.map(String))
}

const savePersistedReportedKeys = async (
  batchId: string,
  keys: Set<string>
) => {
  const storage = await chrome.storage.local.get([REPORTED_STORAGE_KEY])
  const raw = storage?.[REPORTED_STORAGE_KEY]
  const record: Record<string, unknown> =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}

  record[batchId] = Array.from(keys.values()).slice(-200)

  await chrome.storage.local.set({
    [REPORTED_STORAGE_KEY]: record
  })
}

const logWorker = (
  level: "info" | "warn" | "error",
  step: string,
  session: BatchWorkerSession,
  extra: Record<string, unknown> = {}
) => {
  const payload = {
    feature: "worker",
    domain: "batch",
    step,
    batch_id: session.batchId,
    worker_id: session.workerId,
    ...extra
  }

  if (level === "warn") {
    logger.warn(step, payload)
    return
  }

  if (level === "error") {
    logger.error(step, payload)
    return
  }

  logger.info(step, payload)
}

const errorMessage = (error: unknown, fallback: string) => {
  const raw = String((error as Error)?.message || error || "").trim()
  return raw || fallback
}

const resolveOrderMeta = (
  fetchResult: Awaited<ReturnType<typeof executeFetchOnlyByOrder>> | null
) => {
  const empty = { appCode: null as number | null, appMessage: "" }

  const fetchMeta =
    fetchResult &&
    fetchResult.fetchResult &&
    fetchResult.fetchResult.fetchMeta &&
    typeof fetchResult.fetchResult.fetchMeta === "object"
      ? (fetchResult.fetchResult.fetchMeta as Record<string, unknown>)
      : null

  if (!fetchMeta) {
    return empty
  }

  const orderMeta =
    fetchMeta.order && typeof fetchMeta.order === "object"
      ? (fetchMeta.order as Record<string, unknown>)
      : null

  if (!orderMeta) {
    return empty
  }

  const appCodeRaw = Number(orderMeta.appCode)
  const appCode =
    Number.isFinite(appCodeRaw) && appCodeRaw > 0 ? Math.trunc(appCodeRaw) : null
  const appMessage = String(orderMeta.appMessage || "").trim()

  return { appCode, appMessage }
}

const shouldRetryTransientMarketplaceError = (
  claim: BatchJobClaim,
  fetchResult: Awaited<ReturnType<typeof executeFetchOnlyByOrder>> | null,
  technicalError: string | null
) => {
  if (technicalError || claim.marketplace !== "tiktok_shop" || fetchResult?.ok) {
    return { shouldRetry: false, appCode: null as number | null, reason: "" }
  }

  const orderMeta = resolveOrderMeta(fetchResult)
  const appCode = orderMeta.appCode

  if (appCode && TIKTOK_RETRYABLE_ORDER_CODES.has(appCode)) {
    return {
      shouldRetry: true,
      appCode,
      reason: orderMeta.appMessage || "System error, please retry"
    }
  }

  const message = String(fetchResult?.error || "").toLowerCase()
  if (message.includes("system error") && message.includes("retry")) {
    return {
      shouldRetry: true,
      appCode,
      reason: fetchResult?.error || "System error, please retry"
    }
  }

  return { shouldRetry: false, appCode, reason: "" }
}

const buildFetchFailureMessage = (
  fetchResult: Awaited<ReturnType<typeof executeFetchOnlyByOrder>> | null,
  technicalError: string | null
) => {
  if (technicalError) {
    return technicalError
  }

  const explicit = String(fetchResult?.error || "").trim()
  if (explicit && explicit !== "Fetch marketplace gagal.") {
    return explicit
  }

  const orderMeta = resolveOrderMeta(fetchResult)
  if (orderMeta.appCode) {
    const suffix = orderMeta.appMessage ? `: ${orderMeta.appMessage}` : ""
    return `Marketplace order API error (code ${orderMeta.appCode})${suffix}`
  }

  return explicit || "Fetch marketplace gagal."
}

const isActiveSessionStale = (session: BatchWorkerSession) => {
  if (session.stopRequested || session.stopReason) {
    return true
  }

  if (!session.lastPoll) {
    return false
  }

  return Date.now() - session.lastPoll > ACTIVE_SESSION_STALE_MS
}

const parseJobClaim = (data: Record<string, unknown> | null): BatchJobClaim | null => {
  const rawJob = data?.job
  if (!rawJob || typeof rawJob !== "object" || Array.isArray(rawJob)) {
    return null
  }

  const job = rawJob as Record<string, unknown>
  const id = Number(job.id || job.job_id || job.jobId)
  const action = String(job.action || "").trim() as BridgeAction
  const marketplace = String(job.marketplace || "").trim() as "shopee" | "tiktok_shop"
  const identifier = String(job.identifier || "").trim()
  const identifierType = String(job.identifier_type || job.identifierType || "").trim() as
    | "mp_order_id"
    | "mp_order_sn"
  const attemptNo = Number(job.attempt_no || job.attemptNo || 0)

  if (!Number.isFinite(id) || id <= 0) return null
  if (!["update_order", "update_income", "update_both"].includes(action)) return null
  if (!["shopee", "tiktok_shop"].includes(marketplace)) return null
  if (!identifier) return null

  return {
    id: Math.trunc(id),
    action,
    marketplace,
    identifier,
    identifierType:
      identifierType === "mp_order_sn" ? "mp_order_sn" : "mp_order_id",
    attemptNo: Number.isFinite(attemptNo) ? Math.max(0, Math.trunc(attemptNo)) : 0
  }
}

const requestNextJob = async (session: BatchWorkerSession, pollAttempt: number) => {
  const token = session.settings.auth.token || ""
  const baseUrl = session.settings.auth.baseUrl || ""

  if (!token || !baseUrl) {
    return {
      type: "fatal_error" as const,
      stopReason: "fatal_config" as const,
      status: 0,
      message: !token
        ? "Sesi login belum tersedia."
        : "Base URL belum tersedia."
    }
  }

  const url = buildWorkerUrl(baseUrl, session.apiPaths.request, {
    batchId: session.batchId
  })

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        worker_id: session.workerId,
        workerId: session.workerId,
        poll_attempt: pollAttempt,
        pollAttempt,
        extension_version: EXTENSION_VERSION
      })
    })

    const data = await readJsonBody(response)

    if (!response.ok) {
      if (isUnauthenticated(response.status, data)) {
        return {
          type: "fatal_error" as const,
          stopReason: "unrecoverable_auth" as const,
          status: response.status,
          message: "Sesi login tidak valid atau kadaluarsa."
        }
      }

      if (isRetryablePollStatus(response.status)) {
        return {
          type: "retryable_error" as const,
          status: response.status,
          message:
            String((data?.message as string) || "") ||
            `Request endpoint gagal (${response.status}).`,
          retryDelayMs: Number(
            data?.retry_delay_ms || data?.retryDelayMs || data?.poll_delay_ms || data?.pollDelayMs || 0
          )
        }
      }

      return {
        type: "fatal_error" as const,
        stopReason: "unrecoverable_error" as const,
        status: response.status,
        message:
          String((data?.message as string) || "") ||
          `Request endpoint gagal (${response.status}).`
      }
    }

    const done = Boolean(data?.done)
    const empty = Boolean(data?.empty)
    const pollDelayMs = Number(data?.poll_delay_ms || data?.pollDelayMs || 0)

    if (done) {
      return {
        type: "empty" as const,
        terminal: true,
        stopReason: "batch_terminal" as const,
        delayMs: 0
      }
    }

    const claim = parseJobClaim(data)

    if (!claim || empty) {
      return {
        type: "empty" as const,
        terminal: false,
        delayMs: Number.isFinite(pollDelayMs) ? Math.max(0, Math.trunc(pollDelayMs)) : null
      }
    }

    return {
      type: "claimed" as const,
      claim
    }
  } catch (error) {
    return {
      type: "retryable_error" as const,
      status: 0,
      message: String((error as Error)?.message || error),
      retryDelayMs: null
    }
  }
}

const submitJobResult = async (
  session: BatchWorkerSession,
  claim: BatchJobClaim,
  payload: Record<string, unknown>
) => {
  const dedupeKey = `${session.batchId}:${claim.id}:${claim.attemptNo}:${String(payload.status || "")}`

  if (session.reportedJobKeys.has(dedupeKey)) {
    return {
      ok: true,
      skipped: true,
      status: 200,
      data: null as Record<string, unknown> | null
    }
  }

  const token = session.settings.auth.token || ""
  const baseUrl = session.settings.auth.baseUrl || ""

  if (!token || !baseUrl) {
    return {
      ok: false,
      skipped: false,
      status: 0,
      fatal: true,
      stopReason: "fatal_config" as const,
      message: !token
        ? "Sesi login belum tersedia."
        : "Base URL belum tersedia."
    }
  }

  const url = buildWorkerUrl(baseUrl, session.apiPaths.result, {
    batchId: session.batchId
  })

  let retryAttempt = 0

  while (retryAttempt < 5) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      })

      const data = await readJsonBody(response)

      if (response.ok) {
        session.reportedJobKeys.add(dedupeKey)
        await savePersistedReportedKeys(session.batchId, session.reportedJobKeys)

        return {
          ok: true,
          skipped: false,
          status: response.status,
          data
        }
      }

      if (isUnauthenticated(response.status, data)) {
        return {
          ok: false,
          skipped: false,
          status: response.status,
          fatal: true,
          stopReason: "unrecoverable_auth" as const,
          message: "Sesi login tidak valid atau kadaluarsa."
        }
      }

      if (isRetryablePollStatus(response.status)) {
        retryAttempt += 1
        const computedDelay = computeRetryBackoffMs(retryAttempt, Math.random)
        const controlDelay = Number(data?.retry_delay_ms || data?.retryDelayMs || 0)
        const delayMs =
          Number.isFinite(controlDelay) && controlDelay > 0
            ? Math.max(Math.trunc(controlDelay), computedDelay)
            : computedDelay

        logWorker("warn", "worker.poll.retry", session, {
          reason: "result_endpoint_retryable",
          status: response.status,
          retry_attempt: retryAttempt,
          delay_ms: delayMs
        })

        await sleep(delayMs)
        continue
      }

      return {
        ok: false,
        skipped: false,
        status: response.status,
        fatal: false,
        message:
          String((data?.message as string) || "") ||
          `Result endpoint gagal (${response.status}).`
      }
    } catch (error) {
      retryAttempt += 1
      const delayMs = computeRetryBackoffMs(retryAttempt, Math.random)

      logWorker("warn", "worker.poll.retry", session, {
        reason: "result_endpoint_network",
        retry_attempt: retryAttempt,
        delay_ms: delayMs,
        error: String((error as Error)?.message || error)
      })

      await sleep(delayMs)
    }
  }

  return {
    ok: false,
    skipped: false,
    status: 0,
    fatal: false,
    message: "Result endpoint gagal setelah beberapa percobaan."
  }
}

const processJob = async (session: BatchWorkerSession, claim: BatchJobClaim) => {
  const startedAt = Date.now()

  await sendBridgeWorkerEvent(session.sourceTabId, "batch.job.start", {
    batch_id: session.batchId,
    worker_id: session.workerId,
    job_id: claim.id,
    attempt_no: claim.attemptNo,
    marketplace: claim.marketplace,
    identifier: claim.identifier
  })

  const actionMode = toActionMode(claim.action)
  const orderIdType = claim.identifierType === "mp_order_sn" ? "order_sn" : "order_id"
  let fetchResult: Awaited<ReturnType<typeof executeFetchOnlyByOrder>> | null =
    null
  let technicalError: string | null = null
  let transientFetchRetryAttempt = 0
  let lastTransientAppCode: number | null = null

  while (true) {
    try {
      fetchResult = await executeFetchOnlyByOrder({
        order: {
          id: claim.identifier,
          marketplace: claim.marketplace,
          idType: orderIdType
        },
        actionMode,
        settings: session.settings
      })
      technicalError = null
    } catch (error) {
      technicalError = errorMessage(
        error,
        "Fetch marketplace gagal karena error internal extension."
      )

      logWorker("error", "worker.job.fetch_exception", session, {
        job_id: claim.id,
        attempt_no: claim.attemptNo,
        error: technicalError
      })
    }

    const transientRetry = shouldRetryTransientMarketplaceError(
      claim,
      fetchResult,
      technicalError
    )

    if (
      !transientRetry.shouldRetry ||
      transientFetchRetryAttempt >= MAX_MARKETPLACE_TRANSIENT_RETRY
    ) {
      break
    }

    transientFetchRetryAttempt += 1
    lastTransientAppCode = transientRetry.appCode

    const retryDelayMs = computeRetryBackoffMs(transientFetchRetryAttempt, Math.random, {
      baseMs: 1500,
      maxMs: 10000
    })

    logWorker("warn", "worker.poll.retry", session, {
      reason: "marketplace_order_transient",
      job_id: claim.id,
      attempt_no: claim.attemptNo,
      app_code: transientRetry.appCode,
      app_message: transientRetry.reason,
      retry_attempt: transientFetchRetryAttempt,
      delay_ms: retryDelayMs
    })

    await sleep(retryDelayMs)
  }

  const failureMessage = buildFetchFailureMessage(fetchResult, technicalError)

  const payload: Record<string, unknown> = {
    worker_id: session.workerId,
    workerId: session.workerId,
    job_id: claim.id,
    jobId: claim.id,
    attempt_no: claim.attemptNo,
    attemptNo: claim.attemptNo,
    status: fetchResult?.ok ? "success" : "failed",
    error_code: fetchResult?.ok ? null : "fetch_failed",
    error_message: fetchResult?.ok
      ? null
      : failureMessage,
    technical_error: technicalError,
    result: {
      marketplace: claim.marketplace,
      identifier: claim.identifier,
      identifier_type: claim.identifierType,
      order_raw_json: fetchResult?.fetchResult?.orderRawJson || null,
      income_raw_json: fetchResult?.fetchResult?.incomeRawJson || null,
      income_detail_raw_json: fetchResult?.fetchResult?.incomeDetailRawJson || null,
      fetch_meta: fetchResult?.fetchResult?.fetchMeta || {},
      open_url: fetchResult?.openUrl || null
    },
    meta: {
      duration_ms: Date.now() - startedAt,
      action_mode: actionMode,
      transient_fetch_retry_attempt: transientFetchRetryAttempt,
      transient_fetch_last_app_code: lastTransientAppCode
    }
  }

  const resultResponse = await submitJobResult(session, claim, payload)
  const resultData =
    resultResponse.data && typeof resultResponse.data === "object"
      ? (resultResponse.data as Record<string, unknown>)
      : null
  const acceptedDuplicate = Boolean(resultData?.accepted_duplicate)
  const duplicateReason = String(resultData?.duplicate_reason || "").trim()
  const isStaleDuplicate =
    acceptedDuplicate &&
    ["worker_mismatch", "attempt_mismatch", "job_not_processing"].includes(
      duplicateReason
    )

  if (!resultResponse.ok && resultResponse.fatal === true) {
    session.stopRequested = true
    session.stopReason = resultResponse.stopReason || "unrecoverable_error"
    session.lastError = resultResponse.message || "Result endpoint fatal error."
  } else if (!resultResponse.ok) {
    session.lastError =
      resultResponse.message || String(payload.error_message || "Result endpoint failed.")
  } else if (isStaleDuplicate) {
    session.lastError = null
    logWorker("info", "worker.result.duplicate_ignored", session, {
      job_id: claim.id,
      attempt_no: claim.attemptNo,
      duplicate_reason: duplicateReason
    })
  } else if (payload.status !== "success") {
    session.lastError = String(payload.error_message || "Fetch marketplace gagal.")
  } else {
    session.lastError = null
  }

  await sendBridgeWorkerEvent(session.sourceTabId, "batch.job.finish", {
    batch_id: session.batchId,
    worker_id: session.workerId,
    job_id: claim.id,
    success: payload.status === "success",
    status: payload.status,
    error_message: payload.error_message,
    duration_ms: Date.now() - startedAt,
    result_ok: resultResponse.ok
  })
}

const buildSession = async (args: {
  message: RuntimeBatchWorkerRequest
  senderTabId?: number | null
  settings: PowermaxxSettings
}): Promise<BatchWorkerSession | null> => {
  const batchId = normalizeBatchId(args.message.batchId || args.message.batch_id)

  if (!batchId) {
    return null
  }

  const workerId = normalizeWorkerId(
    args.message.workerId || args.message.worker_id,
    args.senderTabId || null
  )
  const key = `${batchId}:${workerId}`

  const action = args.message.action
  const mode = args.message.mode

  const reportedJobKeys = await loadPersistedReportedKeys(batchId)

  return {
    key,
    batchId,
    workerId,
    action,
    mode,
    sourceTabId: args.senderTabId || null,
    apiPaths: normalizeApiPaths(args.message.apiPaths || args.message.api_paths),
    settings: args.settings,
    stopRequested: false,
    stopReason: null,
    lastPoll: null,
    lastError: null,
    reportedJobKeys
  }
}

const runBatchWorkerLoop = async (session: BatchWorkerSession) => {
  logWorker("info", "worker.loop.start", session, {
    request_path: session.apiPaths.request,
    result_path: session.apiPaths.result,
    mode: session.mode,
    action: session.action
  })

  await sendBridgeWorkerEvent(session.sourceTabId, "batch.started", {
    batch_id: session.batchId,
    worker_id: session.workerId,
    mode: session.mode,
    action: session.action
  })

  let emptyAttempt = 0
  let retryAttempt = 0
  try {
    while (!session.stopRequested) {
      session.lastPoll = Date.now()
      await upsertPersistedSession(session)

      const signal = await requestNextJob(session, emptyAttempt + 1)

      if (signal.type === "claimed") {
        emptyAttempt = 0
        retryAttempt = 0
        session.lastError = null

        await processJob(session, signal.claim)
        await upsertPersistedSession(session)
        continue
      }

      if (signal.type === "empty") {
        retryAttempt = 0

        if (signal.terminal) {
          session.stopReason = signal.stopReason || "batch_terminal"
          break
        }

        emptyAttempt += 1
        const controlDelay = Number(signal.delayMs)
        const delayMs =
          Number.isFinite(controlDelay) && controlDelay >= 0
            ? Math.trunc(controlDelay)
            : computeIdleBackoffMs(emptyAttempt, { minMs: 1000, maxMs: 5000 })

        logWorker("info", "worker.claim.empty", session, {
          empty_attempt: emptyAttempt,
          delay_ms: delayMs
        })

        await sleep(delayMs)
        continue
      }

      if (signal.type === "retryable_error") {
        retryAttempt += 1
        const computedDelay = computeRetryBackoffMs(retryAttempt, Math.random)
        const controlDelay = Number(signal.retryDelayMs)
        const delayMs =
          Number.isFinite(controlDelay) && controlDelay > 0
            ? Math.max(Math.trunc(controlDelay), computedDelay)
            : computedDelay

        session.lastError = signal.message

        logWorker("warn", "worker.poll.retry", session, {
          retry_attempt: retryAttempt,
          delay_ms: delayMs,
          status: signal.status,
          error: signal.message
        })

        await sleep(delayMs)
        continue
      }

      session.stopReason = signal.stopReason
      session.lastError = signal.message
      break
    }

    if (!session.stopReason) {
      session.stopReason = session.stopRequested ? "user_stop" : "batch_terminal"
    }
  } catch (error) {
    session.stopRequested = true
    session.stopReason = "unrecoverable_error"
    session.lastError = errorMessage(error, "Worker loop berhenti karena error tak terduga.")

    logWorker("error", "worker.loop.crash", session, {
      error: session.lastError
    })
  } finally {
    try {
      await upsertPersistedSession(session)
    } catch (error) {
      logWorker("error", "worker.session.persist_failed", session, {
        error: errorMessage(error, "Gagal menyimpan state worker.")
      })
    }

    await sendBridgeWorkerEvent(session.sourceTabId, "batch.finished", {
      batch_id: session.batchId,
      worker_id: session.workerId,
      stop_reason: session.stopReason,
      last_error: session.lastError
    })

    logWorker("info", "worker.loop.stop", session, {
      stop_reason: session.stopReason,
      last_error: session.lastError
    })

    activeSessionsByKey.delete(session.key)
    activeWorkerByBatchId.delete(session.batchId)

    if (session.stopReason === "batch_terminal" || session.stopReason === "user_stop") {
      try {
        await removePersistedSession(session.key)
      } catch (error) {
        logWorker("error", "worker.session.remove_failed", session, {
          error: errorMessage(error, "Gagal membersihkan state worker.")
        })
      }
    }
  }
}

export const startBatchWorker = async (args: {
  message: RuntimeBatchWorkerRequest
  senderTabId?: number | null
  settings: PowermaxxSettings
}): Promise<RuntimeActionResponse> => {
  const session = await buildSession(args)

  if (!session) {
    return {
      ok: false,
      error: "batch_id wajib diisi untuk worker mode.",
      mode: "single",
      running: false,
      batchId: "",
      workerId: null
    }
  }

  if (activeWorkerByBatchId.has(session.batchId)) {
    const activeKey = activeWorkerByBatchId.get(session.batchId)
    const activeSession = activeKey ? activeSessionsByKey.get(activeKey) : null

    if (!activeSession) {
      activeWorkerByBatchId.delete(session.batchId)
    } else if (isActiveSessionStale(activeSession)) {
      const staleMs = activeSession.lastPoll
        ? Date.now() - activeSession.lastPoll
        : null

      logWorker("warn", "worker.session.recovered_stale", activeSession, {
        stale_ms: staleMs
      })

      activeSession.stopRequested = true
      activeSession.stopReason = activeSession.stopReason || "unrecoverable_error"
      activeSession.lastError =
        activeSession.lastError || "Sesi worker stale dipulihkan otomatis."

      activeSessionsByKey.delete(activeSession.key)
      activeWorkerByBatchId.delete(activeSession.batchId)

      try {
        await removePersistedSession(activeSession.key)
      } catch (error) {
        logWorker("warn", "worker.session.remove_failed", activeSession, {
          error: errorMessage(error, "Gagal membersihkan sesi stale.")
        })
      }
    } else {
      return {
        ok: true,
        mode: session.mode,
        running: true,
        count: 0,
        batchId: session.batchId,
        workerId: activeSession.workerId
      }
    }

    if (activeWorkerByBatchId.has(session.batchId)) {
      return {
        ok: true,
        mode: session.mode,
        running: true,
        count: 0,
        batchId: session.batchId,
        workerId: activeSession?.workerId ?? session.workerId
      }
    }
  }

  activeWorkerByBatchId.set(session.batchId, session.key)
  activeSessionsByKey.set(session.key, session)
  await upsertPersistedSession(session)

  void runBatchWorkerLoop(session).catch((error) => {
    session.stopRequested = true
    session.stopReason = session.stopReason || "unrecoverable_error"
    session.lastError = errorMessage(error, "Worker gagal dijalankan.")

    logWorker("error", "worker.loop.unhandled", session, {
      error: session.lastError
    })

    activeSessionsByKey.delete(session.key)
    activeWorkerByBatchId.delete(session.batchId)
  })

  return {
    ok: true,
    mode: session.mode,
    running: true,
    count: 0,
    batchId: session.batchId,
    workerId: session.workerId
  }
}

export const stopBatchWorker = async (args: { batchId: string }) => {
  const batchId = normalizeBatchId(args.batchId)

  if (!batchId) {
    return {
      ok: false,
      error: "batch_id wajib diisi untuk stop worker."
    }
  }

  const key = activeWorkerByBatchId.get(batchId)
  const session = key ? activeSessionsByKey.get(key) : null

  if (!session) {
    return {
      ok: false,
      error: "Worker batch tidak ditemukan."
    }
  }

  session.stopRequested = true
  session.stopReason = "user_stop"
  await upsertPersistedSession(session)

  return {
    ok: true,
    batchId,
    workerId: session.workerId
  }
}

export const resumePersistedBatchWorkers = async (args: {
  settings: PowermaxxSettings
}) => {
  const states = await loadPersistedSessions()
  const resumable = selectResumableBatchStates(states)

  for (const state of resumable) {
    const batchId = normalizeBatchId(state.batch_id)
    if (!batchId) {
      continue
    }

    if (activeWorkerByBatchId.has(batchId)) {
      continue
    }

    await startBatchWorker({
      message: {
        type: "POWERMAXX_BATCH_WORKER",
        action: state.action,
        mode: state.mode,
        batchId,
        workerId: state.worker_id,
        apiPaths: state.api_paths,
        orders: []
      },
      senderTabId: state.source_tab_id,
      settings: args.settings
    })
  }
}
