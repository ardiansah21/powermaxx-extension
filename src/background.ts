import { logger } from "~src/core/logging/logger"
import type {
  ActionMode,
  RuntimeBridgeHealthResponse,
  RuntimeBatchWorkerRequest,
  RuntimeRequestMessage,
  RuntimeStopBatchWorkerRequest
} from "~src/core/messages/contracts"
import { normalizeBridgeAction } from "~src/core/messages/guards"
import { normalizeBaseUrl, SETTINGS_KEY } from "~src/core/settings/schema"
import {
  clearAuthSession,
  loadSettings,
  updateAuthSession
} from "~src/core/settings/storage"
import { executeAwbOnActiveMarketplaceTab } from "~src/features/awb/background/run-awb"
import {
  bindBridgeAutoInjection,
  ensureBridgeForBaseUrls
} from "~src/features/bridge/background/bridge-register"
import { injectBridgeScriptToTab } from "~src/features/bridge/background/bridge-injector"
import {
  buildExportPayload,
  extractPowermaxxOrderId,
  extractPowermaxxOrderNo,
  formatExportFailureMessage,
  sendExport
} from "~src/features/fetch-send/background/export-client"
import {
  bindMarketplaceTabTrackers,
  executeFetchOnlyOnActiveMarketplaceTab,
  executeFetchSendOnActiveMarketplaceTab,
  resolveMarketplaceTab
} from "~src/features/fetch-send/background/run-fetch-send"
import {
  loadViewerPayload,
  saveViewerPayload
} from "~src/features/viewer/shared/storage"
import {
  resumePersistedBatchWorkers,
  startBatchWorker,
  stopBatchWorker
} from "~src/features/worker/background/batch-worker"

const syncBridgeFromSettings = async () => {
  const settings = await loadSettings()
  const urls = [
    settings.auth.baseUrl,
    settings.marketplaces.shopee.baseUrl,
    settings.marketplaces.tiktok_shop.baseUrl
  ]

  await ensureBridgeForBaseUrls(urls)
}

const BRIDGE_STATUS_CACHE_KEY = "pmxBridgeStatusCacheV1"

type BridgeStatusCachePayload = {
  baseUrl: string
  status: "active" | "inactive"
  reason: string
  checkedAt: number
}

const saveBridgeStatusCache = async (
  payload: BridgeStatusCachePayload
): Promise<void> => {
  if (!chrome.storage?.local) {
    return
  }

  await new Promise<void>((resolve) => {
    chrome.storage.local.set(
      {
        [BRIDGE_STATUS_CACHE_KEY]: payload
      },
      () => resolve()
    )
  })
}

const buildTabUrlPattern = (baseUrl: string) => {
  try {
    const origin = new URL(baseUrl).origin
    return `${origin}/*`
  } catch (_error) {
    return ""
  }
}

const findPowermaxxTab = async (baseUrl: string) => {
  const pattern = buildTabUrlPattern(baseUrl)
  if (!pattern) return null

  const tabs = await chrome.tabs.query({ url: [pattern] })

  return tabs.find((tab) => typeof tab.id === "number") || null
}

const probeBridgeReady = async (tabId: number) => {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => Boolean((window as any).__pmxExtensionBridgeReady)
    })

    return Boolean(results?.[0]?.result)
  } catch (_error) {
    return false
  }
}

