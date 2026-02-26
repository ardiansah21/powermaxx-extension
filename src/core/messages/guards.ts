import type {
  ActionMode,
  BridgeAction,
  BridgeApiPaths,
  BridgeInboundMessage,
  BridgeMode,
  Marketplace,
  NormalizedOrder
} from "~src/core/messages/contracts"

export const ALLOWED_ACTIONS = new Set<BridgeAction>([
  "update_both"
])

export const ALLOWED_MODES = new Set<BridgeMode>(["single", "bulk"])

export const normalizeMarketplace = (value: unknown): Marketplace => {
  const raw = String(value ?? "").trim().toLowerCase()
  if (!raw) return "auto"
  if (raw === "shopee") return "shopee"
  if (raw === "tiktok" || raw === "tiktok shop" || raw === "tiktok_shop") {
    return "tiktok_shop"
  }
  if (raw === "auto") return "auto"
  return "auto"
}

export const normalizeIdType = (
  value: unknown
): NormalizedOrder["idType"] => {
  const raw = String(value ?? "").trim().toLowerCase()
  if (!raw) return ""
  if (raw === "mp_order_id" || raw === "order_id") return "order_id"
  if (raw === "mp_order_sn" || raw === "order_sn") return "order_sn"
  return ""
}

const normalizeBatchIdInternal = (value: unknown) => String(value ?? "").trim()

const normalizeOrderItem = (
  item: unknown,
  fallbackMarketplace: unknown,
  fallbackIdType: unknown
): NormalizedOrder | null => {
  if (item === null || item === undefined) return null

  if (typeof item === "string" || typeof item === "number") {
    const id = String(item).trim()
    if (!id) return null
    return {
      id,
      marketplace: normalizeMarketplace(fallbackMarketplace),
      idType: normalizeIdType(fallbackIdType)
    }
  }

  if (typeof item !== "object" || Array.isArray(item)) return null

  const record = item as Record<string, unknown>
  const rawId =
    record.mp_order_id ??
    record.order_id ??
    record.order_sn ??
    record.id ??
    record.orderId ??
    record.orderSn

  const id = String(rawId ?? "").trim()
  if (!id) return null

  let idType = normalizeIdType(
    record.id_type ?? record.idType ?? fallbackIdType
  )

  if (!idType) {
    if (record.mp_order_id !== undefined || record.order_id !== undefined) {
      idType = "order_id"
    } else if (record.order_sn !== undefined || record.orderSn !== undefined) {
      idType = "order_sn"
    }
  }

  return {
    id,
    marketplace:
      normalizeMarketplace(record.marketplace) ||
      normalizeMarketplace(fallbackMarketplace),
    idType
  }
}

const normalizeList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean)
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,;\t ]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

export const normalizeOrders = (payload: BridgeInboundMessage): NormalizedOrder[] => {
  const fallbackMarketplace = payload?.marketplace
  const fallbackIdType = payload?.id_type

  if (Array.isArray(payload?.orders)) {
    return payload.orders
      .map((item) =>
        normalizeOrderItem(item, fallbackMarketplace, fallbackIdType)
      )
      .filter((value): value is NormalizedOrder => Boolean(value))
  }

  const list = normalizeList(payload?.order_sn_list || payload?.order_sn)
  return list
    .map((item) => normalizeOrderItem(item, fallbackMarketplace, fallbackIdType))
    .filter((value): value is NormalizedOrder => Boolean(value))
}

export const normalizeBridgeAction = (value: unknown): BridgeAction | "" => {
  const raw = String(value ?? "").trim().toLowerCase() as BridgeAction
  return ALLOWED_ACTIONS.has(raw) ? raw : ""
}

export const normalizeBridgeMode = (value: unknown): BridgeMode | "" => {
  const raw = String(value ?? "").trim().toLowerCase() as BridgeMode
  return ALLOWED_MODES.has(raw) ? raw : ""
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

export const normalizeApiPaths = (payload: unknown): BridgeApiPaths => {
  if (!isObject(payload)) return {}

  const map: Record<keyof BridgeApiPaths, string[]> = {
    request: ["request", "request_path", "requestPath"],
    result: ["result", "result_path", "resultPath"]
  }

  const normalized: BridgeApiPaths = {}

  Object.entries(map).forEach(([targetKey, keys]) => {
    const matched = keys
      .map((key) => payload[key])
      .find((value) => typeof value === "string" && value.trim())

    if (typeof matched === "string") {
      normalized[targetKey as keyof BridgeApiPaths] = matched.trim()
    }
  })

  return normalized
}

export const isWorkerModeRequested = (payload: BridgeInboundMessage) => {
  const batchId = normalizeBatchIdInternal(payload.batch_id || payload.batchId)
  return Boolean(batchId || payload.worker_mode === true || payload.workerMode === true)
}

export const normalizeWorkerId = (value: unknown, fallbackTabId?: number | null) => {
  const raw = String(value ?? "").trim()
  const parsed = Number(raw)

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed)
  }

  if (fallbackTabId && Number.isFinite(fallbackTabId) && fallbackTabId > 0) {
    return Math.trunc(fallbackTabId)
  }

  return Math.max(1, Math.trunc(Date.now() % 1000000000))
}

export const normalizeBatchId = (value: unknown) =>
  normalizeBatchIdInternal(value)

export const toActionMode = (action: BridgeAction): ActionMode => {
  void action
  return "fetch_send"
}
