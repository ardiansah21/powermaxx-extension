import { logger } from "~src/core/logging/logger"
import {
  buildAutomationActionHint,
  classifyAutomationErrorCode,
  sanitizeErrorMessage,
  sanitizeTechnicalError,
  toAutomationErrorCode,
  toAutomationStatus
} from "~src/core/errors/automation-error"
import { normalizeIdType, normalizeMarketplace, toActionMode } from "~src/core/messages/guards"
import type {
  BridgeAction,
  BridgeApiPaths,
  NormalizedOrder,
  RuntimeRunWorkerRequest,
  RuntimeSingleRequest
} from "~src/core/messages/contracts"
import type { PowermaxxSettings } from "~src/core/settings/schema"
import { sendBridgeWorkerEvent } from "~src/features/bridge/background/bridge-events"
import { executeFetchSendByOrder } from "~src/features/fetch-send/background/run-fetch-send"

const WORKER_LOG_PREFIX = "[PMX-WORKER]"
const DEFAULT_WORKER_HEARTBEAT_MS = 5000
const DEFAULT_WORKER_ORDER_TIMEOUT_MS = 180000
const DEFAULT_WORKER_REQUEST_TIMEOUT_MS = 30000
const DEFAULT_WORKER_STALL_DETECTION_MS = 240000
const MIN_WORKER_STALL_DETECTION_MS = 60000
const MAX_WORKER_STALL_DETECTION_MS = 900000
const DEFAULT_WORKER_STALL_WATCHDOG_INTERVAL_MS = 10000
const INITIAL_EMPTY_CLAIM_RETRY_LIMIT = 8
const INITIAL_EMPTY_CLAIM_RETRY_DELAY_MS = 500
const WORKER_REPORTED_STORAGE_KEY = "pmxWorkerReportedRunOrders"
const WORKER_REPORTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const DEFAULT_WORKER_API_PATHS = {
  claimNext: "/api/mp-update/runs/{runId}/claim-next",
  heartbeat: "/api/mp-update/runs/{runId}/orders/{runOrderId}/heartbeat",
  report: "/api/mp-update/runs/{runId}/orders/{runOrderId}/report",
  complete: "/api/mp-update/runs/{runId}/complete"
}

const activeRunWorkerByKey = new Map<string, WorkerSession>()
const activeRunWorkerByRunId = new Map<string, string>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizePositiveInt = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const rounded = Math.trunc(num)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

const normalizeWorkerRunId = (value: unknown) => String(value || "").trim()

const normalizeWorkerId = (value: unknown, senderTabId?: number | null) => {
  const raw = String(value || "").trim()
  if (raw) return raw
  if (senderTabId) return `tab-${senderTabId}`
  return `worker-${Date.now()}`
}

const normalizeWorkerMode = (value: unknown): "single" | "bulk" => {
  const raw = String(value || "").trim().toLowerCase()
  return raw === "single" ? "single" : "bulk"
}

const normalizeWorkerAction = (value: unknown): BridgeAction => {
  const raw = String(value || "").trim().toLowerCase()
  if (raw === "update_order") return "update_order"
  if (raw === "update_income") return "update_income"
  return "update_both"
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const getLocalStorage = () => chrome.storage?.local

const loadWorkerReportedRegistry = async (): Promise<Record<string, number>> => {
  const storage = getLocalStorage()
  if (!storage) return {}

  return new Promise((resolve) => {
    storage.get([WORKER_REPORTED_STORAGE_KEY], (result) => {
      const registry = result?.[WORKER_REPORTED_STORAGE_KEY]
      resolve(isObject(registry) ? (registry as Record<string, number>) : {})
    })
  })
}

const saveWorkerReportedRegistry = async (registry: Record<string, number>) => {
  const storage = getLocalStorage()
  if (!storage) return

  return new Promise<void>((resolve) => {
    storage.set({ [WORKER_REPORTED_STORAGE_KEY]: registry }, () => resolve())
  })
}

const pruneWorkerReportedRegistry = (registry: Record<string, number>) => {
  const now = Date.now()
  const next: Record<string, number> = {}

  Object.entries(registry || {}).forEach(([key, value]) => {
    const ts = Number(value)
    if (!Number.isFinite(ts)) return
    if (now - ts > WORKER_REPORTED_RETENTION_MS) return
    next[key] = ts
  })

  return next
}

const loadPersistedReportedOrders = async (runId: string) => {
  const prefix = `${runId}:`
  const registry = pruneWorkerReportedRegistry(await loadWorkerReportedRegistry())
  await saveWorkerReportedRegistry(registry)
  return new Set(
    Object.keys(registry).filter((key) => String(key).startsWith(prefix))
  )
}

const markPersistedReportedOrder = async (dedupeKey: string) => {
  if (!dedupeKey) return
  const current = pruneWorkerReportedRegistry(await loadWorkerReportedRegistry())
  current[dedupeKey] = Date.now()
  await saveWorkerReportedRegistry(current)
}

const fillPathTemplate = (
  template: string,
  params: Record<string, string | number>
) => template.replace(/\{([^}]+)\}/g, (_match, key) => String(params[key] ?? ""))