const resolvePopupBridgeStatus = async (
  attemptRepair: boolean
): Promise<RuntimeBridgeHealthResponse> => {
  const settings = await loadSettings()
  const baseUrl = normalizeBaseUrl(settings.auth.baseUrl || "")

  const finalize = async (response: RuntimeBridgeHealthResponse) => {
    await saveBridgeStatusCache({
      baseUrl,
      status: response.status,
      reason: String(response.reason || ""),
      checkedAt: Date.now()
    })

    return response
  }

  if (!baseUrl) {
    return finalize({
      ok: true,
      status: "inactive",
      reason: "Base URL belum diatur."
    })
  }

  if (attemptRepair) {
    const matches = await ensureBridgeForBaseUrls([baseUrl])
    if (!matches.length) {
      return finalize({
        ok: true,
        status: "inactive",
        reason: "Host permission belum aktif untuk Base URL ini."
      })
    }
  }

  const tab = await findPowermaxxTab(baseUrl)
  const tabId = tab?.id

  if (typeof tabId !== "number") {
    return finalize({
      ok: true,
      status: "inactive",
      reason: "Tab Powermaxx belum terbuka."
    })
  }

  try {
    await injectBridgeScriptToTab(tabId)
  } catch (_error) {
    return finalize({
      ok: true,
      status: "inactive",
      tabId,
      url: String(tab?.url || ""),
      reason: "Gagal inject bridge ke tab Powermaxx."
    })
  }

  const ready = await probeBridgeReady(tabId)
  if (ready) {
    return finalize({
      ok: true,
      status: "active",
      tabId,
      url: String(tab?.url || "")
    })
  }

  return finalize({
    ok: true,
    status: "inactive",
    tabId,
    url: String(tab?.url || ""),
    reason: attemptRepair
      ? "Bridge masih belum aktif. Buka tab Powermaxx lalu klik Perbaiki Bridge lagi."
      : "Bridge belum aktif di tab Powermaxx."
  })
}

const resumeWorkersFromStorage = async () => {
  try {
    const settings = await loadSettings()
    await resumePersistedBatchWorkers({ settings })
  } catch (error) {
    logger.warn("Failed to resume persisted workers", {
      feature: "worker",
      domain: "resume",
      step: "bootstrap",
      error: String((error as Error)?.message || error)
    })
  }
}

const isUnauthenticated = (
  status: number,
  data: Record<string, unknown> | null,
  rawText: string
) => {
  if ([401, 403, 419].includes(status)) return true
  const message = String((data?.message as string) || "").toLowerCase()
  const raw = String(rawText || "").toLowerCase()
  return message.includes("unauthenticated") || raw.includes("unauthenticated")
}

const buildDeviceName = (email: string) => {
  const clean = String(email || "").trim()
  return clean ? `${clean}-powermaxx_extension` : "powermaxx-extension"
}

const parseJsonMaybe = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch (_error) {
    return null
  }
}

