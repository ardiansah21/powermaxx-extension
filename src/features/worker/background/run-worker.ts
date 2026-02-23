import {
  buildAutomationActionHint,
  classifyAutomationErrorCode,
  sanitizeErrorMessage,
  sanitizeTechnicalError,
  toAutomationErrorCode,
  toAutomationStatus
} from "~src/core/errors/automation-error"
import { logger } from "~src/core/logging/logger"
import type {
  BridgeAction,
  BridgeApiPaths,
  NormalizedOrder,
  RuntimeRunWorkerRequest,
  RuntimeSingleRequest
} from "~src/core/messages/contracts"
import {
  normalizeIdType,
  normalizeMarketplace,
  toActionMode
} from "~src/core/messages/guards"
import type { PowermaxxSettings } from "~src/core/settings/schema"
import { sendBridgeWorkerEvent } from "~src/features/bridge/background/bridge-events"
import { executeFetchSendByOrder } from "~src/features/fetch-send/background/run-fetch-send"
import {
  isRetryablePollStatus,
  runDurableClaimLoop,
  selectResumableRunStates,
  type WorkerStopReason
} from "~src/features/worker/background/worker-loop-core"

const WORKER_LOG_PREFIX = "[PMX-WORKER]"
const DEFAULT_WORKER_HEARTBEAT_MS = 5000
const DEFAULT_WORKER_ORDER_TIMEOUT_MS = 180000
const DEFAULT_WORKER_REQUEST_TIMEOUT_MS = 30000
const DEFAULT_WORKER_STALL_DETECTION_MS = 240000
const MIN_WORKER_STALL_DETECTION_MS = 60000
const MAX_WORKER_STALL_DETECTION_MS = 900000
const DEFAULT_WORKER_STALL_WATCHDOG_INTERVAL_MS = 10000
const WORKER_REPORTED_STORAGE_KEY = "pmxWorkerReportedRunOrders"
const WORKER_REPORTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const WORKER_RUN_STATE_STORAGE_KEY = "pmxWorkerRunStateV1"
const WORKER_RUN_STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const DEFAULT_WORKER_API_PATHS = {
  claimNext: "/api/mp-update/runs/{runId}/claim-next",
  heartbeat: "/api/mp-update/runs/{runId}/orders/{runOrderId}/heartbeat",
  report: "/api/mp-update/runs/{runId}/orders/{runOrderId}/report",
  complete: "/api/mp-update/runs/{runId}/complete"
}

const activeRunWorkerByKey = new Map<string, WorkerSession>()
const activeRunWorkerByRunId = new Map<string, string>()
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

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
  const raw = String(value || "")
    .trim()
    .toLowerCase()
  return raw === "single" ? "single" : "bulk"
}

