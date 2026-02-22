import { buildOriginPattern } from "~src/core/settings/schema"

export const hasHostPermission = (baseUrl: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (!chrome.permissions) {
      resolve(false)
      return
    }

    const origin = buildOriginPattern(baseUrl)
    if (!origin) {
      resolve(false)
      return
    }

    chrome.permissions.contains({ origins: [origin] }, (granted) => {
      resolve(Boolean(granted))
    })
  })

export const requestHostPermission = (baseUrl: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (!chrome.permissions) {
      resolve(false)
      return
    }

    const origin = buildOriginPattern(baseUrl)
    if (!origin) {
      resolve(false)
      return
    }

    chrome.permissions.request({ origins: [origin] }, (granted) => {
      resolve(Boolean(granted))
    })
  })

export const ensureHostPermission = async (baseUrl: string) => {
  const granted = await hasHostPermission(baseUrl)
  if (granted) return true
  return requestHostPermission(baseUrl)
}
