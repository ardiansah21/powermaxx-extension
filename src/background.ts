import { logger } from "~src/core/logging/logger"
import { normalizeBridgeAction } from "~src/core/messages/guards"
import type {
  RuntimeBulkRequest,
  RuntimeRequestMessage,
  RuntimeRunWorkerRequest,
  RuntimeSingleRequest
} from "~src/core/messages/contracts"
import { executeAwbOnActiveMarketplaceTab } from "~src/features/awb/background/run-awb"
import { bindMarketplaceTabTrackers, executeFetchSendOnActiveMarketplaceTab, resolveMarketplaceTab } from "~src/features/fetch-send/background/run-fetch-send"
import { bindBridgeAutoInjection, ensureBridgeForBaseUrls } from "~src/features/bridge/background/bridge-register"
import { runBulkHeadless } from "~src/features/bulk/background/run-bulk"
import {
  clearAuthSession,
  loadSettings,
  updateAuthSession
} from "~src/core/settings/storage"
import { SETTINGS_KEY, normalizeBaseUrl } from "~src/core/settings/schema"
import { saveViewerPayload } from "~src/features/viewer/shared/storage"
import { startRunWorker } from "~src/features/worker/background/run-worker"

const syncBridgeFromSettings = async () => {
  const settings = await loadSettings()
  const urls = [
    settings.auth.baseUrl,
    settings.marketplaces.shopee.baseUrl,
    settings.marketplaces.tiktok_shop.baseUrl
  ]

  await ensureBridgeForBaseUrls(urls)
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

  if (result.fetchResult && (result.marketplace === "shopee" || result.marketplace === "tiktok_shop")) {
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
    openUrl: result.openUrl || ""
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

  if (fetchResult.fetchResult && (fetchResult.marketplace === "shopee" || fetchResult.marketplace === "tiktok_shop")) {
    void storeViewerFromFetchResult({
      marketplace: fetchResult.marketplace,
      actionMode: "fetch_send",
      orderId: fetchResult.orderId,
      fetchResult: fetchResult.fetchResult
    })
  }

  const errors = [fetchResult.ok ? "" : fetchResult.error, awbResult.ok ? "" : awbResult.error]
    .map((value) => String(value || "").trim())
    .filter(Boolean)

  return {
    ok: Boolean(fetchResult.ok && awbResult.ok),
    error: errors.join(" | "),
    mode: "single",
    count: 1,
    running: false,
    orderId: fetchResult.orderId || "",
    openUrl: fetchResult.openUrl || awbResult.openUrl || "",
    fetchOk: Boolean(fetchResult.ok),
    awbOk: Boolean(awbResult.ok),
    awb: awbResult
  }
}

const handleSingle = async (
  message: RuntimeSingleRequest,
  senderTabId?: number | null
) => {
  if (!message.runId && !message.run_id) {
    return {
      ok: false,
      error: "Mode single bridge wajib menyertakan run_id.",
      running: false,
      runId: "",
      workerId: "",
      mode: "single"
    }
  }

  const settings = await loadSettings()
  const action = normalizeBridgeAction(message.action) || "update_both"

  return startRunWorker({
    message: {
      ...message,
      action,
      mode: "single"
    },
    senderTabId,
    settings
  })
}

const handleRunWorker = async (
  message: RuntimeRunWorkerRequest,
  senderTabId?: number | null
) => {
  const settings = await loadSettings()
  const action = normalizeBridgeAction(message.action) || "update_both"

  return startRunWorker({
    message: {
      ...message,
      action
    },
    senderTabId,
    settings
  })
}

const handleBulk = async (
  message: RuntimeBulkRequest,
  senderTabId?: number | null
) => {
  const settings = await loadSettings()
  const action = normalizeBridgeAction(message.action) || "update_both"

  return runBulkHeadless({
    message: {
      ...message,
      action
    },
    senderTabId,
    settings
  })
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

  if (message.type === "POWERMAXX_POPUP_FETCH_SEND") {
    reply(handlePopupFetchSend(message))
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

  if (message.type === "POWERMAXX_SINGLE") {
    reply(handleSingle(message, senderTabId))
    return true
  }

  if (message.type === "POWERMAXX_RUN_WORKER") {
    reply(handleRunWorker(message, senderTabId))
    return true
  }

  if (message.type === "POWERMAXX_BULK") {
    reply(handleBulk(message, senderTabId))
    return true
  }
}

chrome.runtime.onMessage.addListener(onRuntimeMessage)

chrome.runtime.onInstalled.addListener(() => {
  void syncBridgeFromSettings()
})

chrome.runtime.onStartup.addListener(() => {
  void syncBridgeFromSettings()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return
  if (!changes?.[SETTINGS_KEY]) return

  void syncBridgeFromSettings()
})

bindMarketplaceTabTrackers()
bindBridgeAutoInjection()

void syncBridgeFromSettings()

logger.info("Powermaxx background initialized", {
  feature: "background",
  domain: "bootstrap",
  step: "ready"
})
