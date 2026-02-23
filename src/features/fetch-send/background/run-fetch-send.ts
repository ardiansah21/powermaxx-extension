import { logger } from "~src/core/logging/logger"
import {
  MARKETPLACE_TAB_URL_PATTERNS,
  buildOrderUrl,
  detectMarketplaceFromUrl,
  isMarketplaceUrl
} from "~src/core/marketplace"
import type {
  ActionMode,
  ContentFetchRequest,
  ContentFetchResponse,
  Marketplace,
  NormalizedOrder
} from "~src/core/messages/contracts"
import {
  DEFAULT_COMPONENTS,
  DEFAULT_SETTINGS,
  type PowermaxxSettings
} from "~src/core/settings/schema"
import { clearAuthSession } from "~src/core/settings/storage"
import {
  buildExportPayload,
  extractPowermaxxOrderId,
  sendExport,
  type FetchResultPayload
} from "~src/features/fetch-send/background/export-client"
import { resolveShopeeOrderId } from "~src/features/fetch-send/background/resolve-shopee-order-id"
import { runMarketplaceFetchInPage } from "~src/features/fetch-send/content/page-runner"

let lastMarketplaceTabId: number | null = null
let lastMarketplaceTabUrl = ""

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })

const isAllowedUrl = (url: string, marketplace: Exclude<Marketplace, "auto">) => {
  if (!url) return false
  if (marketplace === "shopee") return url.includes("seller.shopee.co.id")
  return url.includes("seller-id.tokopedia.com")
}

const waitForAllowedUrl = async (
  tabId: number,
  marketplace: Exclude<Marketplace, "auto">,
  fallbackUrl: string
) => {
  const timeoutMs = 30000
  const intervalMs = 400
  let elapsed = 0
  let lastUrl = ""

  while (elapsed <= timeoutMs) {
    const tabInfo = await chrome.tabs.get(tabId)
    const url = tabInfo?.url || tabInfo?.pendingUrl || ""

    if (url) lastUrl = url

    if (isAllowedUrl(url, marketplace)) {
      return url
    }

    if (
      !url &&
      tabInfo?.status === "complete" &&
      isAllowedUrl(fallbackUrl, marketplace)
    ) {
      return fallbackUrl
    }

    await sleep(intervalMs)
    elapsed += intervalMs
  }

  throw new Error(`URL bukan target marketplace. URL terakhir: ${lastUrl || fallbackUrl || "-"}`)
}

const rememberMarketplaceTab = async (tabId?: number | null) => {
  if (!tabId) return

  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab?.id || !isMarketplaceUrl(tab.url || "")) return

    lastMarketplaceTabId = tab.id
    lastMarketplaceTabUrl = tab.url || ""
  } catch (_error) {
    // ignore
  }
}

export const resolveMarketplaceTab = async () => {
  try {
    const activeTabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    })

    const activeTab = Array.isArray(activeTabs) ? activeTabs[0] : null

    if (activeTab?.id && isMarketplaceUrl(activeTab.url || "")) {
      lastMarketplaceTabId = activeTab.id
      lastMarketplaceTabUrl = activeTab.url || ""
      return { tabId: activeTab.id, url: activeTab.url || "" }
    }
  } catch (_error) {
    // ignore
  }

  if (lastMarketplaceTabId) {
    try {
      const tab = await chrome.tabs.get(lastMarketplaceTabId)
      if (tab?.id && isMarketplaceUrl(tab.url || "")) {
        lastMarketplaceTabUrl = tab.url || lastMarketplaceTabUrl
        return { tabId: tab.id, url: tab.url || "" }
      }
    } catch (_error) {
      lastMarketplaceTabId = null
      lastMarketplaceTabUrl = ""
    }
  }

  try {
    const tabs = await chrome.tabs.query({ url: MARKETPLACE_TAB_URL_PATTERNS })
    const first = Array.isArray(tabs) ? tabs.find((tab) => tab?.id) : null
    if (first?.id) {
      lastMarketplaceTabId = first.id
      lastMarketplaceTabUrl = first.url || ""
      return { tabId: first.id, url: first.url || "" }
    }
  } catch (_error) {
    // ignore
  }

  return { tabId: null, url: "" }
}

