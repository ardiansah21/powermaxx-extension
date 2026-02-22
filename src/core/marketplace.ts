import type { Marketplace } from "~src/core/messages/contracts"

export const MARKETPLACE_TAB_URL_PATTERNS = [
  "https://seller.shopee.co.id/*",
  "https://*.shopee.co.id/*",
  "https://seller-id.tokopedia.com/*"
]

export const isMarketplaceUrl = (url: string) => {
  const clean = String(url || "")
  if (!clean) return false

  if (clean.startsWith("chrome-extension://")) return false
  if (clean.startsWith("chrome://")) return false
  if (clean.startsWith("edge://")) return false

  return (
    clean.startsWith("https://seller.shopee.co.id/") ||
    clean.includes(".shopee.co.id/") ||
    clean.startsWith("https://seller-id.tokopedia.com/")
  )
}

export const detectMarketplaceFromUrl = (url: string): Exclude<Marketplace, "auto"> | "" => {
  const clean = String(url || "")
  if (
    clean.startsWith("https://seller.shopee.co.id/") ||
    clean.includes(".shopee.co.id/")
  ) {
    return "shopee"
  }

  if (clean.startsWith("https://seller-id.tokopedia.com/")) {
    return "tiktok_shop"
  }

  return ""
}

export const getMarketplaceLabel = (value: Marketplace | string) => {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "shopee") return "Shopee"
  if (normalized === "tiktok_shop" || normalized === "tiktok" || normalized === "tiktok shop") {
    return "TikTok Shop"
  }
  if (normalized === "auto") return "Auto"
  return String(value || "").toUpperCase()
}

export const buildOrderUrl = (marketplace: Exclude<Marketplace, "auto">, id: string) => {
  if (marketplace === "shopee") {
    return `https://seller.shopee.co.id/portal/sale/order/${encodeURIComponent(id)}`
  }

  return `https://seller-id.tokopedia.com/order/detail?order_no=${encodeURIComponent(
    id
  )}&shop_region=ID`
}
