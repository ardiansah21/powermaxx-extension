import type { ActionMode, Marketplace } from "~src/core/messages/contracts"

export const VIEWER_PAYLOAD_KEY = "powermaxxViewerPayload"

export interface ViewerPayload {
  updatedAt: number
  marketplace: Exclude<Marketplace, "auto">
  actionMode: ActionMode
  orderId: string
  orderRawJson: Record<string, unknown> | null
  incomeRawJson: Record<string, unknown> | null
  incomeDetailRawJson: Record<string, unknown> | null
  fetchMeta?: Record<string, unknown>
}

const getStorage = () => chrome.storage?.local

export const saveViewerPayload = async (payload: ViewerPayload) => {
  const storage = getStorage()
  if (!storage) return

  return new Promise<void>((resolve) => {
    storage.set({ [VIEWER_PAYLOAD_KEY]: payload }, () => resolve())
  })
}

export const loadViewerPayload = async () => {
  const storage = getStorage()
  if (!storage) return null

  return new Promise<ViewerPayload | null>((resolve) => {
    storage.get([VIEWER_PAYLOAD_KEY], (result) => {
      const payload = result?.[VIEWER_PAYLOAD_KEY]
      if (!payload || typeof payload !== "object") {
        resolve(null)
        return
      }

      resolve(payload as ViewerPayload)
    })
  })
}

export const clearViewerPayload = async () => {
  const storage = getStorage()
  if (!storage) return

  return new Promise<void>((resolve) => {
    storage.remove([VIEWER_PAYLOAD_KEY], () => resolve())
  })
}