const fetchProfile = async (baseUrl: string, token: string) => {
  const response = await fetch(`${baseUrl}/api/user`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`
    }
  })

  const raw = await response.text()
  const data = parseJsonMaybe(raw)

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data
    }
  }

  return {
    ok: true,
    status: response.status,
    data
  }
}

const storeViewerFromFetchResult = async (args: {
  marketplace: "shopee" | "tiktok_shop"
  actionMode: "fetch_send" | "update_order" | "update_income"
  orderId?: string
  fetchResult?: {
    orderRawJson?: Record<string, unknown> | null
    incomeRawJson?: Record<string, unknown> | null
    incomeDetailRawJson?: Record<string, unknown> | null
    fetchMeta?: Record<string, unknown>
  }
}) => {
  const fetchResult = args.fetchResult
  if (!fetchResult) return

  await saveViewerPayload({
    updatedAt: Date.now(),
    marketplace: args.marketplace,
    actionMode: args.actionMode,
    orderId: String(args.orderId || "").trim(),
    orderRawJson: fetchResult.orderRawJson || null,
    incomeRawJson: fetchResult.incomeRawJson || null,
    incomeDetailRawJson: fetchResult.incomeDetailRawJson || null,
    fetchMeta: fetchResult.fetchMeta || {}
  })
}

const normalizeOrderIdentifier = (value: unknown) => {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return ""
  return String(value).trim()
}

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const deriveOrderIdentifierFromFetch = (args: {
  marketplace: "shopee" | "tiktok_shop"
  fetchResult?: {
    orderRawJson?: Record<string, unknown> | null
    incomeRawJson?: Record<string, unknown> | null
    incomeDetailRawJson?: Record<string, unknown> | null
    fetchMeta?: Record<string, unknown>
  }
}) => {
  const orderRaw = args.fetchResult?.orderRawJson || null
  const incomeRaw = args.fetchResult?.incomeRawJson || null
  const orderData = toRecord(orderRaw?.data)
  const incomeData = toRecord(incomeRaw?.data)

  if (args.marketplace === "shopee") {
    const orderInfo = toRecord(incomeData?.order_info)
    return (
      normalizeOrderIdentifier(orderData?.order_id) ||
      normalizeOrderIdentifier(orderData?.order_sn) ||
      normalizeOrderIdentifier(orderInfo?.order_id) ||
      normalizeOrderIdentifier(orderInfo?.order_sn) ||
      ""
    )
  }

  const mainOrderList = Array.isArray(orderData?.main_order)
    ? (orderData.main_order as Array<Record<string, unknown>>)
    : []
  const mainOrder = mainOrderList.length ? toRecord(mainOrderList[0]) : null

  const orderRecords = Array.isArray(incomeData?.order_records)
    ? (incomeData.order_records as Array<Record<string, unknown>>)
    : []
  const firstOrderRecord = orderRecords.length
    ? toRecord(orderRecords[0])
    : null

  return (
    normalizeOrderIdentifier(mainOrder?.main_order_id) ||
    normalizeOrderIdentifier(firstOrderRecord?.reference_id) ||
    normalizeOrderIdentifier(firstOrderRecord?.trade_order_id) ||
    ""
  )
}

const buildPowermaxxOrderUrl = (baseUrl: string, orderId: string) => {
  const cleanBase = normalizeBaseUrl(baseUrl)
  const cleanOrderId = normalizeOrderIdentifier(orderId)
  if (!cleanBase || !cleanOrderId) return ""
  return `${cleanBase}/admin/orders/${encodeURIComponent(cleanOrderId)}`
}

const handlePopupLogin = async (message: RuntimeRequestMessage) => {
  if (message.type !== "POWERMAXX_POPUP_LOGIN") {
    return {
      ok: false,
      error: "Invalid message type."
    }
  }

  const baseUrl = normalizeBaseUrl(message.baseUrl || "")
  const email = String(message.email || "").trim()
  const password = String(message.password || "")

  if (!baseUrl) {
    return {
      ok: false,
      error: "Base URL wajib diisi."
    }
  }

  if (!email) {
    return {
      ok: false,
      error: "Email wajib diisi."
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      error: "Format email tidak valid."
    }
  }

  if (!password) {
    return {
      ok: false,
      error: "Password wajib diisi."
    }
  }

  const deviceName = buildDeviceName(email)
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      email,
      password,
      device_name: deviceName
    })
  })

  const raw = await response.text()
  const data = parseJsonMaybe(raw)

  if (!response.ok) {
    return {
      ok: false,
      error: `Login gagal ${response.status}: ${response.statusText || "Error"}`
    }
  }

  const token = String(
    (data?.token as string) || (data?.access_token as string) || ""
  ).trim()

  if (!token) {
    return {
      ok: false,
      error: "Token tidak ditemukan di response login."
    }
  }

  let profile = (data?.user as Record<string, unknown>) || null
  if (!profile) {
    const profileResponse = await fetchProfile(baseUrl, token)
    if (profileResponse.ok) {
      profile = profileResponse.data
    }
  }

  const next = await updateAuthSession({
    baseUrl,
    token,
    email,
    deviceName,
    profile
  })

  await ensureBridgeForBaseUrls([baseUrl])

  return {
    ok: true,
    error: "",
    loggedIn: true,
    email: next.auth.email,
    hasProfile: Boolean(next.auth.profile)
  }
}

const handlePopupLogout = async (message: RuntimeRequestMessage) => {
  if (message.type !== "POWERMAXX_POPUP_LOGOUT") {
    return {
      ok: false,
      error: "Invalid message type."
    }
  }

  const settings = await loadSettings()
  const baseUrl = normalizeBaseUrl(settings.auth.baseUrl || "")
  const token = String(settings.auth.token || "").trim()

  if (baseUrl && token) {
    try {
      const response = await fetch(`${baseUrl}/api/logout`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`
        }
      })

      const raw = await response.text()
      const data = parseJsonMaybe(raw)
      if (isUnauthenticated(response.status, data, raw)) {
        // Session already invalid server-side; continue clearing local session.
      }
    } catch (_error) {
      // Continue clearing local session for consistent logout UX.
    }
  }

  await clearAuthSession()

  return {
    ok: true,
    error: "",
    loggedIn: false
  }
}