const buildWorkerUrl = (
  baseUrl: string,
  template: string,
  params: Record<string, string | number>
) => {
  const path = fillPathTemplate(template, params)
  const cleanBase = baseUrl.replace(/\/+$/, "")
  return `${cleanBase}${path.startsWith("/") ? "" : "/"}${path}`
}

const buildWorkerApiPaths = (overrides: BridgeApiPaths = {}) => ({
  claimNext: overrides.claimNext || DEFAULT_WORKER_API_PATHS.claimNext,
  heartbeat: overrides.heartbeat || DEFAULT_WORKER_API_PATHS.heartbeat,
  report: overrides.report || DEFAULT_WORKER_API_PATHS.report,
  complete: overrides.complete || DEFAULT_WORKER_API_PATHS.complete
})

interface FetchJsonResult {
  ok: boolean
  status: number
  statusText: string
  text: string
  json: Record<string, any> | null
  error?: string
}

const fetchJsonWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs = DEFAULT_WORKER_REQUEST_TIMEOUT_MS
): Promise<FetchJsonResult> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(options.headers || {})
      }
    })

    const text = await response.text()
    let json: Record<string, any> | null = null

    if (text) {
      try {
        json = JSON.parse(text)
      } catch (_error) {
        json = null
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
      json
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: "FETCH_ERROR",
      text: "",
      json: null,
      error: String((error as Error)?.message || error)
    }
  } finally {
    clearTimeout(timeout)
  }
}

interface WorkerSession {
  key: string
  runId: string
  workerId: string
  token: string
  baseUrl: string
  mode: "single" | "bulk"
  action: BridgeAction
  apiPaths: ReturnType<typeof buildWorkerApiPaths>
  completeOnFinish: boolean
  heartbeatIntervalMs: number
  orderTimeoutMs: number
  requestTimeoutMs: number
  stallDetectionMs: number
  sourceTabId: number | null
  extensionVersion: string
  reportedOrders: Set<string>
  progress: {
    lastProgressAt: number
    stallReportedAt: number | null
    activeOrder: {
      runOrderId: string
      identifier: string
      marketplace: string
      startedAt: number
    } | null
  }
  stats: {
    claimed: number
    processed: number
    success: number
    failed: number
    timed_out: number
    report_failed: number
  }
}

const buildWorkerStallPayload = (session: WorkerSession, idleMs: number) => {
  const activeOrder = session.progress.activeOrder

  return {
    run_id: session.runId,
    worker_id: session.workerId,
    claimed: session.stats.claimed,
    processed: session.stats.processed,
    idle_ms: idleMs,
    stall_threshold_ms: session.stallDetectionMs,
    active_run_order_id: activeOrder?.runOrderId || "",
    active_identifier: activeOrder?.identifier || "",
    active_marketplace: activeOrder?.marketplace || "",
    active_duration_ms: activeOrder ? Date.now() - activeOrder.startedAt : 0
  }
}

