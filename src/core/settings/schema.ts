import type { Marketplace } from "~src/core/messages/contracts"

export const SETTINGS_KEY = "powermaxxSettings"
export const LEGACY_SETTINGS_KEY = "arvaSettings"

export const DEFAULT_AUTH_BASE_URL = "https://powermaxx.test"
export const DEFAULT_DEVICE_NAME = "powermaxx-extension"
export const DEFAULT_COMPONENTS = "2,3,4,5"

export const DEFAULT_SHOPEE_SEARCH_ENDPOINT =
  "https://seller.shopee.co.id/api/v3/order/get_order_list_search_bar_hint"
export const DEFAULT_SHOPEE_INCOME_ENDPOINT =
  "https://seller.shopee.co.id/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components"
export const DEFAULT_SHOPEE_ORDER_ENDPOINT =
  "https://seller.shopee.co.id/api/v3/order/get_one_order"

export const DEFAULT_TIKTOK_ORDER_ENDPOINT =
  "https://seller-id.tokopedia.com/api/fulfillment/order/get"
export const DEFAULT_TIKTOK_STATEMENT_ENDPOINT =
  "https://seller-id.tokopedia.com/api/v1/pay/statement/order/list"
export const DEFAULT_TIKTOK_STATEMENT_DETAIL_ENDPOINT =
  "https://seller-id.tokopedia.com/api/v1/pay/statement/transaction/detail"
export const DEFAULT_TIKTOK_AWB_GENERATE_ENDPOINT =
  "https://seller-id.tokopedia.com/api/v1/fulfillment/shipping_doc/generate"
export const DEFAULT_TIKTOK_AWB_FILE_PREFIX = "Shipping label"

export const DEFAULT_SHOPEE_AWB_PACKAGE_ENDPOINT =
  "https://seller.shopee.co.id/api/v3/order/get_package"
export const DEFAULT_SHOPEE_AWB_CREATE_JOB_ENDPOINT =
  "https://seller.shopee.co.id/api/v3/logistics/create_sd_jobs"
export const DEFAULT_SHOPEE_AWB_DOWNLOAD_JOB_ENDPOINT =
  "https://seller.shopee.co.id/api/v3/logistics/download_sd_job"
export const DEFAULT_SHOPEE_AWB_REGION_ID = "ID"
export const DEFAULT_SHOPEE_AWB_ASYNC_VERSION = "0.2"
export const DEFAULT_SHOPEE_AWB_FILE_TYPE = "THERMAL_PDF"
export const DEFAULT_SHOPEE_AWB_FILE_NAME = "Label Pengiriman"
export const DEFAULT_SHOPEE_AWB_FILE_CONTENTS = "3"

export const DEFAULT_TEMPLATES = {
  shopee: "https://seller.shopee.co.id/portal/sale/order/{order_id}",
  tiktok_shop:
    "https://seller-id.tokopedia.com/order/detail?order_no={order_sn}&shop_region=ID"
} as const

export interface AuthSettings {
  baseUrl: string
  token: string
  email: string
  deviceName: string
  profile: Record<string, unknown> | null
}

export interface ShopeeAwbSettings {
  packageEndpoint: string
  createJobEndpoint: string
  downloadJobEndpoint: string
  regionId: string
  asyncSdVersion: string
  fileType: string
  fileName: string
  fileContents: string
}

export interface TikTokAwbSettings {
  generateEndpoint: string
  filePrefix: string
}

export interface ShopeeSettings {
  baseUrl: string
  searchEndpoint: string
  incomeEndpoint: string
  orderEndpoint: string
  awb: ShopeeAwbSettings
}

export interface TikTokSettings {
  baseUrl: string
  orderEndpoint: string
  statementEndpoint: string
  statementDetailEndpoint: string
  awb: TikTokAwbSettings
}

export interface WorkerSettings {
  persistentWorkerTabEnabled: boolean
}

export interface PowermaxxSettings {
  defaultMarketplace: Exclude<Marketplace, "auto">
  components: string
  auth: AuthSettings
  worker: WorkerSettings
  marketplaces: {
    shopee: ShopeeSettings
    tiktok_shop: TikTokSettings
  }
}

export const DEFAULT_SETTINGS: PowermaxxSettings = {
  defaultMarketplace: "shopee",
  components: DEFAULT_COMPONENTS,
  auth: {
    baseUrl: DEFAULT_AUTH_BASE_URL,
    token: "",
    email: "",
    deviceName: DEFAULT_DEVICE_NAME,
    profile: null
  },
  worker: {
    persistentWorkerTabEnabled: false
  },
  marketplaces: {
    shopee: {
      baseUrl: DEFAULT_AUTH_BASE_URL,
      searchEndpoint: DEFAULT_SHOPEE_SEARCH_ENDPOINT,
      incomeEndpoint: DEFAULT_SHOPEE_INCOME_ENDPOINT,
      orderEndpoint: DEFAULT_SHOPEE_ORDER_ENDPOINT,
      awb: {
        packageEndpoint: DEFAULT_SHOPEE_AWB_PACKAGE_ENDPOINT,
        createJobEndpoint: DEFAULT_SHOPEE_AWB_CREATE_JOB_ENDPOINT,
        downloadJobEndpoint: DEFAULT_SHOPEE_AWB_DOWNLOAD_JOB_ENDPOINT,
        regionId: DEFAULT_SHOPEE_AWB_REGION_ID,
        asyncSdVersion: DEFAULT_SHOPEE_AWB_ASYNC_VERSION,
        fileType: DEFAULT_SHOPEE_AWB_FILE_TYPE,
        fileName: DEFAULT_SHOPEE_AWB_FILE_NAME,
        fileContents: DEFAULT_SHOPEE_AWB_FILE_CONTENTS
      }
    },
    tiktok_shop: {
      baseUrl: DEFAULT_AUTH_BASE_URL,
      orderEndpoint: DEFAULT_TIKTOK_ORDER_ENDPOINT,
      statementEndpoint: DEFAULT_TIKTOK_STATEMENT_ENDPOINT,
      statementDetailEndpoint: DEFAULT_TIKTOK_STATEMENT_DETAIL_ENDPOINT,
      awb: {
        generateEndpoint: DEFAULT_TIKTOK_AWB_GENERATE_ENDPOINT,
        filePrefix: DEFAULT_TIKTOK_AWB_FILE_PREFIX
      }
    }
  }
}

export const normalizeBaseUrl = (value: unknown) =>
  String(value ?? "").trim().replace(/\/+$/, "")

export const normalizeDefaultMarketplace = (value: unknown): "shopee" | "tiktok_shop" => {
  const raw = String(value ?? "").trim().toLowerCase()
  if (raw === "tiktok" || raw === "tiktok shop" || raw === "tiktok_shop") {
    return "tiktok_shop"
  }
  return "shopee"
}

export const buildOriginPattern = (baseUrl: string) => {
  try {
    const normalized = normalizeBaseUrl(baseUrl)
    if (!normalized) return ""
    const url = new URL(normalized)
    return `${url.origin}/*`
  } catch (_error) {
    return ""
  }
}
