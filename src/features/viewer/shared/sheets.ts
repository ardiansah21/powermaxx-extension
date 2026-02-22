import type { ViewerPayload } from "~src/features/viewer/shared/storage"

export interface SheetData {
  headers: string[]
  rows: string[][]
  copy: string
}

const isObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const sanitizeCell = (value: unknown) => {
  const raw = value ?? ""
  return String(raw).replace(/[\t\r\n]+/g, " ").trim()
}

const formatLocalDateTime = (value: unknown) => {
  const ts = Number(value)
  if (!Number.isFinite(ts) || ts <= 0) return ""

  const ms = ts > 1e12 ? ts : ts * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ""

  const pad = (num: number) => String(num).padStart(2, "0")
  const year = String(date.getFullYear()).slice(-2)
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${year} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const formatRupiahDigits = (value: unknown) => {
  if (value === null || value === undefined) return ""
  return String(value).replace(/[^\d-]/g, "")
}

const formatIncomeAmount = (amount: unknown) => {
  if (amount === null || amount === undefined) return ""
  const num = Number(amount)
  if (!Number.isFinite(num)) return ""
  const rupiah = Math.round(num / 100000)
  if (rupiah === 0) return "0"
  const absValue = Math.abs(rupiah)
  return rupiah < 0 ? `-${absValue}` : String(absValue)
}

const buildVoucherDisplayName = (value: Record<string, any>) => {
  const base = String(value?.display_name || "")
  const codes = Array.isArray(value?.ext_info?.seller_voucher_codes)
    ? value.ext_info.seller_voucher_codes
    : []

  const cleaned = codes
    .map((entry: unknown) => String(entry ?? "").trim())
    .filter(Boolean)

  if (!cleaned.length) return base

  const joined = cleaned.join(", ")
  if (base.includes("{voucher code}")) return base.replace("{voucher code}", joined)
  if (base.includes("{voucher_code}")) return base.replace("{voucher_code}", joined)
  return base ? `${base} - ${joined}` : joined
}

const buildShopeeIncomeSheet = (
  incomeRawJson: Record<string, unknown> | null
): SheetData => {
  const incomeData = isObject(incomeRawJson?.data) ? incomeRawJson.data : null
  const breakdown = Array.isArray(incomeData?.seller_income_breakdown?.breakdown)
    ? incomeData.seller_income_breakdown.breakdown
    : []

  if (!breakdown.length) {
    return { headers: [], rows: [], copy: "" }
  }

  const orderId = incomeData?.order_info?.order_id ?? ""
  const orderSn = incomeData?.order_info?.order_sn ?? ""
  const headers = [
    "order_id",
    "order_sn",
    "level",
    "parent_field_name",
    "field_name",
    "display_name",
    "amount"
  ]

  const rows: string[][] = []

  breakdown.forEach((item: Record<string, any>) => {
    rows.push([
      orderId,
      orderSn,
      "breakdown",
      "",
      item?.field_name ?? "",
      item?.display_name ?? "",
      formatIncomeAmount(item?.amount)
    ].map(sanitizeCell))

    if (!Array.isArray(item?.sub_breakdown)) return

    item.sub_breakdown.forEach((sub: Record<string, any>) => {
      rows.push([
        orderId,
        orderSn,
        "sub_breakdown",
        item?.field_name ?? "",
        sub?.field_name ?? "",
        buildVoucherDisplayName(sub),
        formatIncomeAmount(sub?.amount)
      ].map(sanitizeCell))

      if (sub?.field_name !== "SERVICE_FEE") return

      const fees = Array.isArray(sub?.ext_info?.service_fee_infos)
        ? sub.ext_info.service_fee_infos
        : []

      fees.forEach((fee: Record<string, any>) => {
        const feeName = fee?.name ?? ""
        rows.push([
          orderId,
          orderSn,
          "service_fee_infos",
          sub?.field_name ?? "",
          feeName,
          feeName,
          formatIncomeAmount(fee?.amount)
        ].map(sanitizeCell))
      })
    })
  })

  const copy = [headers, ...rows].map((row) => row.join("\t")).join("\n")
  return { headers, rows, copy }
}

const buildShopeeOrderSheet = (
  orderRawJson: Record<string, unknown> | null,
  updatedAt: number
): SheetData => {
  const orderData = isObject(orderRawJson?.data) ? orderRawJson.data : null

  const headers = [
    "local.process_date",
    "payby_date",
    "order_id",
    "order_sn",
    "remark",
    "note",
    "order_items.item_id",
    "order_items.model_id",
    "order_items.sku",
    "order_items.item_model.sku",
    "order_items.amount",
    "order_items.order_price",
    "total_price"
  ]

  if (!orderData) {
    return { headers, rows: [], copy: "" }
  }

  const items = Array.isArray(orderData.order_items) ? orderData.order_items : []
  if (!items.length) {
    return { headers, rows: [], copy: "" }
  }

  const processDate = formatLocalDateTime(updatedAt || Date.now())
  const paybyDate = formatLocalDateTime(orderData.payby_date)
  const orderId = orderData.order_id ?? ""
  const orderSn = orderData.order_sn ?? ""
  const remark = orderData.remark ?? ""
  const note = orderData.note ?? ""
  const totalPrice = formatRupiahDigits(orderData.total_price ?? "")

  const rows = items.map((item: Record<string, any>) => {
    const sku = item?.product?.sku || item?.sku || item?.item_model?.sku || ""
    const itemModelSku = item?.item_model?.sku || ""
    const itemId = item?.item_id ?? item?.item_model?.item_id ?? ""
    const modelId = item?.model_id ?? item?.item_model?.model_id ?? ""
    const amount = item?.amount ?? ""
    const orderPrice = formatRupiahDigits(item?.order_price ?? "")

    return [
      processDate,
      paybyDate,
      orderId,
      orderSn,
      remark,
      note,
      itemId,
      modelId,
      sku,
      itemModelSku,
      amount,
      orderPrice,
      totalPrice
    ].map(sanitizeCell)
  })

  const copy = rows.map((row) => row.join("\t")).join("\n")
  return { headers, rows, copy }
}

const formatTikTokAmount = (value: unknown) => {
  if (!value) return ""
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (!isObject(value)) return ""
  return (
    value.format_with_symbol ||
    value.format_price ||
    value.amount ||
    value.text ||
    ""
  )
}

const buildTikTokOrderSheet = (
  orderRawJson: Record<string, unknown> | null
): SheetData => {
  const data = isObject(orderRawJson?.data) ? orderRawJson.data : null
  const mainOrder = Array.isArray(data?.main_order)
    ? data.main_order[0]
    : null
  const items = Array.isArray(mainOrder?.sku_module) ? mainOrder.sku_module : []

  const headers = [
    "Order ID",
    "Order Line IDs",
    "SKU ID",
    "Product",
    "SKU Name",
    "Seller SKU",
    "Qty",
    "Unit Price",
    "Total"
  ]

  if (!items.length) {
    return { headers, rows: [], copy: "" }
  }

  const orderId = mainOrder?.main_order_id || ""

  const rows = items.map((item: Record<string, any>) => {
    const orderLineIds = Array.isArray(item.order_line_ids)
      ? item.order_line_ids.join(",")
      : ""

    return [
      orderId,
      orderLineIds,
      item.sku_id || "",
      item.product_name || "",
      item.sku_name || "",
      item.seller_sku_name || "",
      item.quantity ?? "",
      formatTikTokAmount(item.sku_unit_price),
      formatTikTokAmount(item.sku_total_price)
    ].map(sanitizeCell)
  })

  const copy = rows.map((row) => row.join("\t")).join("\n")
  return { headers, rows, copy }
}

const buildTikTokIncomeSheet = (
  incomeRawJson: Record<string, unknown> | null
): SheetData => {
  const data = isObject(incomeRawJson?.data) ? incomeRawJson.data : null
  const records = Array.isArray(data?.order_records)
    ? data.order_records
    : []

  const headers = [
    "Order ID",
    "Settlement",
    "Earning",
    "Fees",
    "Shipping",
    "Placed Time",
    "Status"
  ]

  if (!records.length) {
    return { headers, rows: [], copy: "" }
  }

  const rows = records.map((record: Record<string, any>) => {
    return [
      record.reference_id || record.trade_order_id || "",
      formatTikTokAmount(record.settlement_amount),
      formatTikTokAmount(record.earning_amount),
      formatTikTokAmount(record.fees),
      formatTikTokAmount(record.shipping_amount),
      record.placed_time || "",
      record.settlement_status || ""
    ].map(sanitizeCell)
  })

  const copy = rows.map((row) => row.join("\t")).join("\n")
  return { headers, rows, copy }
}

export const buildViewerSheets = (payload: ViewerPayload | null) => {
  if (!payload) {
    return {
      orderSheet: { headers: [], rows: [], copy: "" } as SheetData,
      incomeSheet: { headers: [], rows: [], copy: "" } as SheetData
    }
  }

  if (payload.marketplace === "shopee") {
    return {
      orderSheet: buildShopeeOrderSheet(payload.orderRawJson, payload.updatedAt),
      incomeSheet: buildShopeeIncomeSheet(payload.incomeRawJson)
    }
  }

  return {
    orderSheet: buildTikTokOrderSheet(payload.orderRawJson),
    incomeSheet: buildTikTokIncomeSheet(payload.incomeRawJson)
  }
}