const markWorkerProgress = async (
  session: WorkerSession,
  reason: string,
  detail: Record<string, unknown> = {}
) => {
  const stalledAt = session.progress.stallReportedAt
  const previousProgressAt = session.progress.lastProgressAt

  session.progress.lastProgressAt = Date.now()
  session.progress.stallReportedAt = null

  if (!stalledAt) {
    return
  }

  const idleMs = Date.now() - previousProgressAt
  const payload = {
    ...buildWorkerStallPayload(session, idleMs),
    reason,
    ...detail
  }

  logger.info("Worker run resumed after stall", {
    feature: "worker",
    domain: "run-loop",
    step: "stall-resolved",
    ...payload
  })

  workerLog(session, "log", "run_resumed", payload)

  await sendBridgeWorkerEvent(session.sourceTabId, "run_resumed", payload)
}

const maybeReportWorkerStalled = async (session: WorkerSession) => {
  const idleMs = Date.now() - session.progress.lastProgressAt

  if (idleMs < session.stallDetectionMs) {
    return
  }

  if (session.progress.stallReportedAt !== null) {
    return
  }

  session.progress.stallReportedAt = Date.now()

  const payload = buildWorkerStallPayload(session, idleMs)

  logger.warn("Worker run appears stalled", {
    feature: "worker",
    domain: "run-loop",
    step: "stall-detected",
    ...payload
  })

  workerLog(session, "warn", "run_stalled", payload)

  await sendBridgeWorkerEvent(session.sourceTabId, "run_stalled", payload)
}

const workerLog = (
  session: WorkerSession,
  level: "log" | "warn" | "error",
  event: string,
  payload: Record<string, unknown> = {}
) => {
  const line = {
    run_id: session.runId,
    worker_id: session.workerId,
    event,
    ...payload
  }

  if (level === "warn") {
    console.warn(WORKER_LOG_PREFIX, line)
    return
  }

  if (level === "error") {
    console.error(WORKER_LOG_PREFIX, line)
    return
  }

  console.log(WORKER_LOG_PREFIX, line)
}

const normalizeClaimedOrder = (
  rawPayload: Record<string, unknown> | null,
  fallbackAction: BridgeAction
) => {
  if (!rawPayload) {
    return {
      hasOrder: false,
      runOrderId: "",
      order: null as NormalizedOrder | null,
      action: fallbackAction
    }
  }

  const root =
    (isObject(rawPayload.data) ? rawPayload.data : rawPayload) || rawPayload

  const hasOrder =
    root.has_order === true ||
    root.hasOrder === true ||
    root.empty === false ||
    Boolean(root.run_order || root.runOrder || root.order || root.item)

  if (!hasOrder) {
    return {
      hasOrder: false,
      runOrderId: "",
      order: null,
      action: fallbackAction
    }
  }

  const runOrder =
    (isObject(root.run_order) && root.run_order) ||
    (isObject(root.runOrder) && root.runOrder) ||
    (isObject(root.order) && root.order) ||
    (isObject(root.item) && root.item) ||
    root

  const runOrderId = String(
    runOrder.run_order_id || runOrder.runOrderId || runOrder.id || ""
  )

  const identifier = String(
    runOrder.marketplace_identifier ||
      runOrder.identifier ||
      runOrder.order_id ||
      runOrder.order_sn ||
      runOrder.mp_order_id ||
      runOrder.mp_order_sn ||
      ""
  ).trim()

  const marketplace = normalizeMarketplace(
    runOrder.marketplace || runOrder.marketplace_slug || runOrder.marketplace_name
  )

  const idType =
    normalizeIdType(runOrder.id_type || runOrder.identifier_type || runOrder.idType) ||
    (runOrder.mp_order_id !== undefined || runOrder.order_id !== undefined
      ? "order_id"
      : "order_sn")

  const action = normalizeWorkerAction(runOrder.action || fallbackAction)

  if (!identifier || (marketplace !== "shopee" && marketplace !== "tiktok_shop")) {
    return {
      hasOrder: false,
      runOrderId,
      order: null,
      action
    }
  }

  return {
    hasOrder: true,
    runOrderId,
    action,
    order: {
      id: identifier,
      marketplace,
      idType
    } as NormalizedOrder
  }
}