const getEndpoints = (
  settings: PowermaxxSettings,
  marketplace: Exclude<Marketplace, "auto">
) => {
  if (marketplace === "shopee") {
    return {
      incomeEndpoint:
        settings.marketplaces.shopee.incomeEndpoint ||
        DEFAULT_SETTINGS.marketplaces.shopee.incomeEndpoint,
      orderEndpoint:
        settings.marketplaces.shopee.orderEndpoint ||
        DEFAULT_SETTINGS.marketplaces.shopee.orderEndpoint,
      statementEndpoint: "",
      statementDetailEndpoint: ""
    }
  }

  return {
    incomeEndpoint: "",
    orderEndpoint:
      settings.marketplaces.tiktok_shop.orderEndpoint ||
      DEFAULT_SETTINGS.marketplaces.tiktok_shop.orderEndpoint,
    statementEndpoint:
      settings.marketplaces.tiktok_shop.statementEndpoint ||
      DEFAULT_SETTINGS.marketplaces.tiktok_shop.statementEndpoint,
    statementDetailEndpoint:
      settings.marketplaces.tiktok_shop.statementDetailEndpoint ||
      DEFAULT_SETTINGS.marketplaces.tiktok_shop.statementDetailEndpoint
  }
}

const sendContentFetchCommand = async (
  tabId: number,
  marketplace: Exclude<Marketplace, "auto">,
  actionMode: ActionMode,
  settings: PowermaxxSettings
): Promise<ContentFetchResponse> => {
  const payload: ContentFetchRequest = {
    type: "POWERMAXX_CONTENT_FETCH_SEND",
    request: {
      marketplace,
      actionMode,
      components: settings.components || DEFAULT_COMPONENTS,
      endpoints: getEndpoints(settings, marketplace)
    }
  }

  const response = await withTimeout(
    new Promise<ContentFetchResponse>((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, payload, (runtimeResponse) => {
        const runtimeError = chrome.runtime.lastError?.message || ""
        if (runtimeError) {
          reject(new Error(runtimeError))
          return
        }

        resolve(runtimeResponse as ContentFetchResponse)
      })
    }),
    45000,
    "Timeout menunggu response content script."
  )

  if (!response || typeof response !== "object") {
    throw new Error("Response content script kosong.")
  }

  return response
}

const fallbackFetchWithExecuteScript = async (
  tabId: number,
  marketplace: Exclude<Marketplace, "auto">,
  actionMode: ActionMode,
  settings: PowermaxxSettings
): Promise<ContentFetchResponse> => {
  const request = {
    marketplace,
    actionMode,
    components: settings.components || DEFAULT_COMPONENTS,
    endpoints: getEndpoints(settings, marketplace)
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: runMarketplaceFetchInPage,
    args: [request]
  })

  const payload = result?.result as ContentFetchResponse | undefined
  if (!payload) {
    throw new Error("Result executeScript kosong.")
  }

  return payload
}

const executeFetchFromTab = async (
  tabId: number,
  marketplace: Exclude<Marketplace, "auto">,
  actionMode: ActionMode,
  settings: PowermaxxSettings
) => {
  try {
    return await sendContentFetchCommand(tabId, marketplace, actionMode, settings)
  } catch (error) {
    logger.warn("Primary content message failed, using executeScript fallback", {
      feature: "fetch-send",
      domain: marketplace,
      step: "content-fallback",
      error: String((error as Error)?.message || error)
    })

    return withTimeout(
      fallbackFetchWithExecuteScript(tabId, marketplace, actionMode, settings),
      90000,
      "Timeout proses fallback executeScript."
    )
  }
}

