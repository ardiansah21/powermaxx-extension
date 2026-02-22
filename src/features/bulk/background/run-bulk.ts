import { logger } from "~src/core/logging/logger"
import type {
  BridgeAction,
  NormalizedOrder,
  RuntimeBulkRequest
} from "~src/core/messages/contracts"
import type { PowermaxxSettings } from "~src/core/settings/schema"
import { sendBridgeWorkerEvent } from "~src/features/bridge/background/bridge-events"
import { executeFetchSendByOrder } from "~src/features/fetch-send/background/run-fetch-send"

const toActionMode = (action: BridgeAction) => {
  if (action === "update_income") return "update_income"
  if (action === "update_order") return "update_order"
  return "fetch_send"
}

const activeBulkSessionBySource = new Map<string, { runId: string; workerId: string }>()

const sanitizeErrorMessage = (value: unknown) =>
  String(value || "").replace(/^Error:\s*/i, "").trim()

const classifyErrorCode = (message: unknown) => {
  const raw = String(message || "").toLowerCase()
  if (raw.includes("timeout") || raw.includes("timed out")) return "TIMEOUT"
  return "PROCESSING_FAILED"
}

export const runBulkHeadless = async (args: {
  message: RuntimeBulkRequest
  senderTabId?: number | null
  settings: PowermaxxSettings
}) => {
  const { message, senderTabId, settings } = args
  const orders = Array.isArray(message.orders) ? message.orders : []

  if (!orders.length) {
    return {
      ok: false,
      error: "Order tidak ditemukan.",
      count: 0,
      mode: "bulk" as const,
      running: false,
      runId: "",
      workerId: ""
    }
  }

  const runId = `bulk-${Date.now()}`
  const workerId = senderTabId ? `tab-${senderTabId}` : "bulk-worker"
  const sourceKey = senderTabId ? `tab-${senderTabId}` : "global"

  const activeSession = activeBulkSessionBySource.get(sourceKey)
  if (activeSession) {
    return {
      ok: false,
      error: "Bulk worker sedang berjalan.",
      count: orders.length,
      mode: "bulk" as const,
      running: true,
      runId: activeSession.runId,
      workerId: activeSession.workerId
    }
  }

  activeBulkSessionBySource.set(sourceKey, { runId, workerId })

  ;(async () => {
    const stats = {
      claimed: orders.length,
      processed: 0,
      success: 0,
      failed: 0,
      timed_out: 0,
      report_failed: 0
    }

    await sendBridgeWorkerEvent(senderTabId, "run_started", {
      run_id: runId,
      worker_id: workerId,
      mode: "bulk"
    })

    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index]
      const runOrderId = `${runId}-${index + 1}`

      await sendBridgeWorkerEvent(senderTabId, "run_order_started", {
        run_order_id: runOrderId,
        identifier: order.id,
        marketplace: order.marketplace,
        action: message.action
      })

      try {
        const result = await executeFetchSendByOrder({
          order,
          actionMode: toActionMode(message.action),
          settings,
          timeoutMs: 180000
        })

        stats.processed += 1

        if (result.ok) {
          stats.success += 1
        } else {
          const errorCode = classifyErrorCode(result.error)
          if (errorCode === "TIMEOUT") {
            stats.timed_out += 1
          } else {
            stats.failed += 1
          }
        }

        const errorCode = result.ok ? null : classifyErrorCode(result.error)
        const status = result.ok
          ? "success"
          : errorCode === "TIMEOUT"
            ? "timed_out"
            : "failed"
        const errorMessage = result.ok ? null : sanitizeErrorMessage(result.error)

        await sendBridgeWorkerEvent(senderTabId, "run_order_finished", {
          run_order_id: runOrderId,
          status,
          error_message: errorMessage,
          error_code: errorCode,
          report_ok: true
        })
      } catch (error) {
        stats.processed += 1
        const errorMessage = sanitizeErrorMessage((error as Error)?.message || error)
        const errorCode = classifyErrorCode(errorMessage)
        if (errorCode === "TIMEOUT") {
          stats.timed_out += 1
        } else {
          stats.failed += 1
        }

        await sendBridgeWorkerEvent(senderTabId, "run_order_finished", {
          run_order_id: runOrderId,
          status: errorCode === "TIMEOUT" ? "timed_out" : "failed",
          error_message: errorMessage,
          error_code: errorCode,
          report_ok: false
        })
      }
    }

    await sendBridgeWorkerEvent(senderTabId, "run_finished", {
      run_id: runId,
      worker_id: workerId,
      ok: true,
      stats
    })

    activeBulkSessionBySource.delete(sourceKey)
  })().catch((error) => {
    logger.error("Bulk headless worker crashed", {
      feature: "bulk",
      domain: "worker",
      step: "run",
      runId,
      workerId,
      error: String((error as Error)?.message || error)
    })

    sendBridgeWorkerEvent(senderTabId, "run_failed", {
      run_id: runId,
      worker_id: workerId,
      error_code: "RUN_FAILED",
      error_message: String((error as Error)?.message || error)
    })

    activeBulkSessionBySource.delete(sourceKey)
  })

  return {
    ok: true,
    error: "",
    count: orders.length,
    mode: "bulk" as const,
    running: true,
    runId,
    workerId
  }
}
