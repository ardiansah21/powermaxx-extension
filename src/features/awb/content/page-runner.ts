export interface PageAwbRunnerRequest {
  marketplace: "shopee" | "tiktok_shop"
  endpoints: {
    orderEndpoint: string
    packageEndpoint?: string
    createJobEndpoint?: string
    downloadJobEndpoint?: string
    generateEndpoint?: string
  }
  options: {
    regionId?: string
    asyncSdVersion?: string
    fileType?: string
    fileName?: string
    fileContents?: string
    filePrefix?: string
  }
}

export interface PageAwbRunnerResult {
  ok: boolean
  error?: string
  downloaded?: boolean
  fileName?: string
  openUrl?: string
  printUrl?: string
  step?: string
  detail?: string
  jobId?: string
}

const safeJson = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, any>
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

  return document.readyState !== "loading"
}

const hasPerfEntry = (keyword: string) => {
  const entries = performance.getEntriesByType("resource") || []
  return entries.some((entry) =>
    String((entry as PerformanceResourceTiming)?.name || "").includes(keyword)
  )
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

const pickLatestResourceUrl = (
  keyword: string,
  paramKey?: string,
  paramValue?: string
) => {
  const entries = performance.getEntriesByType("resource") || []

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const resourceName = String(
      (entries[i] as PerformanceResourceTiming)?.name || ""
    )
    if (!resourceName.includes(keyword)) continue

    if (paramKey && paramValue) {
      try {
        const parsed = new URL(resourceName)
        if (parsed.searchParams.get(paramKey) !== String(paramValue)) continue
      } catch (_error) {
        continue
      }
    }

    return resourceName
  }

  return ""
}

const pickCookie = (name: string) => {
  const pair = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))

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

const createTimestamp = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")

  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

const parseFileContents = (raw: string) => {
  const parts = String(raw || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))

  return parts.length ? parts : [3]
}

const sanitizeFilePart = (value: unknown) =>
  String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "")