export interface ExecuteFetchSendResult {
  ok: boolean
  error?: string
  marketplace: Exclude<Marketplace, "auto">
  actionMode: ActionMode
  fetchResult?: FetchResultPayload & {
    fetchMeta?: Record<string, unknown>
  }
  exportResult?: {
    ok: boolean
    status: number
    statusText: string
    body: string
    htmlSnippet: string
    url: string
  }
  orderId?: string
  openUrl?: string
}

export interface ExecuteFetchSendOrderInput {
  order: NormalizedOrder
  actionMode: ActionMode
  settings: PowermaxxSettings
  timeoutMs?: number
}

const normalizeOrderForExecution = async (
  input: ExecuteFetchSendOrderInput
): Promise<NormalizedOrder> => {
  const { order, settings } = input

  if (order.marketplace === "shopee" && order.idType === "order_sn") {
    const resolvedId = await resolveShopeeOrderId(
      order.id,
      settings.marketplaces.shopee.searchEndpoint
    )

    return {
      ...order,
      id: resolvedId,
      idType: "order_id"
    }
  }

  return order
}

export const executeFetchSendByOrder = async (
  input: ExecuteFetchSendOrderInput
): Promise<ExecuteFetchSendResult> => {
  const timeoutMs = input.timeoutMs || 120000

  const normalizedOrder = await normalizeOrderForExecution(input)
  const marketplace = normalizedOrder.marketplace

  if (marketplace !== "shopee" && marketplace !== "tiktok_shop") {
    return {
      ok: false,
      error: "Marketplace tidak valid.",
      marketplace: "shopee",
      actionMode: input.actionMode
    }
  }

  if (marketplace === "shopee" && normalizedOrder.idType !== "order_id") {
    return {
      ok: false,
      error: "Shopee membutuhkan mp_order_id (id_type order_id).",
      marketplace,
      actionMode: input.actionMode
    }
  }

  const orderUrl = buildOrderUrl(marketplace, normalizedOrder.id)

  let tab: chrome.tabs.Tab | null = null

  try {
    tab = await chrome.tabs.create({ url: orderUrl, active: false })

    if (!tab.id) {
      throw new Error("Gagal membuka tab order.")
    }

    await waitForAllowedUrl(tab.id, marketplace, orderUrl)

    const fetchResult = await withTimeout(
      executeFetchFromTab(tab.id, marketplace, input.actionMode, input.settings),
      timeoutMs,
      "Timeout proses fetch di tab marketplace."
    )

    if (!fetchResult.ok) {
      return {
        ok: false,
        error: fetchResult.error || "Fetch marketplace gagal.",
        marketplace,
        actionMode: input.actionMode,
        fetchResult
      }
    }

    const token = input.settings.auth.token || ""
    const baseUrl = input.settings.auth.baseUrl || ""

    if (!token) {
      return {
        ok: false,
        error: "Sesi login belum tersedia. Login dulu di popup.",
        marketplace,
        actionMode: input.actionMode,
        fetchResult
      }
    }

    if (!baseUrl) {
      return {
        ok: false,
        error: "Base URL belum diatur.",
        marketplace,
        actionMode: input.actionMode,
        fetchResult
      }
    }

    const exportPayload = buildExportPayload(marketplace, fetchResult)
    const exportResult = await sendExport(baseUrl, token, exportPayload)

    if (exportResult.unauthenticated) {
      await clearAuthSession()
      return {
        ok: false,
        error: "Sesi login tidak valid atau kadaluarsa. Login ulang.",
        marketplace,
        actionMode: input.actionMode,
        fetchResult,
        exportResult
      }
    }

    const orderId = extractPowermaxxOrderId(exportResult.data)

    return {
      ok: exportResult.ok,
      error: exportResult.ok
        ? ""
        : `Export gagal ${exportResult.status}: ${exportResult.statusText || "Error"}`,
      marketplace,
      actionMode: input.actionMode,
      fetchResult,
      exportResult,
      orderId,
      openUrl:
        orderId && input.settings.auth.baseUrl
          ? `${input.settings.auth.baseUrl}/admin/orders/${encodeURIComponent(orderId)}`
          : ""
    }
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message || error),
      marketplace,
      actionMode: input.actionMode
    }
  } finally {
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id)
      } catch (_error) {
        // ignore
      }
    }
  }
}

