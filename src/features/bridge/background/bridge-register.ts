import { logger } from "~src/core/logging/logger"
import { buildOriginPattern } from "~src/core/settings/schema"
import { injectBridgeScriptToTab } from "~src/features/bridge/background/bridge-injector"

const uniq = (items: string[]) => Array.from(new Set(items.filter(Boolean)))

const grantedBridgeOrigins = new Set<string>()

const containsPermission = (origin: string) =>
  new Promise<boolean>((resolve) => {
    if (!chrome.permissions) {
      resolve(false)
      return
    }

    chrome.permissions.contains({ origins: [origin] }, (granted) => {
      resolve(Boolean(granted))
    })
  })

const urlMatchOriginPattern = (url: string, originPattern: string) => {
  try {
    const origin = originPattern.replace(/\/$/, "").replace(/\*$/, "")
    return url.startsWith(origin)
  } catch (_error) {
    return false
  }
}

const shouldInjectBridgeForUrl = (url: string) => {
  if (!url) return false

  for (const origin of grantedBridgeOrigins) {
    if (urlMatchOriginPattern(url, origin)) return true
  }

  return false
}

export const ensureBridgeForBaseUrls = async (baseUrls: string[]) => {
  const patterns = uniq(baseUrls.map(buildOriginPattern))

  const granted: string[] = []

  for (const pattern of patterns) {
    const has = await containsPermission(pattern)
    if (has) {
      granted.push(pattern)
      grantedBridgeOrigins.add(pattern)
    }
  }

  if (granted.length) {
    try {
      const tabs = await chrome.tabs.query({})
      await Promise.all(
        tabs
          .filter((tab) => tab.id && shouldInjectBridgeForUrl(tab.url || ""))
          .map((tab) => injectBridgeScriptToTab(tab.id as number))
      )
    } catch (error) {
      logger.warn("Failed to inject bridge to existing tabs", {
        feature: "bridge",
        domain: "register",
        step: "inject-existing-tabs",
        error: String((error as Error)?.message || error)
      })
    }
  }

  return granted
}

export const bindBridgeAutoInjection = () => {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return

    const url = tab?.url || ""
    if (!shouldInjectBridgeForUrl(url)) return

    try {
      await injectBridgeScriptToTab(tabId)
    } catch (error) {
      logger.warn("Bridge injection failed on tab update", {
        feature: "bridge",
        domain: "inject",
        step: "tabs.onUpdated",
        tabId,
        url,
        error: String((error as Error)?.message || error)
      })
    }
  })

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (!shouldInjectBridgeForUrl(tab.url || "")) return
      await injectBridgeScriptToTab(tabId)
    } catch (_error) {
      // ignore
    }
  })
}