const runShopeeAwb = async (
  request: PageAwbRunnerRequest
): Promise<PageAwbRunnerResult> => {
  const { endpoints, options } = request

  if (
    !endpoints.orderEndpoint ||
    !endpoints.packageEndpoint ||
    !endpoints.createJobEndpoint ||
    !endpoints.downloadJobEndpoint
  ) {
    return {
      ok: false,
      error: "Endpoint AWB Shopee belum lengkap.",
      step: "validate"
    }
  }

  const orderId = parseShopeeOrderId()
  if (!orderId) {
    return {
      ok: false,
      error: "Order ID tidak ditemukan (buka halaman order Shopee).",
      step: "parse_order"
    }
  }

  try {
    const orderUrl = new URL(endpoints.orderEndpoint)
    ensureShopeeParams(orderUrl)
    orderUrl.searchParams.set("order_id", orderId)

    const orderResp = await fetch(orderUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json, text/plain, */*" },
      credentials: "include"
    })
    const orderRaw = await orderResp.text()
    const orderJson = safeJson(orderRaw)

    if (!orderResp.ok || orderJson?.code !== 0) {
      return {
        ok: false,
        error: `Get order gagal ${orderResp.status}`,
        detail: orderRaw,
        step: "get_order"
      }
    }

    const shopId = orderJson?.data?.shop_id
    if (!shopId) {
      return {
        ok: false,
        error: "shop_id tidak ditemukan.",
        detail: orderRaw,
        step: "get_order"
      }
    }

    const packageUrl = new URL(endpoints.packageEndpoint)
    ensureShopeeParams(packageUrl)
    packageUrl.searchParams.set("order_id", orderId)

    const packageResp = await fetch(packageUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json, text/plain, */*" },
      credentials: "include"
    })
    const packageRaw = await packageResp.text()
    const packageJson = safeJson(packageRaw)

    if (!packageResp.ok || packageJson?.code !== 0) {
      return {
        ok: false,
        error: `Get package gagal ${packageResp.status}`,
        detail: packageRaw,
        step: "get_package"
      }
    }

    const orderInfo = packageJson?.data?.order_info
    const packages = Array.isArray(orderInfo?.package_list)
      ? orderInfo.package_list
      : []

    if (!packages.length) {
      return {
        ok: false,
        error: "Package list kosong.",
        detail: packageRaw,
        step: "get_package"
      }
    }

    const orderIdNumber = Number(orderId)
    const orderIdPayload = Number.isFinite(orderIdNumber) ? orderIdNumber : orderId
    const groupMap = new Map<
      number,
      {
        primary_package_number: string
        group_shipment_id: number
        package_list: Array<{ order_id: string | number; package_number: string }>
      }
    >()

    packages.forEach((pkg: Record<string, any>) => {
      const groupRaw = pkg?.items?.[0]?.group_id ?? pkg?.group_id ?? 0
      const groupNumber = Number(groupRaw)
      const groupId = Number.isFinite(groupNumber) ? groupNumber : 0

      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          primary_package_number: String(pkg?.package_number || ""),
          group_shipment_id: groupId,
          package_list: []
        })
      }

      groupMap.get(groupId)?.package_list.push({
        order_id: orderIdPayload,
        package_number: String(pkg?.package_number || "")
      })
    })

    const groupList = Array.from(groupMap.values()).filter(
      (group) => group.primary_package_number
    )

    if (!groupList.length) {
      return {
        ok: false,
        error: "Group list kosong.",
        detail: packageRaw,
        step: "group_list"
      }
    }

    const channelId =
      packages[0]?.channel_id ??
      packages[0]?.fulfillment_channel_id ??
      packages[0]?.shipping_method ??
      orderJson?.data?.fulfillment_channel_id ??
      orderJson?.data?.checkout_channel_id ??
      0

    if (!channelId) {
      return {
        ok: false,
        error: "channel_id tidak ditemukan.",
        detail: packageRaw,
        step: "group_list"
      }
    }

    const createUrl = new URL(endpoints.createJobEndpoint)
    ensureShopeeParams(createUrl)
    const asyncVersion = String(options.asyncSdVersion || "").trim()
    if (asyncVersion) {
      createUrl.searchParams.set("async_sd_version", asyncVersion)
    }

    const orderSn = String(orderJson?.data?.order_sn || "")
    const safeOrderSn =
      sanitizeFilePart(orderSn) || sanitizeFilePart(orderId) || "order"
    const downloadedFileName = `${createTimestamp()}_SHOPEE_${safeOrderSn}.pdf`
    const fileName = String(options.fileName || "").trim()
    const createFileName = fileName || downloadedFileName.replace(/\.pdf$/i, "")

    const createResp = await fetch(createUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        accept: "application/json, text/plain, */*"
      },
      credentials: "include",
      body: JSON.stringify({
        group_list: groupList,
        region_id: String(options.regionId || "ID").trim(),
        shop_id: shopId,
        channel_id: channelId,
        generate_file_details: [
          {
            file_type: String(options.fileType || "THERMAL_PDF"),
            file_name: createFileName,
            file_contents: parseFileContents(String(options.fileContents || "3"))
          }
        ],
        record_generate_schema: false
      })
    })

    const createRaw = await createResp.text()
    const createJson = safeJson(createRaw)

    if (!createResp.ok || createJson?.code !== 0) {
      return {
        ok: false,
        error: `Create SD job gagal ${createResp.status}`,
        detail: createRaw,
        step: "create_job"
      }
    }

    const job = createJson?.data?.list?.[0]
    const jobId = String(job?.job_id || "")
    if (!jobId) {
      return {
        ok: false,
        error: "job_id tidak ditemukan.",
        detail: createRaw,
        step: "create_job"
      }
    }

    const downloadUrl = new URL(endpoints.downloadJobEndpoint)
    ensureShopeeParams(downloadUrl)
    downloadUrl.searchParams.set("job_id", jobId)
    downloadUrl.searchParams.set("is_first_time", String(job?.is_first_time ?? 0))

    const downloadResp = await fetch(downloadUrl.toString(), {
      method: "GET",
      headers: { accept: "application/pdf, application/json, */*" },
      credentials: "include"
    })

    const contentType = String(downloadResp.headers.get("content-type") || "")
    if (
      downloadResp.ok &&
      (contentType.includes("pdf") ||
        contentType.includes("force-download") ||
        contentType.includes("octet-stream"))
    ) {
      const blob = await downloadResp.blob()
      const blobUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = blobUrl
      anchor.download = downloadedFileName
      anchor.style.display = "none"
      document.body.appendChild(anchor)
      anchor.click()
      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl)
        anchor.remove()
      }, 1000)

      return {
        ok: true,
        downloaded: true,
        fileName: downloadedFileName,
        jobId
      }
    }

    return {
      ok: true,
      downloaded: false,
      fileName: downloadedFileName,
      jobId
    }
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message || error),
      step: "runtime"
    }
  }
}

