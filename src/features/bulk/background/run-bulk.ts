import { logger } from "~src/core/logging/logger"
import {
  buildAutomationActionHint,
  classifyAutomationErrorCode,
  sanitizeErrorMessage,
  sanitizeTechnicalError,
  toAutomationStatus
} from "~src/core/errors/automation-error"
import { normalizeIdType, normalizeMarketplace } from "~src/core/messages/guards"
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

interface BulkOrderExecutionResult {
  ok: boolean
  error?: string
}

const normalizeBulkIdType = (value: unknown): NormalizedOrder["idType"] => {
  if (value === "order_id" || value === "order_sn") {
    return value
  }

  return "order_sn"
}

const normalizeBulkOrder = (value: unknown): NormalizedOrder | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const id = String(
    record.id ??
      record.order_id ??
      record.order_sn ??
      record.mp_order_id ??
      record.mp_order_sn ??
      ""
  ).trim()

  if (!id) return null

  const marketplace = normalizeMarketplace(record.marketplace)
  const idType =
    normalizeIdType(record.idType ?? record.id_type) ||
    (record.order_id !== undefined || record.mp_order_id !== undefined
      ? "order_id"
      : record.order_sn !== undefined || record.mp_order_sn !== undefined
        ? "order_sn"
        : "")

  return {
    id,
    marketplace,
    idType: normalizeBulkIdType(idType)
  }
}

const buildBulkOrderCandidates = (
  order: NormalizedOrder,
  settings: PowermaxxSettings
) => {
  if (order.marketplace === "shopee" || order.marketplace === "tiktok_shop") {
    return [
      {
        ...order,
        idType: normalizeBulkIdType(order.idType)
      }
    ]
  }

  const primary = settings.defaultMarketplace
  const secondary = primary === "shopee" ? "tiktok_shop" : "shopee"
  const marketplaces: Array<"shopee" | "tiktok_shop"> = [primary, secondary]

  return marketplaces.map((marketplace) => ({
    id: order.id,
    marketplace,
    idType: normalizeBulkIdType(order.idType)
  }))
}

const executeFetchSendWithAutoMarketplace = async (args: {
  order: NormalizedOrder
  action: BridgeAction
  settings: PowermaxxSettings
}): Promise<BulkOrderExecutionResult> => {
  const candidates = buildBulkOrderCandidates(args.order, args.settings)
  const errors: string[] = []

  for (const candidate of candidates) {
    const result = await executeFetchSendByOrder({
      order: candidate,
      actionMode: toActionMode(args.action),
      settings: args.settings,
      timeoutMs: 180000
    })

    if (result.ok) {
      return {
        ok: true,
        error: ""
      }
    }

    errors.push(`${candidate.marketplace}: ${String(result.error || "gagal")}`)
  }

  return {
    ok: false,
    error:
      candidates.length > 1
        ? `Auto marketplace gagal (${errors.join(" | ")})`
        : errors[0] || "Proses bulk gagal."
  }
}

export const runBulkHeadless = async (args: {
  message: RuntimeBulkRequest
  senderTabId?: number | null
  settings: PowermaxxSettings
}) => {
  const { message, senderTabId, settings } = args
  const orders = (Array.isArray(message.orders) ? message.orders : [])
    .map((order) => normalizeBulkOrder(order))
    .filter((order): order is NormalizedOrder => Boolean(order))

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

  const runSession = async () => {
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
      const startedAt = Date.now()

      await sendBridgeWorkerEvent(senderTabId, "run_order_started", {
        run_id: runId,
        worker_id: workerId,
        run_order_id: runOrderId,
        identifier: order.id,
        marketplace: order.marketplace,
        action: message.action
      })

      try {
        const result = await executeFetchSendWithAutoMarketplace({
          order,
          action: message.action,
          settings
        })

        stats.processed += 1

        if (result.ok) {
          stats.success += 1
        } else {
          const errorCode = classifyAutomationErrorCode(result.error)
          if (errorCode === "TIMEOUT") {
            stats.timed_out += 1
          } else {
            stats.failed += 1
          }
        }

        const errorCode = result.ok ? null : classifyAutomationErrorCode(result.error)
        const status = result.ok
          ? "success"
          : toAutomationStatus(errorCode)
        const errorMessage = result.ok ? null : sanitizeErrorMessage(result.error)
        const technicalError = result.ok ? null : sanitizeTechnicalError(result.error)

        await sendBridgeWorkerEvent(senderTabId, "run_order_finished", {
          run_id: runId,
          worker_id: workerId,
          run_order_id: runOrderId,
          status,
          error_message: errorMessage,
          error_code: errorCode,
          technical_error: technicalError,
          action_hint: result.ok ? null : buildAutomationActionHint(errorCode),
          duration_ms: Date.now() - startedAt,
          report_ok: true
        })
      } catch (error) {
        stats.processed += 1
        const errorMessage = sanitizeErrorMessage((error as Error)?.message || error)
        const errorCode = classifyAutomationErrorCode(errorMessage)
        if (errorCode === "TIMEOUT") {
          stats.timed_out += 1
        } else {
          stats.failed += 1
        }
        const technicalError = sanitizeTechnicalError(
          (error as Error)?.stack || (error as Error)?.message || error
        )

        await sendBridgeWorkerEvent(senderTabId, "run_order_finished", {
          run_id: runId,
          worker_id: workerId,
          run_order_id: runOrderId,
          status: toAutomationStatus(errorCode),
          error_message: errorMessage,
          error_code: errorCode,
          technical_error: technicalError,
          action_hint: buildAutomationActionHint(errorCode),
          duration_ms: Date.now() - startedAt,
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
  }

  // Delay worker start to ensure runtime response is posted first.
  setTimeout(() => {
    void runSession().catch((error) => {
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
        error_message: String((error as Error)?.message || error),
        technical_error: sanitizeTechnicalError(
          (error as Error)?.stack || (error as Error)?.message || error
        ),
        action_hint: buildAutomationActionHint("EXTENSION_RUNTIME")
      })

      activeBulkSessionBySource.delete(sourceKey)
    })
  }, 0)

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