const normalizeOrderChanges = (value: unknown) => {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      if (!isObject(entry)) return null
      const field = String(entry.field || entry.name || entry.key || "").trim()
      if (!field) return null

      return {
        field,
        before:
          entry.before !== undefined
            ? entry.before
            : entry.old !== undefined
              ? entry.old
              : null,
        after:
          entry.after !== undefined
            ? entry.after
            : entry.new !== undefined
              ? entry.new
              : null
      }
    })
    .filter(Boolean)
}

const extractChangesFromFetchResult = (fetchResult: Record<string, unknown> | null) => {
  if (!isObject(fetchResult)) return []

  const changes = normalizeOrderChanges(fetchResult.changes)
  if (changes.length) return changes

  const mergedChanges: Array<{ field: string; before: unknown; after: unknown }> = []

  const orderRawJson =
    (fetchResult.orderRawJson as Record<string, unknown> | null) ||
    (fetchResult.order_raw_json as Record<string, unknown> | null) ||
    null

  const incomeRawJson =
    (fetchResult.incomeRawJson as Record<string, unknown> | null) ||
    (fetchResult.income_raw_json as Record<string, unknown> | null) ||
    null

  const incomeDetailRawJson =
    (fetchResult.incomeDetailRawJson as Record<string, unknown> | null) ||
    (fetchResult.income_detail_raw_json as Record<string, unknown> | null) ||
    null

  if (orderRawJson !== null) {
    mergedChanges.push({
      field: "payload.order_raw_json",
      before: null,
      after: orderRawJson
    })
  }

  if (incomeRawJson !== null || incomeDetailRawJson !== null) {
    let normalizedIncomePayload = incomeRawJson

    if (
      isObject(normalizedIncomePayload) &&
      incomeDetailRawJson !== null &&
      !Object.prototype.hasOwnProperty.call(
        normalizedIncomePayload,
        "statement_transaction_detail"
      )
    ) {
      normalizedIncomePayload = {
        ...normalizedIncomePayload,
        statement_transaction_detail: incomeDetailRawJson
      }
    } else if (!normalizedIncomePayload && incomeDetailRawJson !== null) {
      normalizedIncomePayload = {
        statement_transaction_detail: incomeDetailRawJson
      }
    }

    mergedChanges.push({
      field: "payload.income_raw_json",
      before: null,
      after: normalizedIncomePayload
    })
  }

  return mergedChanges
}

const buildRunOrderReportPayload = (args: {
  session: WorkerSession
  order: NormalizedOrder
  action: BridgeAction
  status: "success" | "timed_out" | "failed"
  errorCode: string | null
  errorMessage: string | null
  technicalError: string | null
  durationMs: number
  fetchResult: Record<string, unknown> | null
}) => {
  const {
    session,
    order,
    action,
    status,
    errorCode,
    errorMessage,
    technicalError,
    durationMs,
    fetchResult
  } = args

  const orderRawJson =
    (fetchResult?.orderRawJson as Record<string, unknown> | null) ||
    (fetchResult?.order_raw_json as Record<string, unknown> | null) ||
    null

  const incomeRawJson =
    (fetchResult?.incomeRawJson as Record<string, unknown> | null) ||
    (fetchResult?.income_raw_json as Record<string, unknown> | null) ||
    null

  const incomeDetailRawJson =
    (fetchResult?.incomeDetailRawJson as Record<string, unknown> | null) ||
    (fetchResult?.income_detail_raw_json as Record<string, unknown> | null) ||
    null

  const fetchMeta =
    (fetchResult?.fetchMeta as Record<string, unknown> | null) ||
    (fetchResult?.fetch_meta as Record<string, unknown> | null) ||
    null

  return {
    status,
    error_code: errorCode,
    error_message: errorMessage,
    technical_error: technicalError,
    changes: extractChangesFromFetchResult(fetchResult),
    action_hint:
      status === "success"
        ? null
        : buildAutomationActionHint(toAutomationErrorCode(errorCode)),
    meta: {
      worker_id: session.workerId,
      extension_version: session.extensionVersion,
      duration_ms: durationMs
    },
    marketplace: order.marketplace,
    order_identifier: order.id,
    id_type: order.idType,
    action,
    fetch_result: fetchResult
      ? {
          order_raw_json: orderRawJson,
          income_raw_json: incomeRawJson,
          income_detail_raw_json: incomeDetailRawJson,
          fetch_meta: fetchMeta
        }
      : null
  }
}