const handlePopupFetchSend = async (message: RuntimeRequestMessage) => {
  if (message.type !== "POWERMAXX_POPUP_FETCH_SEND") {
    return {
      ok: false,
      error: "Invalid message type."
    }
  }

  const settings = await loadSettings()
  const result = await executeFetchSendOnActiveMarketplaceTab(
    message.actionMode,
    settings
  )

  if (
    result.fetchResult &&
    (result.marketplace === "shopee" || result.marketplace === "tiktok_shop")
  ) {
    void storeViewerFromFetchResult({
      marketplace: result.marketplace,
      actionMode: message.actionMode,
      orderId: result.orderId,
      fetchResult: result.fetchResult
    })
  }

  return {
    ok: Boolean(result.ok),
    error: result.error || "",
    mode: "single",
    count: 1,
    running: false,
    orderId: result.orderId || "",
    orderNo: result.orderNo || "",
    openUrl: result.openUrl || ""
  }
}

const handlePopupFetchOnly = async (message: RuntimeRequestMessage) => {
  if (message.type !== "POWERMAXX_POPUP_FETCH_ONLY") {
    return {
      ok: false,
      error: "Invalid message type."
    }
  }

  const settings = await loadSettings()
  const actionMode: ActionMode = message.actionMode || "fetch_send"
  const result = await executeFetchOnlyOnActiveMarketplaceTab(
    actionMode,
    settings
  )

  if (
    result.fetchResult &&
    (result.marketplace === "shopee" || result.marketplace === "tiktok_shop")
  ) {
    const orderId =
      deriveOrderIdentifierFromFetch({
        marketplace: result.marketplace,
        fetchResult: result.fetchResult
      }) || result.orderId

    void storeViewerFromFetchResult({
      marketplace: result.marketplace,
      actionMode,
      orderId,
      fetchResult: result.fetchResult
    })
  }

  return {
    ok: Boolean(result.ok),
    error: result.error || "",
    mode: "single",
    count: 1,
    running: false,
    fetchedOnly: true
  }
}

const handlePopupDownloadAwb = async (message: RuntimeRequestMessage) => {
  if (message.type !== "POWERMAXX_POPUP_DOWNLOAD_AWB") {
    return {
      ok: false,
      error: "Invalid message type."
    }
  }

  const settings = await loadSettings()
  const awbResult = await executeAwbOnActiveMarketplaceTab(settings)

  return {
    ok: Boolean(awbResult.ok),
    error: awbResult.error || "",
    mode: "single",
    count: 1,
    running: false,
    openUrl: awbResult.openUrl || "",
    awbOk: Boolean(awbResult.ok),
    awb: awbResult
  }
}