const executeFetchOnlyOnActiveMarketplaceTabInternal = async (
  actionMode: ActionMode,
  settings: PowermaxxSettings
): Promise<ExecuteFetchSendResult> => {
  const target = await resolveMarketplaceTab()

  if (!target.tabId || !target.url) {
    return {
      ok: false,
      error:
        "Tidak menemukan tab marketplace (Shopee/TikTok). Fokus dulu ke tab seller, lalu coba lagi.",
      marketplace: settings.defaultMarketplace,
      actionMode
    }
  }

  await rememberMarketplaceTab(target.tabId)

  const marketplace = detectMarketplaceFromUrl(target.url)
  if (!marketplace) {
    return {
      ok: false,
      error: "Tab aktif bukan halaman seller marketplace.",
      marketplace: settings.defaultMarketplace,
      actionMode
    }
  }

  const fetchResult = await executeFetchFromTab(
    target.tabId,
    marketplace,
    actionMode,
    settings
  )

  if (!fetchResult.ok) {
    return {
      ok: false,
      error: fetchResult.error || "Fetch marketplace gagal.",
      marketplace,
      actionMode,
      fetchResult
    }
  }

  return {
    ok: true,
    error: "",
    marketplace,
    actionMode,
    fetchResult
  }
}

export const executeFetchOnlyOnActiveMarketplaceTab = async (
  actionMode: ActionMode,
  settings: PowermaxxSettings
): Promise<ExecuteFetchSendResult> =>
  executeFetchOnlyOnActiveMarketplaceTabInternal(actionMode, settings)

export const executeFetchSendOnActiveMarketplaceTab = async (
  actionMode: ActionMode,
  settings: PowermaxxSettings
): Promise<ExecuteFetchSendResult> => {
  const fetchOnlyResult = await executeFetchOnlyOnActiveMarketplaceTabInternal(
    actionMode,
    settings
  )

  if (!fetchOnlyResult.ok || !fetchOnlyResult.fetchResult) {
    return fetchOnlyResult
  }

  const { marketplace, fetchResult } = fetchOnlyResult

  const token = settings.auth.token || ""
  const baseUrl = settings.auth.baseUrl || ""

  if (!token) {
    return {
      ok: false,
      error: "Sesi login belum tersedia. Login dulu di popup.",
      marketplace,
      actionMode,
      fetchResult
    }
  }

  if (!baseUrl) {
    return {
      ok: false,
      error: "Base URL belum diatur.",
      marketplace,
      actionMode,
      fetchResult
    }
  }

  const exportPayload = buildExportPayload(marketplace, fetchResult)
  const exportResult = await sendExport(baseUrl, token, exportPayload)

  if (exportResult.unauthenticated) {
    await clearAuthSession()
    return {
      ok: false,
      error: "Sesi login tidak valid atau kadaluarsa. Login ulang.",
      marketplace,
      actionMode,
      fetchResult,
      exportResult
    }
  }

  const orderId = extractPowermaxxOrderId(exportResult.data)

  return {
    ok: exportResult.ok,
    error: exportResult.ok
      ? ""
      : `Export gagal ${exportResult.status}: ${exportResult.statusText || "Error"}`,
    marketplace,
    actionMode,
    fetchResult,
    exportResult,
    orderId,
    openUrl:
      orderId && baseUrl
        ? `${baseUrl}/admin/orders/${encodeURIComponent(orderId)}`
        : ""
  }
}

export const bindMarketplaceTabTrackers = () => {
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    rememberMarketplaceTab(tabId)
  })

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo?.status !== "complete") return
    rememberMarketplaceTab(tabId)
  })
}