const claimNextRunOrder = async (session: WorkerSession) => {
  const url = buildWorkerUrl(session.baseUrl, session.apiPaths.claimNext, {
    runId: session.runId
  })

  const claimPayload = {
    run_id: session.runId,
    runId: session.runId,
    worker_id: session.workerId,
    workerId: session.workerId,
    action: session.action,
    mode: session.mode
  }

  const response = await fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify(claimPayload)
    },
    session.requestTimeoutMs
  )

  if (!response.ok) {
    const suffix = response.error ? ` (${response.error})` : ""
    return {
      ok: false,
      error: `Claim next gagal ${response.status}${suffix}`,
      claimed: null
    }
  }

  return {
    ok: true,
    error: "",
    claimed: normalizeClaimedOrder(response.json, session.action)
  }
}

const sendHeartbeat = async (
  session: WorkerSession,
  runOrderId: string,
  payload: Record<string, unknown>
) => {
  const url = buildWorkerUrl(session.baseUrl, session.apiPaths.heartbeat, {
    runId: session.runId,
    runOrderId
  })

  return fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify(payload)
    },
    session.requestTimeoutMs
  )
}

const reportRunOrder = async (
  session: WorkerSession,
  runOrderId: string,
  payload: Record<string, unknown>
) => {
  const dedupeKey = `${session.runId}:${runOrderId}`
  if (session.reportedOrders.has(dedupeKey)) {
    return {
      ok: true,
      duplicate: true,
      response: null as FetchJsonResult | null
    }
  }

  const url = buildWorkerUrl(session.baseUrl, session.apiPaths.report, {
    runId: session.runId,
    runOrderId
  })

  let lastResponse: FetchJsonResult | null = null

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetchJsonWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify(payload)
      },
      session.requestTimeoutMs
    )

    lastResponse = response
    if (response.ok) {
      session.reportedOrders.add(dedupeKey)
      await markPersistedReportedOrder(dedupeKey)
      return {
        ok: true,
        duplicate: false,
        response
      }
    }

    const shouldRetry = [0, 408, 429].includes(response.status)
    if (!shouldRetry || attempt >= 3) {
      break
    }

    await sleep(400 * attempt)
  }

  return {
    ok: false,
    duplicate: false,
    response: lastResponse
  }
}

const completeRunIfNeeded = async (session: WorkerSession) => {
  if (!session.completeOnFinish) {
    return {
      ok: true,
      status: 0
    }
  }

  const url = buildWorkerUrl(session.baseUrl, session.apiPaths.complete, {
    runId: session.runId
  })

  return fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({
        stats: session.stats
      })
    },
    session.requestTimeoutMs
  )
}