const handlePopupFetchSendAwb = async (message: RuntimeRequestMessage) => {
  if (message.type !== "POWERMAXX_POPUP_FETCH_SEND_AWB") {
    return {
      ok: false,
      error: "Invalid message type."
    }
  }

  const settings = await loadSettings()
  const fetchResult = await executeFetchSendOnActiveMarketplaceTab(
    "fetch_send",
    settings
  )
  const awbResult = await executeAwbOnActiveMarketplaceTab(settings)

  if (
    fetchResult.fetchResult &&
    (fetchResult.marketplace === "shopee" ||
      fetchResult.marketplace === "tiktok_shop")
  ) {
    void storeViewerFromFetchResult({
      marketplace: fetchResult.marketplace,
      actionMode: "fetch_send",
      orderId: fetchResult.orderId,
      fetchResult: fetchResult.fetchResult
    })
  }

  const errors = [
    fetchResult.ok ? "" : fetchResult.error,
    awbResult.ok ? "" : awbResult.error
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)

  return {
    ok: Boolean(fetchResult.ok && awbResult.ok),
    error: errors.join(" | "),
    mode: "single",
    count: 1,
    running: false,
    orderId: fetchResult.orderId || "",
    orderNo: fetchResult.orderNo || "",
    openUrl: fetchResult.openUrl || awbResult.openUrl || "",
    fetchOk: Boolean(fetchResult.ok),
    awbOk: Boolean(awbResult.ok),
    awb: awbResult
  }
}

const handlePopupSendViewer = async (message: RuntimeRequestMessage) => {
  if (message.type !== "POWERMAXX_POPUP_SEND_VIEWER") {
    return {
      ok: false,
      error: "Invalid message type."
    }
  }

  const settings = await loadSettings()
  const token = String(settings.auth.token || "").trim()
  const baseUrl = normalizeBaseUrl(settings.auth.baseUrl || "")

  if (!token) {
    return {
      ok: false,
      error: "Sesi login belum tersedia. Login dulu di popup."
    }
  }

  if (!baseUrl) {
    return {
      ok: false,
      error: "Base URL belum diatur."
    }
  }

  const viewerPayload = await loadViewerPayload()
  if (!viewerPayload) {
    return {
      ok: false,
      error:
        "Belum ada data viewer. Jalankan Fetch + Send atau buka Viewer untuk auto-fetch."
    }
  }

  if (
    viewerPayload.marketplace !== "shopee" &&
    viewerPayload.marketplace !== "tiktok_shop"
  ) {
    return {
      ok: false,
      error: "Marketplace viewer tidak valid."
    }
  }

  if (!viewerPayload.orderRawJson && !viewerPayload.incomeRawJson) {
    return {
      ok: false,
      error:
        "Payload viewer kosong. Klik Refresh di Viewer untuk auto-fetch dari tab marketplace aktif."
    }
  }

  const exportPayload = buildExportPayload(viewerPayload.marketplace, {
    orderRawJson: viewerPayload.orderRawJson || null,
    incomeRawJson: viewerPayload.incomeRawJson || null,
    incomeDetailRawJson: viewerPayload.incomeDetailRawJson || null
  })

  const exportResult = await sendExport(baseUrl, token, exportPayload)

  if (exportResult.unauthenticated) {
    await clearAuthSession()
    return {
      ok: false,
      error: "Sesi login tidak valid atau kadaluarsa. Login ulang.",
      mode: "single",
      count: 1,
      running: false
    }
  }

  const orderId = extractPowermaxxOrderId(exportResult.data)
  const orderNo = extractPowermaxxOrderNo(exportResult.data)

  return {
    ok: Boolean(exportResult.ok),
    error: exportResult.ok ? "" : formatExportFailureMessage(exportResult),
    mode: "single",
    count: 1,
    running: false,
    orderId,
    orderNo,
    openUrl: buildPowermaxxOrderUrl(baseUrl, orderId)
  }
}

const handleBatchWorker = async (
  message: RuntimeBatchWorkerRequest,
  senderTabId?: number | null
) => {
  const settings = await loadSettings()
  const action = normalizeBridgeAction(message.action) || "update_both"

  return startBatchWorker({
    message: {
      ...message,
      action
    },
    senderTabId,
    settings
  })
}

