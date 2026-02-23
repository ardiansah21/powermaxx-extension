import { detectMarketplaceFromUrl } from "~src/core/marketplace"
import { logger } from "~src/core/logging/logger"
import type {
  ContentAwbRequest,
  ContentAwbResponse,
  Marketplace
} from "~src/core/messages/contracts"
import { type PowermaxxSettings } from "~src/core/settings/schema"
import { runMarketplaceAwbInPage } from "~src/features/awb/content/page-runner"
import {
  ensureMarketplaceContentScriptInjected,
  resolveMarketplaceTab
} from "~src/features/fetch-send/background/run-fetch-send"

export interface ExecuteAwbResult {
  ok: boolean
  error?: string
  downloaded?: boolean
  fileName?: string
  openUrl?: string
  printUrl?: string
  step?: string
  detail?: string
  jobId?: string
  marketplace: Exclude<Marketplace, "auto">
}

const toAwbRequest = (
  marketplace: "shopee" | "tiktok_shop",
  settings: PowermaxxSettings
): ContentAwbRequest => {
  if (marketplace === "shopee") {
    return {
      type: "POWERMAXX_CONTENT_AWB",
      request: {
        marketplace: "shopee",
        endpoints: {
          orderEndpoint: settings.marketplaces.shopee.orderEndpoint,
          packageEndpoint: settings.marketplaces.shopee.awb.packageEndpoint,
          createJobEndpoint: settings.marketplaces.shopee.awb.createJobEndpoint,
          downloadJobEndpoint: settings.marketplaces.shopee.awb.downloadJobEndpoint
        },
        options: {
          regionId: settings.marketplaces.shopee.awb.regionId,
          asyncSdVersion: settings.marketplaces.shopee.awb.asyncSdVersion,
          fileType: settings.marketplaces.shopee.awb.fileType,
          fileName: settings.marketplaces.shopee.awb.fileName,
          fileContents: settings.marketplaces.shopee.awb.fileContents
        }
      }
    }
  }

  return {
    type: "POWERMAXX_CONTENT_AWB",
    request: {
      marketplace: "tiktok_shop",
      endpoints: {
        orderEndpoint: settings.marketplaces.tiktok_shop.orderEndpoint,
        generateEndpoint: settings.marketplaces.tiktok_shop.awb.generateEndpoint
      },
      options: {
        filePrefix: settings.marketplaces.tiktok_shop.awb.filePrefix
      }
    }
  }
}

const sendContentAwbCommand = async (
  tabId: number,
  marketplace: "shopee" | "tiktok_shop",
  settings: PowermaxxSettings
) => {
  const payload = toAwbRequest(marketplace, settings)

  const response = await new Promise<ContentAwbResponse>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (runtimeResponse) => {
      const runtimeError = chrome.runtime.lastError?.message || ""
      if (runtimeError) {
        reject(new Error(runtimeError))
        return
      }

      resolve(runtimeResponse as ContentAwbResponse)
    })
  })

  if (!response || typeof response !== "object") {
    throw new Error("Response AWB content script kosong.")
  }

  return response
}

const fallbackAwbWithExecuteScript = async (
  tabId: number,
  marketplace: "shopee" | "tiktok_shop",
  settings: PowermaxxSettings
) => {
  const request = toAwbRequest(marketplace, settings).request

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: runMarketplaceAwbInPage,
    args: [request]
  })

  const payload = result?.result as ContentAwbResponse | undefined
  if (!payload) {
    const fallbackError = String((result as { error?: unknown })?.error || "").trim()
    throw new Error(
      fallbackError
        ? `Result executeScript AWB kosong (${fallbackError}).`
        : "Result executeScript AWB kosong."
    )
  }

  return payload
}

const executeAwbFromTab = async (
  tabId: number,
  marketplace: "shopee" | "tiktok_shop",
  settings: PowermaxxSettings
) => {
  try {
    return await sendContentAwbCommand(tabId, marketplace, settings)
  } catch (error) {
    logger.warn("Primary AWB content message failed, using executeScript fallback", {
      feature: "awb",
      domain: marketplace,
      step: "content-fallback",
      error: String((error as Error)?.message || error)
    })

    try {
      await ensureMarketplaceContentScriptInjected(tabId)
      return await sendContentAwbCommand(tabId, marketplace, settings)
    } catch (retryError) {
      logger.warn("AWB content reinjection retry failed, using executeScript fallback", {
        feature: "awb",
        domain: marketplace,
        step: "content-reinject-retry",
        error: String((retryError as Error)?.message || retryError)
      })
    }

    return fallbackAwbWithExecuteScript(tabId, marketplace, settings)
  }
}

export const executeAwbOnActiveMarketplaceTab = async (
  settings: PowermaxxSettings
): Promise<ExecuteAwbResult> => {
  const target = await resolveMarketplaceTab()

  if (!target.tabId || !target.url) {
    return {
      ok: false,
      error:
        "Tidak menemukan tab marketplace (Shopee/TikTok). Fokus dulu ke tab seller, lalu coba lagi.",
      marketplace: settings.defaultMarketplace
    }
  }

  const marketplace = detectMarketplaceFromUrl(target.url)
  if (!marketplace) {
    return {
      ok: false,
      error: "Tab aktif bukan halaman seller marketplace.",
      marketplace: settings.defaultMarketplace
    }
  }

  const result = await executeAwbFromTab(target.tabId, marketplace, settings)

  return {
    ok: Boolean(result.ok),
    error: result.error || "",
    downloaded: result.downloaded,
    fileName: result.fileName,
    openUrl: result.openUrl,
    printUrl: result.printUrl,
    step: result.step,
    detail: result.detail,
    jobId: result.jobId,
    marketplace
  }
}
