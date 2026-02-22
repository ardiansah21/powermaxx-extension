import type { Marketplace } from "~src/core/messages/contracts"

export interface ExportPayload {
  marketplace: "shopee" | "tiktok_shop"
  shopee_get_one_order_json?: Record<string, unknown> | null
  shopee_get_order_income_components_json?: Record<string, unknown> | null
  tiktok_shop_fulfillment_order_get_json?: Record<string, unknown> | null
  tiktok_shop_statement_json?: {
    statement_order_list: Record<string, unknown> | null
    statement_transaction_detail: Record<string, unknown> | null
  }
}

export interface FetchResultPayload {
  orderRawJson: Record<string, unknown> | null
  incomeRawJson: Record<string, unknown> | null
  incomeDetailRawJson: Record<string, unknown> | null
}

export interface SendExportResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
  htmlSnippet: string
  url: string
  unauthenticated: boolean
  data: Record<string, any> | null
  error?: {
    name: string
    message: string
    hint: string
  }
}

export const buildExportPayload = (
  marketplace: Marketplace,
  payload: FetchResultPayload
): ExportPayload => {
  if (marketplace === "tiktok_shop") {
    return {
      marketplace: "tiktok_shop",
      tiktok_shop_fulfillment_order_get_json: payload.orderRawJson || null,
      tiktok_shop_statement_json: {
        statement_order_list: payload.incomeRawJson || null,
        statement_transaction_detail: payload.incomeDetailRawJson || null
      }
    }
  }

  return {
    marketplace: "shopee",
    shopee_get_one_order_json: payload.orderRawJson || null,
    shopee_get_order_income_components_json: payload.incomeRawJson || null
  }
}

const snippet = (value: string, max = 500) => {
  if (!value) return ""
  if (value.length <= max) return value
  return `${value.slice(0, max)}...`
}

export const sendExport = async (
  baseUrl: string,
  token: string,
  payload: ExportPayload
): Promise<SendExportResponse> => {
  const url = `${baseUrl}/api/orders/import`

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })

    const contentType = response.headers.get("content-type") || ""
    const text = await response.text()
    const isJson = contentType.includes("application/json")

    let data: Record<string, any> | null = null
    if (isJson && text) {
      try {
        data = JSON.parse(text)
      } catch (_error) {
        data = null
      }
    }

    const unauthenticated =
      [401, 403, 419].includes(response.status) ||
      String(data?.message || "").toLowerCase().includes("unauthenticated") ||
      String(text || "").toLowerCase().includes("unauthenticated")

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: isJson ? text : "",
      htmlSnippet: isJson ? "" : snippet(text, 500),
      url,
      unauthenticated,
      data
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: "FETCH_ERROR",
      body: "",
      htmlSnippet: "",
      url,
      unauthenticated: false,
      data: null,
      error: {
        name: String((error as Error)?.name || "Error"),
        message: String((error as Error)?.message || "Failed to fetch"),
        hint: "Periksa Base URL, HTTPS/sertifikat, CORS server, dan koneksi jaringan."
      }
    }
  }
}

const normalizeOrderIdValue = (value: unknown) => {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return ""
  const text = String(value).trim()
  return text || ""
}

export const extractPowermaxxOrderId = (data: unknown): string => {
  if (!data) return ""

  if (Array.isArray(data)) {
    for (const item of data) {
      const id = extractPowermaxxOrderId(item)
      if (id) return id
    }
    return ""
  }

  if (typeof data !== "object") return ""

  const record = data as Record<string, any>
  const candidates = [
    record.order_id,
    record.orderId,
    record.id,
    record.data?.order_id,
    record.data?.orderId,
    record.data?.id,
    record.data?.order?.order_id,
    record.data?.order?.orderId,
    record.data?.order?.id,
    record.order?.order_id,
    record.order?.orderId,
    record.order?.id,
    record.result?.order_id,
    record.result?.orderId,
    record.result?.id,
    record.orders?.[0]?.order_id,
    record.orders?.[0]?.orderId,
    record.orders?.[0]?.id,
    record.data?.orders?.[0]?.order_id,
    record.data?.orders?.[0]?.orderId,
    record.data?.orders?.[0]?.id
  ]

  for (const candidate of candidates) {
    const id = normalizeOrderIdValue(candidate)
    if (id) return id
  }

  return ""
}
