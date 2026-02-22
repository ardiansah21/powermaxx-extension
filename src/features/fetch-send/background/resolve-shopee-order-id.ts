const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitForTabComplete = (tabId: number) =>
  new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, 15000)

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId) return
      if (info.status === "complete") {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }

    chrome.tabs.onUpdated.addListener(listener)
  })

let shopeeSearchTabId: number | null = null

const ensureShopeeSearchTab = async () => {
  if (shopeeSearchTabId) {
    try {
      await chrome.tabs.get(shopeeSearchTabId)
      return shopeeSearchTabId
    } catch (_error) {
      shopeeSearchTabId = null
    }
  }

  const tab = await chrome.tabs.create({
    url: "https://seller.shopee.co.id/portal/sale/order",
    active: false
  })

  if (!tab.id) {
    throw new Error("Gagal membuat tab pencarian Shopee.")
  }

  shopeeSearchTabId = tab.id
  await waitForTabComplete(tab.id)
  await sleep(250)

  return tab.id
}

const searchShopeeOrderId = async (orderSn: string, searchEndpoint: string) => {
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

  const safeJson = (raw: string) => {
    try {
      return JSON.parse(raw)
    } catch (_error) {
      return null
    }
  }

  const searchUrl = new URL(searchEndpoint)
  const cdsCookie = pickCookie("SPC_CDS")
  const cdsVerCookie = pickCookie("SPC_CDS_VER")

  if (!searchUrl.searchParams.get("SPC_CDS") && cdsCookie) {
    searchUrl.searchParams.set("SPC_CDS", cdsCookie)
  }
  if (!searchUrl.searchParams.get("SPC_CDS_VER")) {
    if (cdsVerCookie) {
      searchUrl.searchParams.set("SPC_CDS_VER", cdsVerCookie)
    } else {
      searchUrl.searchParams.set("SPC_CDS_VER", "2")
    }
  }

  searchUrl.searchParams.set("keyword", orderSn)

  const resp = await fetch(searchUrl.toString(), {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*"
    },
    credentials: "include"
  })

  const body = await resp.text()
  const json = safeJson(body)

  if (!resp.ok || json?.code !== 0) {
    return {
      ok: false,
      status: resp.status,
      body,
      orderId: ""
    }
  }

  const list = Array.isArray(json?.data?.list) ? json.data.list : []
  const exact = list.find(
    (item: Record<string, unknown>) => String(item?.order_sn || "") === orderSn
  )

  const orderId = exact?.order_id || list[0]?.order_id || ""

  return {
    ok: Boolean(orderId),
    status: resp.status,
    body,
    orderId: orderId ? String(orderId) : ""
  }
}

export const resolveShopeeOrderId = async (
  orderSn: string,
  searchEndpoint: string
): Promise<string> => {
  const tabId = await ensureShopeeSearchTab()

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: searchShopeeOrderId,
    args: [orderSn, searchEndpoint]
  })

  const payload = result?.result
  if (!payload?.ok || !payload.orderId) {
    throw new Error(`Shopee order_sn ${orderSn} tidak ditemukan.`)
  }

  return String(payload.orderId)
}