const normalizeWorkerAction = (value: unknown): BridgeAction => {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
  if (raw === "update_order") return "update_order"
  if (raw === "update_income") return "update_income"
  return "update_both"
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const getLocalStorage = () => chrome.storage?.local

const loadWorkerReportedRegistry = async (): Promise<
  Record<string, number>
> => {
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
  const registry = pruneWorkerReportedRegistry(
    await loadWorkerReportedRegistry()
  )
  await saveWorkerReportedRegistry(registry)
  return new Set(
    Object.keys(registry).filter((key) => String(key).startsWith(prefix))
  )
}

const markPersistedReportedOrder = async (dedupeKey: string) => {
  if (!dedupeKey) return
  const current = pruneWorkerReportedRegistry(
    await loadWorkerReportedRegistry()
  )
  current[dedupeKey] = Date.now()
  await saveWorkerReportedRegistry(current)
}

const loadWorkerRunStateRegistry = async (): Promise<
  Record<string, PersistedWorkerState>
> => {
  const storage = getLocalStorage()
  if (!storage) return {}

  return new Promise((resolve) => {
    storage.get([WORKER_RUN_STATE_STORAGE_KEY], (result) => {
      const registry = result?.[WORKER_RUN_STATE_STORAGE_KEY]
      resolve(
        isObject(registry)
          ? (registry as Record<string, PersistedWorkerState>)
          : {}
      )
    })
  })
}

const saveWorkerRunStateRegistry = async (
  registry: Record<string, PersistedWorkerState>
) => {
  const storage = getLocalStorage()
  if (!storage) return

  return new Promise<void>((resolve) => {
    storage.set({ [WORKER_RUN_STATE_STORAGE_KEY]: registry }, () => resolve())
  })
}

const pruneWorkerRunStateRegistry = (
  registry: Record<string, PersistedWorkerState>
) => {
  const now = Date.now()
  const next: Record<string, PersistedWorkerState> = {}

  Object.entries(registry || {}).forEach(([key, value]) => {
    if (!isObject(value)) return
    const updatedAt = Number(value.updated_at || 0)
    const stopReason = String(value.stop_reason || "").trim()
    const active = value.active === true && !stopReason
    const shouldKeep =
      active ||
      (Number.isFinite(updatedAt) &&
        now - updatedAt <= WORKER_RUN_STATE_RETENTION_MS)

    if (!shouldKeep) {
      return
    }

    next[key] = value as PersistedWorkerState
  })

  return next
}

const toPersistedWorkerState = (
  session: WorkerSession
): PersistedWorkerState => ({
  run_id: session.runId,
  worker_id: session.workerId,
  mode: session.mode,
  action: session.action,
  api_paths: session.apiPaths,
  complete_on_finish: session.completeOnFinish,
  heartbeat_ms: session.heartbeatIntervalMs,
  order_timeout_ms: session.orderTimeoutMs,
  request_timeout_ms: session.requestTimeoutMs,
  stall_detection_ms: session.stallDetectionMs,
  source_tab_id: session.sourceTabId,
  extension_version: session.extensionVersion,
  stats: { ...session.stats },
  last_claim_at: session.lastClaimAt,
  last_poll_at: session.lastPollAt,
  last_error: session.lastError,
  stop_reason: session.stopReason,
  active: !session.stopReason,
  updated_at: Date.now()
})

const persistWorkerSessionState = async (session: WorkerSession) => {
  const current = pruneWorkerRunStateRegistry(
    await loadWorkerRunStateRegistry()
  )
  current[session.key] = toPersistedWorkerState(session)
  await saveWorkerRunStateRegistry(current)
}

const markWorkerSessionStopped = async (
  session: WorkerSession,
  stopReason: WorkerStopReason
) => {
  session.stopReason = stopReason
  await persistWorkerSessionState(session)
}

const fillPathTemplate = (
  template: string,
  params: Record<string, string | number>
) =>
  template.replace(/\{([^}]+)\}/g, (_match, key) => String(params[key] ?? ""))

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