const processClaimedRunOrder = async (
  session: WorkerSession,
  claimed: ReturnType<typeof normalizeClaimedOrder>,
  settings: PowermaxxSettings
) => {
  const startedAt = Date.now()
  const runOrderId = claimed.runOrderId || `${Date.now()}`

  const order = claimed.order
  if (!order) {
    return {
      ok: false,
      status: "failed",
      errorCode: "INVALID_ORDER",
      errorMessage: "Payload order worker tidak valid.",
      durationMs: 0
    }
  }

  await sendBridgeWorkerEvent(session.sourceTabId, "run_order_started", {
    run_id: session.runId,
    worker_id: session.workerId,
    run_order_id: runOrderId,
    identifier: order.id,
    marketplace: order.marketplace,
    action: claimed.action
  })

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  try {
    heartbeatTimer = setInterval(() => {
      void sendHeartbeat(session, runOrderId, {
        status: "processing",
        worker_id: session.workerId,
        run_id: session.runId,
        timestamp: Date.now()
      }).then((heartbeatResponse) => {
        void sendBridgeWorkerEvent(session.sourceTabId, "run_order_heartbeat", {
          run_order_id: runOrderId,
          worker_id: session.workerId,
          run_id: session.runId,
          ok: heartbeatResponse.ok,
          status: heartbeatResponse.status
        })
      })
    }, session.heartbeatIntervalMs)

    const result = await executeFetchSendByOrder({
      order,
      actionMode: toActionMode(claimed.action),
      settings,
      timeoutMs: session.orderTimeoutMs
    })

    const durationMs = Date.now() - startedAt
    const errorCode = result.ok
      ? null
      : classifyAutomationErrorCode(sanitizeErrorMessage(result.error))
    const status = result.ok
      ? "success"
      : toAutomationStatus(errorCode)
    const errorMessage = result.ok
      ? null
      : sanitizeErrorMessage(result.error)
    const technicalError = result.ok ? null : sanitizeTechnicalError(result.error)

    const reportPayload = buildRunOrderReportPayload({
      session,
      order,
      action: claimed.action,
      status,
      errorCode: errorCode,
      errorMessage,
      technicalError,
      durationMs,
      fetchResult:
        (result.fetchResult as unknown as Record<string, unknown> | undefined) || null
    })

    const reportResponse = await reportRunOrder(session, runOrderId, reportPayload)

    if (!reportResponse.ok) {
      session.stats.report_failed += 1
    }

    await sendBridgeWorkerEvent(session.sourceTabId, "run_order_finished", {
      run_id: session.runId,
      worker_id: session.workerId,
      run_order_id: runOrderId,
      status,
      error_code: errorCode,
      error_message: errorMessage,
      technical_error: technicalError,
      action_hint: result.ok ? null : buildAutomationActionHint(errorCode),
      report_ok: reportResponse.ok
    })

    return {
      ok: result.ok,
      status,
      errorCode: errorCode,
      errorMessage: errorMessage,
      technicalError,
      actionHint: result.ok ? null : buildAutomationActionHint(errorCode),
      fetchResult:
        (result.fetchResult as unknown as Record<string, unknown> | undefined) || null,
      durationMs
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const errorMessage = sanitizeErrorMessage((error as Error)?.message || error)
    const errorCode = classifyAutomationErrorCode(errorMessage)
    const status = toAutomationStatus(errorCode)
    const technicalError = sanitizeTechnicalError(
      (error as Error)?.stack || (error as Error)?.message || error
    )

    const reportResponse = await reportRunOrder(
      session,
      runOrderId,
      buildRunOrderReportPayload({
        session,
        order,
        action: claimed.action,
        status,
        errorCode,
        errorMessage,
        technicalError,
        durationMs,
        fetchResult: null
      })
    )

    if (!reportResponse.ok) {
      session.stats.report_failed += 1
    }

    await sendBridgeWorkerEvent(session.sourceTabId, "run_order_finished", {
      run_id: session.runId,
      worker_id: session.workerId,
      run_order_id: runOrderId,
      status,
      error_code: errorCode,
      error_message: errorMessage,
      technical_error: technicalError,
      action_hint: buildAutomationActionHint(errorCode),
      report_ok: reportResponse.ok
    })

    return {
      ok: false,
      status,
      errorCode: errorCode,
      errorMessage: errorMessage,
      technicalError,
      actionHint: buildAutomationActionHint(errorCode),
      fetchResult: null,
      durationMs
    }
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
    }
  }
}