const handleStopBatchWorker = async (message: RuntimeStopBatchWorkerRequest) => {
  const batchId = String(message.batchId || message.batch_id || "").trim()

  if (!batchId) {
    return {
      ok: false,
      error: "batch_id wajib diisi untuk stop worker."
    }
  }

  return stopBatchWorker({ batchId })
}

const onRuntimeMessage = (
  message: RuntimeRequestMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return
  }

  const senderTabId = sender?.tab?.id || null

  const reply = (promise: Promise<any>) => {
    promise
      .then((payload) => sendResponse(payload))
      .catch((error) => {
        logger.error("Runtime handler failed", {
          feature: "background",
          domain: "runtime",
          step: "handler",
          type: (message as RuntimeRequestMessage).type,
          error: String((error as Error)?.message || error)
        })

        sendResponse({
          ok: false,
          error: String((error as Error)?.message || error)
        })
      })
  }

  if (message.type === "POWERMAXX_GET_TARGET_TAB") {
    reply(
      resolveMarketplaceTab().then(({ tabId, url }) => {
        if (!tabId) {
          return {
            ok: false,
            error:
              "Tidak menemukan tab marketplace (Shopee/TikTok Shop). Fokus dulu ke tab seller, lalu coba lagi."
          }
        }

        return { ok: true, tabId, url }
      })
    )
    return true
  }

  if (message.type === "POWERMAXX_BRIDGE_REGISTER") {
    const baseUrls = Array.isArray(message.baseUrls)
      ? message.baseUrls
      : [message.baseUrl || ""]

    reply(
      ensureBridgeForBaseUrls(baseUrls).then((matches) => ({
        ok: true,
        matches
      }))
    )

    return true
  }

  if (message.type === "POWERMAXX_POPUP_LOGIN") {
    reply(handlePopupLogin(message))
    return true
  }

  if (message.type === "POWERMAXX_POPUP_LOGOUT") {
    reply(handlePopupLogout(message))
    return true
  }

  if (message.type === "POWERMAXX_POPUP_BRIDGE_STATUS") {
    reply(resolvePopupBridgeStatus(false))
    return true
  }

  if (message.type === "POWERMAXX_POPUP_BRIDGE_REPAIR") {
    reply(resolvePopupBridgeStatus(true))
    return true
  }

  if (message.type === "POWERMAXX_POPUP_FETCH_SEND") {
    reply(handlePopupFetchSend(message))
    return true
  }

  if (message.type === "POWERMAXX_POPUP_FETCH_ONLY") {
    reply(handlePopupFetchOnly(message))
    return true
  }

  if (message.type === "POWERMAXX_POPUP_DOWNLOAD_AWB") {
    reply(handlePopupDownloadAwb(message))
    return true
  }

  if (message.type === "POWERMAXX_POPUP_FETCH_SEND_AWB") {
    reply(handlePopupFetchSendAwb(message))
    return true
  }

  if (message.type === "POWERMAXX_POPUP_SEND_VIEWER") {
    reply(handlePopupSendViewer(message))
    return true
  }

  if (message.type === "POWERMAXX_BATCH_WORKER") {
    reply(handleBatchWorker(message, senderTabId))
    return true
  }

  if (message.type === "POWERMAXX_STOP_BATCH_WORKER") {
    reply(handleStopBatchWorker(message))
    return true
  }
}

chrome.runtime.onMessage.addListener(onRuntimeMessage)

chrome.runtime.onInstalled.addListener(() => {
  void syncBridgeFromSettings()
  void resumeWorkersFromStorage()
})

chrome.runtime.onStartup.addListener(() => {
  void syncBridgeFromSettings()
  void resumeWorkersFromStorage()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return
  if (!changes?.[SETTINGS_KEY]) return

  void syncBridgeFromSettings()
})

bindMarketplaceTabTrackers()
bindBridgeAutoInjection()

void syncBridgeFromSettings()
void resumeWorkersFromStorage()

logger.info("Powermaxx background initialized", {
  feature: "background",
  domain: "bootstrap",
  step: "ready"
})