const snippet = (value: unknown, max = 240) => {
  const text = String(value || "").trim()
  if (!text) return ""
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
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

const extractWorkerApiErrorDetail = (response: FetchJsonResult) => {
  const payload = isObject(response.json) ? response.json : null
  const code = String(payload?.code || "").trim()
  const message = String(payload?.message || "").trim()
  const hint = String(payload?.action_hint || payload?.actionHint || "").trim()
  const networkError = snippet(response.error)
  const rawSnippet = snippet(response.text)

  return {
    code,
    message,
    hint,
    networkError,
    rawSnippet
  }
}

const formatWorkerApiError = (label: string, response: FetchJsonResult) => {
  const detail = extractWorkerApiErrorDetail(response)
  const parts = [
    detail.code ? `[${detail.code}]` : "",
    detail.message,
    detail.hint,
    detail.networkError,
    !detail.message && !detail.networkError ? detail.rawSnippet : ""
  ].filter(Boolean)

  const suffix = parts.length
    ? `: ${parts.join(" | ")}`
    : ` (${response.statusText || "REQUEST_FAILED"})`

  return `${label} ${response.status}${suffix}`
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
  stopRequested: boolean
  stopReason: WorkerStopReason | null
  lastClaimAt: number | null
  lastPollAt: number | null
  lastError: string
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

interface PersistedWorkerState {
  run_id: string
  worker_id: string
  mode: "single" | "bulk"
  action: BridgeAction
  api_paths: ReturnType<typeof buildWorkerApiPaths>
  complete_on_finish: boolean
  heartbeat_ms: number
  order_timeout_ms: number
  request_timeout_ms: number
  stall_detection_ms: number
  source_tab_id: number | null
  extension_version: string
  stats: WorkerSession["stats"]
  last_claim_at: number | null
  last_poll_at: number | null
  last_error: string
  stop_reason: WorkerStopReason | null
  active: boolean
  updated_at: number
}

const buildWorkerCanonicalMeta = (session: WorkerSession) => ({
  run_id: session.runId,
  runId: session.runId,
  worker_id: session.workerId,
  workerId: session.workerId,
  tab_id: session.sourceTabId || null,
  tabId: session.sourceTabId || null,
  extension_version: session.extensionVersion,
  extensionVersion: session.extensionVersion
})

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
    runOrder.marketplace ||
      runOrder.marketplace_slug ||
      runOrder.marketplace_name
  )

  const idType =
    normalizeIdType(
      runOrder.id_type || runOrder.identifier_type || runOrder.idType
    ) ||
    (runOrder.mp_order_id !== undefined || runOrder.order_id !== undefined
      ? "order_id"
      : "order_sn")

  const action = normalizeWorkerAction(runOrder.action || fallbackAction)

  if (
    !identifier ||
    (marketplace !== "shopee" && marketplace !== "tiktok_shop")
  ) {
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

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
  "canceled",
  "stopped",
  "aborted",
  "timeout",
  "timed_out"
])

const readTerminalStatusFromPayload = (
  payload: Record<string, unknown> | null
) => {
  if (!payload) return ""

  const root = (isObject(payload.data) ? payload.data : payload) || payload

  const directStatus = String(
    root.run_status ||
      root.runStatus ||
      root.status ||
      (isObject(root.run) ? root.run.status : "") ||
      ""
  )
    .trim()
    .toLowerCase()

  if (TERMINAL_RUN_STATUSES.has(directStatus)) {
    return directStatus
  }

  return ""
}