const runWorkerLoop = async (session: WorkerSession, settings: PowermaxxSettings) => {
  await sendBridgeWorkerEvent(session.sourceTabId, "run_started", {
    run_id: session.runId,
    worker_id: session.workerId,
    mode: session.mode
  })

  workerLog(session, "log", "run_started", {
    action: session.action,
    mode: session.mode
  })

  let initialEmptyClaimAttempts = 0
  const watchdogInterval = Math.max(
    3000,
    Math.min(
      DEFAULT_WORKER_STALL_WATCHDOG_INTERVAL_MS,
      session.heartbeatIntervalMs
    )
  )

  const stallWatchdog = setInterval(() => {
    void maybeReportWorkerStalled(session).catch((error) => {
      logger.warn("Worker stall watchdog failed", {
        feature: "worker",
        domain: "run-loop",
        step: "stall-watchdog",
        runId: session.runId,
        workerId: session.workerId,
        error: String((error as Error)?.message || error)
      })
    })
  }, watchdogInterval)

  try {
    while (true) {
      const claimResult = await claimNextRunOrder(session)

      if (!claimResult.ok) {
        throw new Error(claimResult.error || "Gagal claim order worker.")
      }

      const claimed = claimResult.claimed
      if (!claimed?.hasOrder) {
        await markWorkerProgress(session, "claim_empty")

        if (session.stats.claimed === 0) {
          if (initialEmptyClaimAttempts < INITIAL_EMPTY_CLAIM_RETRY_LIMIT) {
            initialEmptyClaimAttempts += 1

            workerLog(session, "warn", "claim_empty_retry", {
              attempt: initialEmptyClaimAttempts,
              max_attempts: INITIAL_EMPTY_CLAIM_RETRY_LIMIT
            })

            await sleep(INITIAL_EMPTY_CLAIM_RETRY_DELAY_MS)
            continue
          }
        }

        break
      }

      initialEmptyClaimAttempts = 0
      session.stats.claimed += 1

      const activeRunOrderId = claimed.runOrderId || `${Date.now()}`
      session.progress.activeOrder = {
        runOrderId: activeRunOrderId,
        identifier: claimed.order?.id || "",
        marketplace: claimed.order?.marketplace || "",
        startedAt: Date.now()
      }

      await markWorkerProgress(session, "claim_order", {
        run_order_id: activeRunOrderId,
        identifier: session.progress.activeOrder.identifier,
        marketplace: session.progress.activeOrder.marketplace
      })

      const outcome = await processClaimedRunOrder(session, claimed, settings)
      session.stats.processed += 1

      if (outcome.ok) {
        session.stats.success += 1
      } else if (outcome.status === "timed_out") {
        session.stats.timed_out += 1
      } else {
        session.stats.failed += 1
      }

      await markWorkerProgress(session, "run_order_finished", {
        run_order_id: activeRunOrderId,
        identifier: session.progress.activeOrder?.identifier || "",
        marketplace: session.progress.activeOrder?.marketplace || "",
        status: outcome.status
      })

      session.progress.activeOrder = null
    }

    const completion = await completeRunIfNeeded(session)
    if (!completion.ok) {
      workerLog(session, "warn", "run_complete_failed", {
        status: completion.status
      })
    }

    await sendBridgeWorkerEvent(session.sourceTabId, "run_finished", {
      run_id: session.runId,
      worker_id: session.workerId,
      ok: true,
      stats: session.stats
    })

    workerLog(session, "log", "run_finished", {
      stats: session.stats
    })
  } finally {
    clearInterval(stallWatchdog)
    session.progress.activeOrder = null
  }
}

