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

const sanitizeErrorText = (value: unknown, max = 240) => {
  if (typeof value !== "string") return ""
  const cleaned = value.trim().replace(/\s+/g, " ")
  if (!cleaned) return ""
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max)}...`
}

const toObjectRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const pickMessageFromErrorsField = (errors: unknown) => {
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const item = sanitizeErrorText(entry)
      if (item) return item
      const nested = toObjectRecord(entry)
      if (!nested) continue
      for (const nestedValue of Object.values(nested)) {
        if (Array.isArray(nestedValue)) {
          for (const nestedItem of nestedValue) {
            const text = sanitizeErrorText(nestedItem)
            if (text) return text
          }
          continue
        }
        const text = sanitizeErrorText(nestedValue)
        if (text) return text
      }
    }
    return ""
  }

  const objectErrors = toObjectRecord(errors)
  if (!objectErrors) return sanitizeErrorText(errors)

  for (const value of Object.values(objectErrors)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = sanitizeErrorText(item)
        if (text) return text
      }
      continue
    }
    const text = sanitizeErrorText(value)
    if (text) return text
  }

  return ""
}

const extractResponseErrorMessage = (response: SendExportResponse) => {
  const dataRecord = toObjectRecord(response.data)
  const directCandidates = [
    sanitizeErrorText(dataRecord?.message),
    sanitizeErrorText(dataRecord?.error),
    sanitizeErrorText(dataRecord?.detail),
    sanitizeErrorText(dataRecord?.title)
  ]

  for (const candidate of directCandidates) {
    if (candidate) return candidate
  }

  const errorFromErrors = pickMessageFromErrorsField(dataRecord?.errors)
  if (errorFromErrors) return errorFromErrors

  const bodyRecord = toObjectRecord(
    response.body ? safeJson(response.body) : null
  )
  const bodyCandidates = [
    sanitizeErrorText(bodyRecord?.message),
    sanitizeErrorText(bodyRecord?.error),
    sanitizeErrorText(bodyRecord?.detail)
  ]

  for (const candidate of bodyCandidates) {
    if (candidate) return candidate
  }

  const htmlText = sanitizeErrorText(response.htmlSnippet)
  if (htmlText) return htmlText

  return ""
}

const safeJson = (value: string) => {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch (_error) {
    return null
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
      String(data?.message || "")
        .toLowerCase()
        .includes("unauthenticated") ||
      String(text || "")
        .toLowerCase()
        .includes("unauthenticated")

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

export const formatExportFailureMessage = (response: SendExportResponse) => {
  if (response.ok) return ""

  if (response.status === 0) {
    const fetchMessage = sanitizeErrorText(response.error?.message)
    return fetchMessage
      ? `Export gagal: ${fetchMessage}`
      : "Export gagal: koneksi ke server gagal."
  }

  const detail = extractResponseErrorMessage(response)
  if (detail) return `Export gagal ${response.status}: ${detail}`

  const statusText = sanitizeErrorText(response.statusText)
  if (statusText && statusText.toLowerCase() !== "error") {
    return `Export gagal ${response.status}: ${statusText}`
  }

  return `Export gagal ${response.status}: Error`
}

const normalizeOrderRefValue = (value: unknown) => {
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
    const id = normalizeOrderRefValue(candidate)
    if (id) return id
  }

  return ""
}

export const extractPowermaxxOrderNo = (data: unknown): string => {
  if (!data) return ""

  if (Array.isArray(data)) {
    for (const item of data) {
      const orderNo = extractPowermaxxOrderNo(item)
      if (orderNo) return orderNo
    }
    return ""
  }

  if (typeof data !== "object") return ""

  const record = data as Record<string, any>
  const candidates = [
    record.order_no,
    record.orderNo,
    record.order_number,
    record.orderNumber,
    record.data?.order_no,
    record.data?.orderNo,
    record.data?.order_number,
    record.data?.orderNumber,
    record.data?.order?.order_no,
    record.data?.order?.orderNo,
    record.data?.order?.order_number,
    record.data?.order?.orderNumber,
    record.order?.order_no,
    record.order?.orderNo,
    record.order?.order_number,
    record.order?.orderNumber,
    record.result?.order_no,
    record.result?.orderNo,
    record.result?.order_number,
    record.result?.orderNumber,
    record.orders?.[0]?.order_no,
    record.orders?.[0]?.orderNo,
    record.orders?.[0]?.order_number,
    record.orders?.[0]?.orderNumber,
    record.data?.orders?.[0]?.order_no,
    record.data?.orders?.[0]?.orderNo,
    record.data?.orders?.[0]?.order_number,
    record.data?.orders?.[0]?.orderNumber
  ]

  for (const candidate of candidates) {
    const orderNo = normalizeOrderRefValue(candidate)
    if (orderNo) return orderNo
  }

  return ""
}