const isTerminalFromPayload = (payload: Record<string, unknown> | null) => {
  if (!payload) return false
  const root = (isObject(payload.data) ? payload.data : payload) || payload

  if (
    root.run_terminal === true ||
    root.runTerminal === true ||
    root.terminal === true ||
    (isObject(root.run) &&
      (root.run.terminal === true || root.run.is_terminal === true))
  ) {
    return true
  }

  return Boolean(readTerminalStatusFromPayload(payload))
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

const extractChangesFromFetchResult = (
  fetchResult: Record<string, unknown> | null
) => {
  if (!isObject(fetchResult)) return []

  const changes = normalizeOrderChanges(fetchResult.changes)
  if (changes.length) return changes

  const mergedChanges: Array<{
    field: string
    before: unknown
    after: unknown
  }> = []

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
    ...buildWorkerCanonicalMeta(session),
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
    const formattedError = formatWorkerApiError("Claim next gagal", response)
    session.lastError = formattedError

    if ([401, 403, 419].includes(response.status)) {
      return {
        type: "fatal_error" as const,
        stopReason: "unrecoverable_auth" as const,
        status: response.status,
        message: formattedError
      }
    }

    if (isRetryablePollStatus(response.status)) {
      return {
        type: "retryable_error" as const,
        status: response.status,
        message: formattedError
      }
    }

    return {
      type: "fatal_error" as const,
      stopReason: "unrecoverable_error" as const,
      status: response.status,
      message: formattedError
    }
  }

  session.lastError = ""

  const terminal = isTerminalFromPayload(response.json)
  const claimed = normalizeClaimedOrder(response.json, session.action)

  if (!claimed?.hasOrder) {
    return {
      type: "empty" as const,
      terminal
    }
  }

  return {
    type: "claimed" as const,
    claim: claimed
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

  const heartbeatPayload = {
    ...buildWorkerCanonicalMeta(session),
    run_order_id: runOrderId,
    runOrderId: runOrderId,
    ...payload
  }

  return fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify(heartbeatPayload)
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

  const reportPayload = {
    ...buildWorkerCanonicalMeta(session),
    run_order_id: runOrderId,
    runOrderId: runOrderId,
    ...payload
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetchJsonWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify(reportPayload)
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

const completeRunIfNeeded = async (
  session: WorkerSession
): Promise<FetchJsonResult | { ok: true; status: number }> => {
  if (!session.completeOnFinish) {
    return {
      ok: true as const,
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
        ...buildWorkerCanonicalMeta(session),
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
    const status = result.ok ? "success" : toAutomationStatus(errorCode)
    const errorMessage = result.ok ? null : sanitizeErrorMessage(result.error)
    const technicalError = result.ok
      ? null
      : sanitizeTechnicalError(result.error)

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
        (result.fetchResult as unknown as
          | Record<string, unknown>
          | undefined) || null
    })

    const reportResponse = await reportRunOrder(
      session,
      runOrderId,
      reportPayload
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
        (result.fetchResult as unknown as
          | Record<string, unknown>
          | undefined) || null,
      durationMs
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const errorMessage = sanitizeErrorMessage(
      (error as Error)?.message || error
    )
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

const runWorkerLoop = async (
  session: WorkerSession,
  settings: PowermaxxSettings
) => {
  await persistWorkerSessionState(session)

  await sendBridgeWorkerEvent(session.sourceTabId, "run_started", {
    run_id: session.runId,
    worker_id: session.workerId,
    mode: session.mode
  })

  logger.info("Worker loop started", {
    feature: "worker",
    domain: "run-loop",
    step: "worker.loop.start",
    runId: session.runId,
    workerId: session.workerId,
    mode: session.mode,
    action: session.action
  })

  workerLog(session, "log", "worker.loop.start", {
    action: session.action,
    mode: session.mode
  })

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
    const loopResult = await runDurableClaimLoop({
      sleep,
      shouldStop: () => session.stopRequested,
      poll: async () => {
        session.lastPollAt = Date.now()
        await persistWorkerSessionState(session)
        return claimNextRunOrder(session)
      },
      onClaimEmpty: async (attempt, delayMs) => {
        await markWorkerProgress(session, "claim_empty")
        await persistWorkerSessionState(session)

        logger.info("Worker claim empty, retrying poll", {
          feature: "worker",
          domain: "run-loop",
          step: "worker.claim.empty",
          runId: session.runId,
          workerId: session.workerId,
          attempt,
          nextPollDelayMs: delayMs
        })

        workerLog(session, "log", "worker.claim.empty", {
          attempt,
          next_poll_delay_ms: delayMs
        })
      },
      onRetry: async (attempt, delayMs, signal) => {
        session.lastError = signal.message
        await persistWorkerSessionState(session)

        logger.warn("Worker polling retry scheduled", {
          feature: "worker",
          domain: "run-loop",
          step: "worker.poll.retry",
          runId: session.runId,
          workerId: session.workerId,
          attempt,
          status: signal.status,
          nextRetryDelayMs: delayMs,
          error: signal.message
        })

        workerLog(session, "warn", "worker.poll.retry", {
          attempt,
          status: signal.status,
          next_retry_delay_ms: delayMs,
          error: signal.message
        })
      },
      onClaimed: async (claimed) => {
        session.lastClaimAt = Date.now()
        session.lastError = ""
        session.stats.claimed += 1

        const activeRunOrderId = claimed.runOrderId || `${Date.now()}`
        session.progress.activeOrder = {
          runOrderId: activeRunOrderId,
          identifier: claimed.order?.id || "",
          marketplace: claimed.order?.marketplace || "",
          startedAt: Date.now()
        }

        await persistWorkerSessionState(session)

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
        await persistWorkerSessionState(session)
      }
    })

    await markWorkerSessionStopped(session, loopResult.stopReason)

    if (loopResult.stopReason === "run_terminal") {
      const completion = await completeRunIfNeeded(session)
      if (!completion.ok) {
        const completionDetail =
          "statusText" in completion
            ? extractWorkerApiErrorDetail(completion)
            : { code: "", message: "" }
        workerLog(session, "warn", "run_complete_failed", {
          status: completion.status,
          error_code: completionDetail.code || null,
          error_message: completionDetail.message || null
        })
      }
    }

    logger.info("Worker loop stopped", {
      feature: "worker",
      domain: "run-loop",
      step: "worker.loop.stop",
      runId: session.runId,
      workerId: session.workerId,
      stopReason: loopResult.stopReason
    })

    workerLog(session, "log", "worker.loop.stop", {
      stop_reason: loopResult.stopReason
    })

    await sendBridgeWorkerEvent(session.sourceTabId, "run_finished", {
      run_id: session.runId,
      worker_id: session.workerId,
      ok: true,
      stats: session.stats,
      stop_reason: loopResult.stopReason
    })

    workerLog(session, "log", "run_finished", {
      stats: session.stats
    })
  } finally {
    clearInterval(stallWatchdog)
    session.progress.activeOrder = null
  }
}

const startRunWorkerInternal = async (args: {
  message: RuntimeRunWorkerRequest | RuntimeSingleRequest
  senderTabId?: number | null
  settings: PowermaxxSettings
  resumeState?: PersistedWorkerState | null
}) => {
  const { message, senderTabId, settings, resumeState } = args

  const token = settings.auth.token || ""
  const baseUrl = settings.auth.baseUrl || ""
  const runId = normalizeWorkerRunId(
    message.runId || message.run_id || resumeState?.run_id
  )
  const workerId = normalizeWorkerId(
    message.workerId || message.worker_id || resumeState?.worker_id,
    senderTabId
  )

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
    if (resumeState) {
      const failedSession: WorkerSession = {
        key: `${runId}:${workerId}`,
        runId,
        workerId,
        token,
        baseUrl,
        mode: normalizeWorkerMode(message.mode || resumeState.mode),
        action: normalizeWorkerAction(message.action || resumeState.action),
        apiPaths: buildWorkerApiPaths(resumeState.api_paths || {}),
        completeOnFinish: Boolean(resumeState.complete_on_finish),
        heartbeatIntervalMs: normalizePositiveInt(
          resumeState.heartbeat_ms,
          DEFAULT_WORKER_HEARTBEAT_MS,
          5000,
          30000
        ),
        orderTimeoutMs: normalizePositiveInt(
          resumeState.order_timeout_ms,
          DEFAULT_WORKER_ORDER_TIMEOUT_MS,
          60000,
          600000
        ),
        requestTimeoutMs: normalizePositiveInt(
          resumeState.request_timeout_ms,
          DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
          5000,
          120000
        ),
        stallDetectionMs: normalizePositiveInt(
          resumeState.stall_detection_ms,
          DEFAULT_WORKER_STALL_DETECTION_MS,
          MIN_WORKER_STALL_DETECTION_MS,
          MAX_WORKER_STALL_DETECTION_MS
        ),
        sourceTabId: resumeState.source_tab_id || null,
        extensionVersion: chrome.runtime.getManifest()?.version || "unknown",
        stopRequested: false,
        stopReason: "fatal_config",
        lastClaimAt: resumeState.last_claim_at || null,
        lastPollAt: Date.now(),
        lastError: "Sesi login belum tersedia untuk resume worker.",
        reportedOrders: new Set(),
        progress: {
          lastProgressAt: Date.now(),
          stallReportedAt: null,
          activeOrder: null
        },
        stats: resumeState.stats || {
          claimed: 0,
          processed: 0,
          success: 0,
          failed: 0,
          timed_out: 0,
          report_failed: 0
        }
      }
      await persistWorkerSessionState(failedSession)
    }

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
    if (resumeState) {
      const failedSession: WorkerSession = {
        key: `${runId}:${workerId}`,
        runId,
        workerId,
        token,
        baseUrl,
        mode: normalizeWorkerMode(message.mode || resumeState.mode),
        action: normalizeWorkerAction(message.action || resumeState.action),
        apiPaths: buildWorkerApiPaths(resumeState.api_paths || {}),
        completeOnFinish: Boolean(resumeState.complete_on_finish),
        heartbeatIntervalMs: normalizePositiveInt(
          resumeState.heartbeat_ms,
          DEFAULT_WORKER_HEARTBEAT_MS,
          5000,
          30000
        ),
        orderTimeoutMs: normalizePositiveInt(
          resumeState.order_timeout_ms,
          DEFAULT_WORKER_ORDER_TIMEOUT_MS,
          60000,
          600000
        ),
        requestTimeoutMs: normalizePositiveInt(
          resumeState.request_timeout_ms,
          DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
          5000,
          120000
        ),
        stallDetectionMs: normalizePositiveInt(
          resumeState.stall_detection_ms,
          DEFAULT_WORKER_STALL_DETECTION_MS,
          MIN_WORKER_STALL_DETECTION_MS,
          MAX_WORKER_STALL_DETECTION_MS
        ),
        sourceTabId: resumeState.source_tab_id || null,
        extensionVersion: chrome.runtime.getManifest()?.version || "unknown",
        stopRequested: false,
        stopReason: "fatal_config",
        lastClaimAt: resumeState.last_claim_at || null,
        lastPollAt: Date.now(),
        lastError: "Base URL belum diatur untuk resume worker.",
        reportedOrders: new Set(),
        progress: {
          lastProgressAt: Date.now(),
          stallReportedAt: null,
          activeOrder: null
        },
        stats: resumeState.stats || {
          claimed: 0,
          processed: 0,
          success: 0,
          failed: 0,
          timed_out: 0,
          report_failed: 0
        }
      }
      await persistWorkerSessionState(failedSession)
    }

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

  if (
    activeRunWorkerByKey.has(workerKey) ||
    activeRunWorkerByRunId.has(runId)
  ) {
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
    ...(isObject(resumeState?.api_paths) ? resumeState?.api_paths : {}),
    ...(isObject(message.apiPaths) ? message.apiPaths : {}),
    ...(isObject(message.api_paths) ? message.api_paths : {})
  }

  const completeOnFinish =
    Boolean(message.completeOnFinish) ||
    Boolean(message.complete_on_finish) ||
    Boolean(resumeState?.complete_on_finish)

  const heartbeatIntervalMs = normalizePositiveInt(
    message.heartbeatMs ??
      message.heartbeat_interval_ms ??
      resumeState?.heartbeat_ms,
    DEFAULT_WORKER_HEARTBEAT_MS,
    5000,
    30000
  )

  const orderTimeoutMs = normalizePositiveInt(
    message.orderTimeoutMs ??
      message.order_timeout_ms ??
      resumeState?.order_timeout_ms,
    DEFAULT_WORKER_ORDER_TIMEOUT_MS,
    60000,
    600000
  )

  const requestTimeoutMs = normalizePositiveInt(
    message.requestTimeoutMs ??
      message.request_timeout_ms ??
      resumeState?.request_timeout_ms,
    DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
    5000,
    120000
  )

  const computedStallTimeoutMs = Math.max(
    DEFAULT_WORKER_STALL_DETECTION_MS,
    orderTimeoutMs + requestTimeoutMs + heartbeatIntervalMs * 2
  )

  const stallDetectionMs = normalizePositiveInt(
    message.stallDetectionMs ??
      message.stall_detection_ms ??
      resumeState?.stall_detection_ms,
    computedStallTimeoutMs,
    MIN_WORKER_STALL_DETECTION_MS,
    MAX_WORKER_STALL_DETECTION_MS
  )

  const mode = normalizeWorkerMode(message.mode || resumeState?.mode)
  const action = normalizeWorkerAction(message.action || resumeState?.action)

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
    sourceTabId:
      senderTabId !== undefined
        ? senderTabId
        : resumeState?.source_tab_id ?? null,
    extensionVersion: chrome.runtime.getManifest()?.version || "unknown",
    stopRequested: false,
    stopReason: null,
    lastClaimAt: resumeState?.last_claim_at ?? null,
    lastPollAt: resumeState?.last_poll_at ?? null,
    lastError: String(resumeState?.last_error || "").trim(),
    reportedOrders: await loadPersistedReportedOrders(runId),
    progress: {
      lastProgressAt: Date.now(),
      stallReportedAt: null,
      activeOrder: null
    },
    stats: {
      claimed: Number(resumeState?.stats?.claimed || 0),
      processed: Number(resumeState?.stats?.processed || 0),
      success: Number(resumeState?.stats?.success || 0),
      failed: Number(resumeState?.stats?.failed || 0),
      timed_out: Number(resumeState?.stats?.timed_out || 0),
      report_failed: Number(resumeState?.stats?.report_failed || 0)
    }
  }

  activeRunWorkerByKey.set(workerKey, session)
  activeRunWorkerByRunId.set(runId, workerKey)
  await persistWorkerSessionState(session)

  // Delay worker start to ensure runtime response is posted first.
  setTimeout(() => {
    runWorkerLoop(session, settings)
      .catch(async (error) => {
        const errorMessage = sanitizeErrorMessage(
          (error as Error)?.message || error
        )
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

        session.lastError = errorMessage
        await markWorkerSessionStopped(session, "unrecoverable_error")

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

export const startRunWorker = async (args: {
  message: RuntimeRunWorkerRequest | RuntimeSingleRequest
  senderTabId?: number | null
  settings: PowermaxxSettings
}) => startRunWorkerInternal(args)

export const stopRunWorker = async (args: { runId: string }) => {
  const runId = normalizeWorkerRunId(args.runId)
  const workerKey = activeRunWorkerByRunId.get(runId)

  if (!workerKey) {
    return {
      ok: false,
      error: "Worker run tidak ditemukan atau sudah berhenti."
    }
  }

  const session = activeRunWorkerByKey.get(workerKey)
  if (!session) {
    return {
      ok: false,
      error: "Worker session tidak ditemukan."
    }
  }

  session.stopRequested = true
  session.stopReason = "user_stop"
  await persistWorkerSessionState(session)

  return {
    ok: true,
    error: "",
    runId: session.runId,
    workerId: session.workerId
  }
}

export const resumePersistedRunWorkers = async (args: {
  settings: PowermaxxSettings
}) => {
  const { settings } = args
  const registry = pruneWorkerRunStateRegistry(
    await loadWorkerRunStateRegistry()
  )
  await saveWorkerRunStateRegistry(registry)

  const resumableSessions = selectResumableRunStates(Object.values(registry))

  let resumed = 0
  let skipped = 0

  for (const entry of resumableSessions) {
    const runId = normalizeWorkerRunId(entry.run_id)
    if (!runId) {
      skipped += 1
      continue
    }

    if (activeRunWorkerByRunId.has(runId)) {
      skipped += 1
      continue
    }

    const response = await startRunWorkerInternal({
      message: {
        type: "POWERMAXX_RUN_WORKER",
        action: entry.action,
        mode: entry.mode,
        runId: entry.run_id,
        workerId: entry.worker_id,
        apiPaths: entry.api_paths || {},
        heartbeatMs: entry.heartbeat_ms,
        orderTimeoutMs: entry.order_timeout_ms,
        requestTimeoutMs: entry.request_timeout_ms,
        stallDetectionMs: entry.stall_detection_ms,
        completeOnFinish: entry.complete_on_finish,
        orders: []
      },
      senderTabId: entry.source_tab_id,
      settings,
      resumeState: entry
    })

    if (response.ok) {
      resumed += 1
      continue
    }

    skipped += 1
  }

  if (resumed > 0 || skipped > 0) {
    logger.info("Worker resume from storage executed", {
      feature: "worker",
      domain: "resume",
      step: "resume.persisted",
      resumed,
      skipped
    })
  }

  return {
    resumed,
    skipped
  }
}
