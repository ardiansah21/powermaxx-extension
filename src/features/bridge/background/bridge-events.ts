import { logger } from "~src/core/logging/logger"

const broadcastInternalWorkerEvent = (
  event: string,
  payload: Record<string, unknown>
) => {
  if (!chrome.runtime?.sendMessage) return

  try {
    chrome.runtime.sendMessage(
      {
        type: "POWERMAXX_INTERNAL_WORKER_EVENT",
        event,
        payload
      },
      () => {
        void chrome.runtime.lastError
      }
    )
  } catch (_error) {
    // ignore
  }
}

export const sendBridgeWorkerEvent = async (
  tabId: number | null | undefined,
  event: string,
  payload: Record<string, unknown> = {}
) => {
  broadcastInternalWorkerEvent(event, payload)

  if (!tabId) return

  if (!chrome.tabs?.sendMessage) return

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "POWERMAXX_BRIDGE_EVENT",
      event,
      payload
    })
  } catch (error) {
    logger.warn("Failed to send bridge worker event", {
      feature: "bridge",
      domain: "event",
      step: "send-message",
      tabId,
      event,
      error: String((error as Error)?.message || error)
    })
  }
}