const runTikTokAwb = async (
  request: PageAwbRunnerRequest
): Promise<PageAwbRunnerResult> => {
  const { endpoints, options } = request
  if (!endpoints.orderEndpoint || !endpoints.generateEndpoint) {
    return {
      ok: false,
      error: "Endpoint AWB TikTok belum lengkap.",
      step: "validate"
    }
  }

  try {
    await waitForTikTokReady(["/api/fulfillment/order/get"])

    const orderId = parseTikTokOrderId()
    if (!orderId) {
      return {
        ok: false,
        error: "Order ID tidak ditemukan (buka halaman order TikTok).",
        step: "parse_order"
      }
    }

    const perfOrderUrl = pickLatestResourceUrl("/api/fulfillment/order/get")
    const perfGenerateUrl = pickLatestResourceUrl(
      "/api/v1/fulfillment/shipping_doc/generate"
    )

    const orderUrl = new URL(perfOrderUrl || endpoints.orderEndpoint)
    const generateUrl = new URL(perfGenerateUrl || endpoints.generateEndpoint)

    if (!perfGenerateUrl && perfOrderUrl) {
      for (const [key, value] of orderUrl.searchParams.entries()) {
        if (!generateUrl.searchParams.has(key)) {
          generateUrl.searchParams.set(key, value)
        }
      }
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
    const orderRaw = await orderResp.text()
    const orderJson = safeJson(orderRaw)

    if (!orderResp.ok || orderJson?.code !== 0) {
      return {
        ok: false,
        error: `Get order gagal ${orderResp.status}`,
        detail: orderRaw,
        step: "get_order"
      }
    }

    const mainOrder = orderJson?.data?.main_order?.[0]
    const fulfillUnitIds: string[] = []
    const pushFulfillId = (value: unknown) => {
      const normalized = String(value || "").trim()
      if (!normalized) return
      fulfillUnitIds.push(normalized)
    }

    const mapper = Array.isArray(mainOrder?.fulfill_unit_id_mapper)
      ? mainOrder.fulfill_unit_id_mapper
      : []
    mapper.forEach((item: Record<string, unknown>) =>
      pushFulfillId(item?.fulfill_unit_id)
    )

    const fromModule = (modules: unknown) => {
      if (!Array.isArray(modules)) return
      modules.forEach((item) => {
        if (typeof item !== "object" || !item) return
        pushFulfillId((item as Record<string, unknown>).fulfill_unit_id)
      })
    }

    fromModule(mainOrder?.fulfillment_module)
    fromModule(mainOrder?.delivery_module)
    fromModule(mainOrder?.print_label_module)

    const uniqueIds = Array.from(new Set(fulfillUnitIds))
    if (!uniqueIds.length) {
      return {
        ok: false,
        error: "fulfill_unit_id tidak ditemukan.",
        detail: orderRaw,
        step: "collect_fulfill_ids"
      }
    }

    const filePrefix = String(options.filePrefix || "").trim() || "Shipping label"
    const downloadedFileName = `${createTimestamp()}_TIKTOKSHOP_${orderId}.pdf`

    const generateResp = await fetch(generateUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        accept: "application/json, text/plain, */*"
      },
      credentials: "include",
      body: JSON.stringify({
        fulfill_unit_id_list: uniqueIds,
        content_type_list: [1],
        template_type: 0,
        op_scene: 2,
        file_prefix: filePrefix,
        request_time: Date.now(),
        print_option: {
          tmpl: 0,
          template_size: 0,
          layout: [0]
        },
        print_source: 101
      })
    })

    const generateRaw = await generateResp.text()
    const generateJson = safeJson(generateRaw)

    if (!generateResp.ok || generateJson?.code !== 0) {
      return {
        ok: false,
        error: `Generate label gagal ${generateResp.status}`,
        detail: generateRaw,
        step: "generate"
      }
    }

    const docUrl = String(generateJson?.data?.doc_url || "").trim()
    if (!docUrl) {
      return {
        ok: false,
        error: "doc_url tidak ditemukan.",
        detail: generateRaw,
        step: "generate"
      }
    }

    const downloadResp = await fetch(docUrl, {
      method: "GET",
      headers: { accept: "application/pdf, application/json, */*" },
      credentials: "include"
    })

    const contentType = String(downloadResp.headers.get("content-type") || "")
    if (
      downloadResp.ok &&
      (contentType.includes("pdf") || contentType.includes("octet-stream"))
    ) {
      const blob = await downloadResp.blob()
      const blobUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = blobUrl
      anchor.download = downloadedFileName
      anchor.style.display = "none"
      document.body.appendChild(anchor)
      anchor.click()
      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl)
        anchor.remove()
      }, 1000)

      return {
        ok: true,
        downloaded: true,
        fileName: downloadedFileName,
        openUrl: docUrl
      }
    }

    return {
      ok: true,
      downloaded: false,
      fileName: downloadedFileName,
      openUrl: docUrl
    }
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message || error),
      step: "runtime"
    }
  }
}

export const runMarketplaceAwbInPage = async (
  request: PageAwbRunnerRequest
): Promise<PageAwbRunnerResult> => {
  if (request.marketplace === "shopee") {
    return runShopeeAwb(request)
  }

  return runTikTokAwb(request)
}