export const startRunWorker = async (args: {
  message: RuntimeRunWorkerRequest | RuntimeSingleRequest
  senderTabId?: number | null
  settings: PowermaxxSettings
}) => {
  const { message, senderTabId, settings } = args

  const token = settings.auth.token || ""
  const baseUrl = settings.auth.baseUrl || ""
  const runId = normalizeWorkerRunId(message.runId || message.run_id)
  const workerId = normalizeWorkerId(message.workerId || message.worker_id, senderTabId)

  if (!runId) {
    return {
      ok: false,
      error: "run_id wajib diisi untuk worker mode.",
      running: false,
      runId: "",
      workerId,
      mode: "bulk" as const
    }
  }

  if (!token) {
    return {
      ok: false,
      error: "Sesi login belum tersedia. Login dulu di popup.",
      running: false,
      runId,
      workerId,
      mode: "bulk" as const
    }
  }

  if (!baseUrl) {
    return {
      ok: false,
      error: "Base URL belum diatur.",
      running: false,
      runId,
      workerId,
      mode: "bulk" as const
    }
  }

  const workerKey = `${runId}:${workerId}`

  if (activeRunWorkerByKey.has(workerKey) || activeRunWorkerByRunId.has(runId)) {
    return {
      ok: false,
      error: "Worker untuk run ini masih berjalan.",
      running: true,
      runId,
      workerId,
      mode: normalizeWorkerMode(message.mode)
    }
  }

  const apiOverrides = {
    ...(isObject(message.apiPaths) ? message.apiPaths : {}),
    ...(isObject(message.api_paths) ? message.api_paths : {})
  }

  const completeOnFinish =
    Boolean(message.completeOnFinish) || Boolean(message.complete_on_finish)

  const heartbeatIntervalMs = normalizePositiveInt(
    message.heartbeatMs ?? message.heartbeat_interval_ms,
    DEFAULT_WORKER_HEARTBEAT_MS,
    5000,
    30000
  )

  const orderTimeoutMs = normalizePositiveInt(
    message.orderTimeoutMs ?? message.order_timeout_ms,
    DEFAULT_WORKER_ORDER_TIMEOUT_MS,
    60000,
    600000
  )

  const requestTimeoutMs = normalizePositiveInt(
    message.requestTimeoutMs ?? message.request_timeout_ms,
    DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
    5000,
    120000
  )

  const computedStallTimeoutMs = Math.max(
    DEFAULT_WORKER_STALL_DETECTION_MS,
    orderTimeoutMs + requestTimeoutMs + heartbeatIntervalMs * 2
  )

  const stallDetectionMs = normalizePositiveInt(
    message.stallDetectionMs ?? message.stall_detection_ms,
    computedStallTimeoutMs,
    MIN_WORKER_STALL_DETECTION_MS,
    MAX_WORKER_STALL_DETECTION_MS
  )

  const mode = normalizeWorkerMode(message.mode)
  const action = normalizeWorkerAction(message.action)

  const session: WorkerSession = {
    key: workerKey,
    runId,
    workerId,
    token,
    baseUrl,
    mode,
    action,
    apiPaths: buildWorkerApiPaths(apiOverrides),
    completeOnFinish,
    heartbeatIntervalMs,
    orderTimeoutMs,
    requestTimeoutMs,
    stallDetectionMs,
    sourceTabId: senderTabId || null,
    extensionVersion: chrome.runtime.getManifest()?.version || "unknown",
    reportedOrders: await loadPersistedReportedOrders(runId),
    progress: {
      lastProgressAt: Date.now(),
      stallReportedAt: null,
      activeOrder: null
    },
    stats: {
      claimed: 0,
      processed: 0,
      success: 0,
      failed: 0,
      timed_out: 0,
      report_failed: 0
    }
  }

  activeRunWorkerByKey.set(workerKey, session)
  activeRunWorkerByRunId.set(runId, workerKey)

  // Delay worker start to ensure runtime response is posted first.
  setTimeout(() => {
    runWorkerLoop(session, settings)
      .catch(async (error) => {
        const errorMessage = sanitizeErrorMessage((error as Error)?.message || error)
        const errorCode = classifyAutomationErrorCode(errorMessage)

        logger.error("Worker run failed", {
          feature: "worker",
          domain: "run-loop",
          step: "catch",
          runId: session.runId,
          workerId: session.workerId,
          error: errorMessage
        })

        workerLog(session, "error", "run_failed", {
          error_code: errorCode,
          error_message: errorMessage
        })

        await sendBridgeWorkerEvent(session.sourceTabId, "run_failed", {
          run_id: session.runId,
          worker_id: session.workerId,
          error_code: errorCode,
          error_message: errorMessage,
          technical_error: sanitizeTechnicalError(
            (error as Error)?.stack || (error as Error)?.message || error
          ),
          action_hint: buildAutomationActionHint(errorCode),
          stats: session.stats
        })
      })
      .finally(() => {
        activeRunWorkerByKey.delete(workerKey)
        activeRunWorkerByRunId.delete(runId)
      })
  }, 0)

  return {
    ok: true,
    error: "",
    running: true,
    runId,
    workerId,
    mode
  }
}
