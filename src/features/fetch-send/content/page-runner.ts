import type { ActionMode } from "~src/core/messages/contracts"

export interface PageRunnerRequest {
  marketplace: "shopee" | "tiktok_shop"
  actionMode: ActionMode
  components: string
  endpoints: {
    incomeEndpoint?: string
    orderEndpoint: string
    statementEndpoint?: string
    statementDetailEndpoint?: string
  }
}

export interface PageRunnerResult {
  ok: boolean
  error?: string
  orderRawJson: Record<string, unknown> | null
  incomeRawJson: Record<string, unknown> | null
  incomeDetailRawJson: Record<string, unknown> | null
  fetchMeta?: Record<string, unknown>
}

export const runMarketplaceFetchInPage = async (
  request: PageRunnerRequest
): Promise<PageRunnerResult> => {
  const safeJson = (raw: string) => {
    try {
      return JSON.parse(raw)
    } catch (_error) {
      return null
    }
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const waitForDocumentReady = async (timeoutMs = 6000) => {
    if (document.readyState === "complete") return true

    await Promise.race([
      new Promise((resolve) => {
        window.addEventListener("load", resolve, { once: true })
      }),
      sleep(timeoutMs)
    ])

    // Any non-loading state is sufficient for fetch-based scraping steps.
    return document.readyState !== "loading"
  }

  const hasPerfEntry = (keyword: string) => {
    const entries = performance.getEntriesByType("resource") || []
    return entries.some((entry) => String((entry as PerformanceResourceTiming)?.name || "").includes(keyword))
  }

  const waitForPerfEntries = async (
    keywords: string[],
    timeoutMs = 6000,
    intervalMs = 400
  ) => {
    const start = Date.now()

    while (Date.now() - start <= timeoutMs) {
      const ok = keywords.every((keyword) => hasPerfEntry(keyword))
      if (ok) return true
      await sleep(intervalMs)
    }

    return false
  }

  const waitForTikTokReady = async (keywords: string[]) => {
    await Promise.race([waitForPerfEntries(keywords), waitForDocumentReady()])
  }

  const pickCookie = (name: string) => {
    const pair = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`))

    if (!pair) return ""

    const raw = pair.slice(pair.indexOf("=") + 1)

    try {
      return decodeURIComponent(raw)
    } catch (_error) {
      return raw
    }
  }

  const ensureShopeeParams = (url: URL) => {
    const cdsCookie = pickCookie("SPC_CDS")
    const cdsVerCookie = pickCookie("SPC_CDS_VER")

    if (!url.searchParams.get("SPC_CDS") && cdsCookie) {
      url.searchParams.set("SPC_CDS", cdsCookie)
    }

    if (!url.searchParams.get("SPC_CDS_VER")) {
      if (cdsVerCookie) {
        url.searchParams.set("SPC_CDS_VER", cdsVerCookie)
      } else {
        url.searchParams.set("SPC_CDS_VER", "2")
      }
    }
  }

  const parseShopeeOrderId = () => {
    const params = new URLSearchParams(location.search || "")
    const fromQuery = params.get("order_id") || params.get("orderId")
    if (fromQuery) return fromQuery

    const pathMatch = location.pathname.match(/order\/(detail\/)?(\d+)/)
    return pathMatch ? pathMatch[2] : ""
  }

  const parseTikTokOrderId = () => {
    const params = new URLSearchParams(location.search || "")
    const fromQuery =
      params.get("order_no") ||
      params.get("orderNo") ||
      params.get("main_order_id") ||
      params.get("order_id")

    if (fromQuery) return fromQuery

    const pathMatch = location.pathname.match(/order\/(detail\/)?(\d+)/)
    return pathMatch ? pathMatch[2] : ""
  }

  const parseComponents = (raw: string) => {
    const list = String(raw || "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((num) => Number.isFinite(num))

    return list.length ? list : [2, 3, 4, 5]
  }

  const pickLatestResourceUrl = (
    keyword: string,
    paramKey?: string,
    paramValue?: string
  ) => {
    const entries = performance.getEntriesByType("resource") || []

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const resourceName = String((entries[i] as PerformanceResourceTiming)?.name || "")
      if (!resourceName.includes(keyword)) continue

      if (paramKey && paramValue) {
        try {
          const parsed = new URL(resourceName)
          if (parsed.searchParams.get(paramKey) !== String(paramValue)) {
            continue
          }
        } catch (_error) {
          continue
        }
      }

      return resourceName
    }

    return ""
  }

  const pageFetcherShopee = async () => {
    const orderId = parseShopeeOrderId()
    if (!orderId) {
      return { error: "Order ID tidak ditemukan (buka halaman order Shopee)" }
    }

    const incomeEndpoint = request.endpoints.incomeEndpoint
    const orderEndpoint = request.endpoints.orderEndpoint

    if (!incomeEndpoint || !orderEndpoint) {
      return { error: "Endpoint Shopee belum lengkap." }
    }

    const incomeUrl = new URL(incomeEndpoint)
    ensureShopeeParams(incomeUrl)
    incomeUrl.searchParams.set("order_id", orderId)

    const orderUrl = new URL(orderEndpoint)
    ensureShopeeParams(orderUrl)
    orderUrl.searchParams.set("order_id", orderId)

    const incomeResp = await fetch(incomeUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        accept: "application/json, text/plain, */*"
      },
      credentials: "include",
      body: JSON.stringify({
        order_id: Number(orderId) || orderId,
        components: parseComponents(request.components)
      })
    })

    const incomeBody = await incomeResp.text()
    const incomeJson = safeJson(incomeBody)

    const orderResp = await fetch(orderUrl.toString(), {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*"
      },
      credentials: "include"
    })

    const orderBody = await orderResp.text()
    const orderJson = safeJson(orderBody)

    return {
      orderId,
      income: {
        ok: incomeResp.ok,
        status: incomeResp.status,
        statusText: incomeResp.statusText,
        appCode: incomeJson?.code,
        appMessage: incomeJson?.message,
        body: incomeBody
      },
      order: {
        ok: orderResp.ok,
        status: orderResp.status,
        statusText: orderResp.statusText,
        appCode: orderJson?.code,
        appMessage: orderJson?.message,
        body: orderBody
      }
    }
  }

  const pageFetcherShopeeIncomeOnly = async () => {
    const orderId = parseShopeeOrderId()
    if (!orderId) {
      return { error: "Order ID tidak ditemukan (buka halaman order Shopee)" }
    }

    const incomeEndpoint = request.endpoints.incomeEndpoint
    if (!incomeEndpoint) {
      return { error: "Endpoint income Shopee belum diatur." }
    }

    const incomeUrl = new URL(incomeEndpoint)
    ensureShopeeParams(incomeUrl)
    incomeUrl.searchParams.set("order_id", orderId)

    const incomeResp = await fetch(incomeUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        accept: "application/json, text/plain, */*"
      },
      credentials: "include",
      body: JSON.stringify({
        order_id: Number(orderId) || orderId,
        components: parseComponents(request.components)
      })
    })

    const incomeBody = await incomeResp.text()

    return {
      orderId,
      income: {
        ok: incomeResp.ok,
        status: incomeResp.status,
        statusText: incomeResp.statusText,
        body: incomeBody
      }
    }
  }

  const pageFetcherShopeeOrderOnly = async () => {
    const orderId = parseShopeeOrderId()
    if (!orderId) {
      return { error: "Order ID tidak ditemukan (buka halaman order Shopee)" }
    }

    const orderEndpoint = request.endpoints.orderEndpoint
    const orderUrl = new URL(orderEndpoint)
    ensureShopeeParams(orderUrl)
    orderUrl.searchParams.set("order_id", orderId)

    const orderResp = await fetch(orderUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json, text/plain, */*" },
      credentials: "include"
    })

    const orderBody = await orderResp.text()
    const orderJson = safeJson(orderBody)

    return {
      orderId,
      order: {
        ok: orderResp.ok,
        status: orderResp.status,
        statusText: orderResp.statusText,
        appCode: orderJson?.code,
        appMessage: orderJson?.message,
        body: orderBody
      }
    }
  }

  const pageFetcherTikTokFull = async () => {
    await waitForTikTokReady([
      "/api/fulfillment/order/get",
      "/api/v1/pay/statement/order/list"
    ])

    const orderId = parseTikTokOrderId()
    if (!orderId) {
      return { error: "Order ID tidak ditemukan (buka halaman order detail TikTok)" }
    }

    const orderEndpoint = request.endpoints.orderEndpoint
    const statementEndpoint = request.endpoints.statementEndpoint
    const statementDetailEndpoint = request.endpoints.statementDetailEndpoint

    if (!orderEndpoint || !statementEndpoint || !statementDetailEndpoint) {
      return { error: "Endpoint TikTok belum lengkap." }
    }

    const perfOrderUrl = pickLatestResourceUrl("/api/fulfillment/order/get")
    const perfStatementUrl = pickLatestResourceUrl(
      "/api/v1/pay/statement/order/list",
      "reference_id",
      orderId
    )

    const orderUrl = new URL(perfOrderUrl || orderEndpoint)
    const statementUrl = new URL(perfStatementUrl || statementEndpoint)

    if (!perfStatementUrl && perfOrderUrl) {
      for (const [key, value] of orderUrl.searchParams.entries()) {
        if (!statementUrl.searchParams.has(key)) {
          statementUrl.searchParams.set(key, value)
        }
      }
    }

    const ensureParam = (key: string, value: string) => {
      if (!statementUrl.searchParams.has(key)) {
        statementUrl.searchParams.set(key, value)
      }
    }

    ensureParam("pagination_type", "1")
    ensureParam("from", "0")
    ensureParam("size", "5")
    ensureParam("cursor", "")
    ensureParam("page_type", "12")
    ensureParam("need_total_amount", "true")

    if (!statementUrl.searchParams.get("reference_id")) {
      statementUrl.searchParams.set("reference_id", orderId)
    }

    const orderResp = await fetch(orderUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        accept: "application/json, text/plain, */*"
      },
      credentials: "include",
      body: JSON.stringify({ main_order_id: [String(orderId)] })
    })

    const orderBody = await orderResp.text()
    const orderJson = safeJson(orderBody)

    const statementResp = await fetch(statementUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json, text/plain, */*" },
      credentials: "include"
    })

    const statementBody = await statementResp.text()
    const statementJson = safeJson(statementBody)

    const records = statementJson?.data?.order_records || []
    const matchedRecord =
      records.find((record: Record<string, unknown>) => {
        return String(record?.reference_id || "") === String(orderId)
      }) ||
      records.find((record: Record<string, unknown>) => {
        return String(record?.trade_order_id || "") === String(orderId)
      }) ||
      records[0]

    const statementDetailId = String(matchedRecord?.statement_detail_id || "")

    let detailResp: Response | null = null
    let detailBody = ""
    let detailJson: Record<string, unknown> | null = null
    let detailFinalUrl = ""

    if (statementDetailId) {
      const perfDetailUrl = pickLatestResourceUrl(
        "/api/v1/pay/statement/transaction/detail",
        "statement_detail_id",
        statementDetailId
      )

      const detailUrl = new URL(perfDetailUrl || statementDetailEndpoint)

      if (!perfDetailUrl) {
        for (const [key, value] of statementUrl.searchParams.entries()) {
          if (!detailUrl.searchParams.has(key)) {
            detailUrl.searchParams.set(key, value)
          }
        }

        ;[
          "reference_id",
          "pagination_type",
          "from",
          "size",
          "cursor",
          "need_total_amount",
          "page_type",
          "settlement_status",
          "no_need_sku_record",
          "X-Bogus",
          "X-Gnarly"
        ].forEach((key) => detailUrl.searchParams.delete(key))
      }

      if (!detailUrl.searchParams.has("terminal_type")) {
        detailUrl.searchParams.set("terminal_type", "1")
      }
      if (!detailUrl.searchParams.has("page_type")) {
        detailUrl.searchParams.set("page_type", "8")
      }
      if (!detailUrl.searchParams.has("statement_version")) {
        detailUrl.searchParams.set("statement_version", "0")
      }

      detailUrl.searchParams.set("statement_detail_id", statementDetailId)
      detailFinalUrl = detailUrl.toString()

      detailResp = await fetch(detailFinalUrl, {
        method: "GET",
        headers: { accept: "application/json, text/plain, */*" },
        credentials: "include"
      })

      detailBody = await detailResp.text()
      detailJson = safeJson(detailBody)
    } else {
      detailBody = "{\"error\":\"statement_detail_id not found\"}"
    }

    return {
      orderId,
      statementDetailId,
      income: {
        ok: statementResp.ok,
        status: statementResp.status,
        statusText: statementResp.statusText,
        appCode: statementJson?.code,
        appMessage: statementJson?.message,
        body: statementBody,
        finalUrl: statementUrl.toString()
      },
      incomeDetail: {
        ok: detailResp ? detailResp.ok : false,
        status: detailResp ? detailResp.status : 0,
        statusText: detailResp
          ? detailResp.statusText
          : "statement_detail_id missing",
        appCode: detailJson?.code,
        appMessage: detailJson?.message,
        body: detailBody,
        finalUrl: detailFinalUrl
      },
      order: {
        ok: orderResp.ok,
        status: orderResp.status,
        statusText: orderResp.statusText,
        appCode: orderJson?.code,
        appMessage: orderJson?.message,
        body: orderBody,
        finalUrl: orderUrl.toString()
      }
    }
  }

  const pageFetcherTikTokOrderOnly = async () => {
    await waitForTikTokReady(["/api/fulfillment/order/get"])

    const orderId = parseTikTokOrderId()
    if (!orderId) {
      return { error: "Order ID tidak ditemukan (buka halaman order detail TikTok)" }
    }

    const perfOrderUrl = pickLatestResourceUrl("/api/fulfillment/order/get")
    const orderUrl = new URL(perfOrderUrl || request.endpoints.orderEndpoint)

    const orderResp = await fetch(orderUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        accept: "application/json, text/plain, */*"
      },
      credentials: "include",
      body: JSON.stringify({ main_order_id: [String(orderId)] })
    })

    const orderBody = await orderResp.text()
    const orderJson = safeJson(orderBody)

    return {
      orderId,
      order: {
        ok: orderResp.ok,
        status: orderResp.status,
        statusText: orderResp.statusText,
        appCode: orderJson?.code,
        appMessage: orderJson?.message,
        body: orderBody,
        finalUrl: orderUrl.toString()
      }
    }
  }

  const pageFetcherTikTokIncomeOnly = async () => {
    await waitForTikTokReady(["/api/v1/pay/statement/order/list"])

    const orderId = parseTikTokOrderId()
    if (!orderId) {
      return { error: "Order ID tidak ditemukan (buka halaman order detail TikTok)" }
    }

    const statementEndpoint = request.endpoints.statementEndpoint
    const statementDetailEndpoint = request.endpoints.statementDetailEndpoint

    if (!statementEndpoint || !statementDetailEndpoint) {
      return { error: "Endpoint statement TikTok belum lengkap." }
    }

    const perfStatementUrl = pickLatestResourceUrl(
      "/api/v1/pay/statement/order/list",
      "reference_id",
      orderId
    )
    const statementUrl = new URL(perfStatementUrl || statementEndpoint)

    if (!statementUrl.searchParams.get("reference_id")) {
      statementUrl.searchParams.set("reference_id", orderId)
    }

    if (!statementUrl.searchParams.has("pagination_type")) {
      statementUrl.searchParams.set("pagination_type", "1")
    }
    if (!statementUrl.searchParams.has("from")) {
      statementUrl.searchParams.set("from", "0")
    }
    if (!statementUrl.searchParams.has("size")) {
      statementUrl.searchParams.set("size", "5")
    }
    if (!statementUrl.searchParams.has("cursor")) {
      statementUrl.searchParams.set("cursor", "")
    }
    if (!statementUrl.searchParams.has("page_type")) {
      statementUrl.searchParams.set("page_type", "12")
    }
    if (!statementUrl.searchParams.has("need_total_amount")) {
      statementUrl.searchParams.set("need_total_amount", "true")
    }

    const statementResp = await fetch(statementUrl.toString(), {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*"
      },
      credentials: "include"
    })

    const statementBody = await statementResp.text()
    const statementJson = safeJson(statementBody)

    const records = statementJson?.data?.order_records || []
    const matchedRecord =
      records.find((record: Record<string, unknown>) => {
        return String(record?.reference_id || "") === String(orderId)
      }) ||
      records.find((record: Record<string, unknown>) => {
        return String(record?.trade_order_id || "") === String(orderId)
      }) ||
      records[0]

    const statementDetailId = String(matchedRecord?.statement_detail_id || "")

    let detailResp: Response | null = null
    let detailBody = ""
    let detailJson: Record<string, unknown> | null = null

    if (statementDetailId) {
      const perfDetailUrl = pickLatestResourceUrl(
        "/api/v1/pay/statement/transaction/detail",
        "statement_detail_id",
        statementDetailId
      )
      const detailUrl = new URL(perfDetailUrl || statementDetailEndpoint)

      detailUrl.searchParams.set("statement_detail_id", statementDetailId)
      if (!detailUrl.searchParams.has("terminal_type")) {
        detailUrl.searchParams.set("terminal_type", "1")
      }
      if (!detailUrl.searchParams.has("page_type")) {
        detailUrl.searchParams.set("page_type", "8")
      }
      if (!detailUrl.searchParams.has("statement_version")) {
        detailUrl.searchParams.set("statement_version", "0")
      }

      detailResp = await fetch(detailUrl.toString(), {
        method: "GET",
        headers: {
          accept: "application/json, text/plain, */*"
        },
        credentials: "include"
      })

      detailBody = await detailResp.text()
      detailJson = safeJson(detailBody)
    } else {
      detailBody = "{\"error\":\"statement_detail_id not found\"}"
    }

    return {
      orderId,
      statementDetailId,
      income: {
        ok: statementResp.ok,
        status: statementResp.status,
        statusText: statementResp.statusText,
        appCode: statementJson?.code,
        appMessage: statementJson?.message,
        body: statementBody
      },
      incomeDetail: {
        ok: detailResp ? detailResp.ok : false,
        status: detailResp ? detailResp.status : 0,
        statusText: detailResp
          ? detailResp.statusText
          : "statement_detail_id missing",
        appCode: detailJson?.code,
        appMessage: detailJson?.message,
        body: detailBody
      }
    }
  }

  try {
    const incomeOnly = request.actionMode === "update_income"
    const orderOnly = request.actionMode === "update_order"

    if (request.marketplace === "shopee" && orderOnly) {
      const result = await pageFetcherShopeeOrderOnly()
      if (result.error) {
        return {
          ok: false,
          error: result.error,
          orderRawJson: null,
          incomeRawJson: null,
          incomeDetailRawJson: null
        }
      }

      const orderJson = safeJson(result.order?.body || "")
      const orderOk = result.order?.ok && (orderJson?.code ?? 0) === 0

      return {
        ok: Boolean(orderOk),
        orderRawJson: orderJson,
        incomeRawJson: null,
        incomeDetailRawJson: null,
        fetchMeta: { order: result.order }
      }
    }

    if (request.marketplace === "shopee" && incomeOnly) {
      const result = await pageFetcherShopeeIncomeOnly()
      if (result.error) {
        return {
          ok: false,
          error: result.error,
          orderRawJson: null,
          incomeRawJson: null,
          incomeDetailRawJson: null
        }
      }

      const incomeJson = safeJson(result.income?.body || "")
      const incomeOk = Boolean(result.income?.ok)

      return {
        ok: incomeOk,
        orderRawJson: null,
        incomeRawJson: incomeJson,
        incomeDetailRawJson: null,
        fetchMeta: { income: result.income }
      }
    }

    if (request.marketplace === "shopee") {
      const result = await pageFetcherShopee()
      if (result.error) {
        return {
          ok: false,
          error: result.error,
          orderRawJson: null,
          incomeRawJson: null,
          incomeDetailRawJson: null
        }
      }

      const orderJson = safeJson(result.order?.body || "")
      const incomeJson = safeJson(result.income?.body || "")

      const orderOk = Boolean(result.order?.ok && (orderJson?.code ?? 0) === 0)
      const incomeOk = Boolean(result.income?.ok && (incomeJson?.code ?? 0) === 0)

      return {
        ok: orderOk && incomeOk,
        orderRawJson: orderJson,
        incomeRawJson: incomeJson,
        incomeDetailRawJson: null,
        fetchMeta: {
          order: result.order,
          income: result.income
        }
      }
    }

    if (request.marketplace === "tiktok_shop" && orderOnly) {
      const result = await pageFetcherTikTokOrderOnly()
      if (result.error) {
        return {
          ok: false,
          error: result.error,
          orderRawJson: null,
          incomeRawJson: null,
          incomeDetailRawJson: null
        }
      }

      const orderJson = safeJson(result.order?.body || "")
      const orderOk = Boolean(result.order?.ok && (orderJson?.code ?? 0) === 0)

      return {
        ok: orderOk,
        orderRawJson: orderJson,
        incomeRawJson: null,
        incomeDetailRawJson: null,
        fetchMeta: { order: result.order }
      }
    }

    if (request.marketplace === "tiktok_shop" && incomeOnly) {
      const result = await pageFetcherTikTokIncomeOnly()
      if (result.error) {
        return {
          ok: false,
          error: result.error,
          orderRawJson: null,
          incomeRawJson: null,
          incomeDetailRawJson: null
        }
      }

      const incomeJson = safeJson(result.income?.body || "")
      const detailJson = safeJson(result.incomeDetail?.body || "")

      const incomeOk = Boolean(result.income?.ok && (incomeJson?.code ?? 0) === 0)
      const detailOk = Boolean(result.incomeDetail?.ok && (detailJson?.code ?? 0) === 0)
      const detailMissing = !detailOk

      return {
        ok: incomeOk && (detailOk || detailMissing),
        orderRawJson: null,
        incomeRawJson: incomeJson,
        incomeDetailRawJson: detailOk ? detailJson : null,
        fetchMeta: {
          income: result.income,
          incomeDetail: result.incomeDetail
        }
      }
    }

    const result = await pageFetcherTikTokFull()
    if (result.error) {
      return {
        ok: false,
        error: result.error,
        orderRawJson: null,
        incomeRawJson: null,
        incomeDetailRawJson: null
      }
    }

    const orderJson = safeJson(result.order?.body || "")
    const incomeJson = safeJson(result.income?.body || "")
    const detailJson = safeJson(result.incomeDetail?.body || "")

    const orderOk = Boolean(result.order?.ok && (orderJson?.code ?? 0) === 0)
    const incomeOk = Boolean(result.income?.ok && (incomeJson?.code ?? 0) === 0)
    const detailOk = Boolean(result.incomeDetail?.ok && (detailJson?.code ?? 0) === 0)
    const detailMissing = !detailOk

    return {
      ok: orderOk && incomeOk && (detailOk || detailMissing),
      orderRawJson: orderJson,
      incomeRawJson: incomeJson,
      incomeDetailRawJson: detailOk ? detailJson : null,
      fetchMeta: {
        order: result.order,
        income: result.income,
        incomeDetail: result.incomeDetail
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message || error || "Unknown error"),
      orderRawJson: null,
      incomeRawJson: null,
      incomeDetailRawJson: null
    }
  }
}
