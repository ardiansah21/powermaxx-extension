import {
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_KEY,
  SETTINGS_KEY,
  normalizeBaseUrl,
  normalizeDefaultMarketplace,
  type AuthSettings,
  type PowermaxxSettings
} from "~src/core/settings/schema"

const getStorageArea = () => chrome.storage?.local

const mergeSettings = (raw: unknown): PowermaxxSettings => {
  const record = (raw || {}) as Record<string, any>
  const marketplaces = record.marketplaces || {}
  const shopee = marketplaces.shopee || {}
  const shopeeAwb = shopee.awb || {}
  const legacyTikTok = marketplaces.tiktok || {}
  const tiktokShop = marketplaces.tiktok_shop || legacyTikTok
  const tiktokAwb = tiktokShop.awb || {}

  const merged: PowermaxxSettings = {
    ...DEFAULT_SETTINGS,
    ...record,
    defaultMarketplace: normalizeDefaultMarketplace(record.defaultMarketplace),
    components:
      String(record.components || DEFAULT_SETTINGS.components).trim() ||
      DEFAULT_SETTINGS.components,
    auth: {
      ...DEFAULT_SETTINGS.auth,
      ...(record.auth || {}),
      baseUrl:
        normalizeBaseUrl(record?.auth?.baseUrl) || DEFAULT_SETTINGS.auth.baseUrl,
      token: String(record?.auth?.token || "").trim(),
      email: String(record?.auth?.email || "").trim(),
      deviceName:
        String(record?.auth?.deviceName || "").trim() ||
        DEFAULT_SETTINGS.auth.deviceName,
      profile: record?.auth?.profile || null
    },
    marketplaces: {
      shopee: {
        ...DEFAULT_SETTINGS.marketplaces.shopee,
        ...shopee,
        baseUrl:
          normalizeBaseUrl(shopee?.baseUrl) ||
          normalizeBaseUrl(record?.auth?.baseUrl) ||
          DEFAULT_SETTINGS.marketplaces.shopee.baseUrl,
        searchEndpoint:
          String(shopee?.searchEndpoint || "").trim() ||
          DEFAULT_SETTINGS.marketplaces.shopee.searchEndpoint,
        incomeEndpoint:
          String(shopee?.incomeEndpoint || "").trim() ||
          DEFAULT_SETTINGS.marketplaces.shopee.incomeEndpoint,
        orderEndpoint:
          String(shopee?.orderEndpoint || "").trim() ||
          DEFAULT_SETTINGS.marketplaces.shopee.orderEndpoint,
        awb: {
          ...DEFAULT_SETTINGS.marketplaces.shopee.awb,
          ...shopeeAwb,
          packageEndpoint:
            String(
              shopeeAwb?.packageEndpoint || shopeeAwb?.getPackageEndpoint || ""
            ).trim() || DEFAULT_SETTINGS.marketplaces.shopee.awb.packageEndpoint,
          createJobEndpoint:
            String(
              shopeeAwb?.createJobEndpoint || shopeeAwb?.createSdJobEndpoint || ""
            ).trim() || DEFAULT_SETTINGS.marketplaces.shopee.awb.createJobEndpoint,
          downloadJobEndpoint:
            String(
              shopeeAwb?.downloadJobEndpoint ||
                shopeeAwb?.downloadSdJobEndpoint ||
                ""
            ).trim() || DEFAULT_SETTINGS.marketplaces.shopee.awb.downloadJobEndpoint,
          regionId:
            String(shopeeAwb?.regionId || "").trim() ||
            DEFAULT_SETTINGS.marketplaces.shopee.awb.regionId,
          asyncSdVersion:
            String(shopeeAwb?.asyncSdVersion || "").trim() ||
            DEFAULT_SETTINGS.marketplaces.shopee.awb.asyncSdVersion,
          fileType:
            String(shopeeAwb?.fileType || "").trim() ||
            DEFAULT_SETTINGS.marketplaces.shopee.awb.fileType,
          fileName:
            String(shopeeAwb?.fileName || "").trim() ||
            DEFAULT_SETTINGS.marketplaces.shopee.awb.fileName,
          fileContents:
            String(shopeeAwb?.fileContents || "").trim() ||
            DEFAULT_SETTINGS.marketplaces.shopee.awb.fileContents
        }
      },
      tiktok_shop: {
        ...DEFAULT_SETTINGS.marketplaces.tiktok_shop,
        ...tiktokShop,
        baseUrl:
          normalizeBaseUrl(tiktokShop?.baseUrl) ||
          normalizeBaseUrl(record?.auth?.baseUrl) ||
          DEFAULT_SETTINGS.marketplaces.tiktok_shop.baseUrl,
        orderEndpoint:
          String(tiktokShop?.orderEndpoint || "").trim() ||
          DEFAULT_SETTINGS.marketplaces.tiktok_shop.orderEndpoint,
        statementEndpoint:
          String(tiktokShop?.statementEndpoint || "").trim() ||
          DEFAULT_SETTINGS.marketplaces.tiktok_shop.statementEndpoint,
        statementDetailEndpoint:
          String(tiktokShop?.statementDetailEndpoint || "").trim() ||
          DEFAULT_SETTINGS.marketplaces.tiktok_shop.statementDetailEndpoint,
        awb: {
          ...DEFAULT_SETTINGS.marketplaces.tiktok_shop.awb,
          ...tiktokAwb,
          generateEndpoint:
            String(tiktokAwb?.generateEndpoint || "").trim() ||
            DEFAULT_SETTINGS.marketplaces.tiktok_shop.awb.generateEndpoint,
          filePrefix:
            String(tiktokAwb?.filePrefix || "").trim() ||
            DEFAULT_SETTINGS.marketplaces.tiktok_shop.awb.filePrefix
        }
      }
    }
  }

  return merged
}

export const loadSettings = async (): Promise<PowermaxxSettings> => {
  const storage = getStorageArea()
  if (!storage) return DEFAULT_SETTINGS

  return new Promise((resolve) => {
    storage.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY], (result) => {
      const raw = result?.[SETTINGS_KEY] || result?.[LEGACY_SETTINGS_KEY] || null
      resolve(mergeSettings(raw))
    })
  })
}

export const saveSettings = async (settings: PowermaxxSettings) => {
  const storage = getStorageArea()
  if (!storage) return

  return new Promise<void>((resolve) => {
    storage.set({ [SETTINGS_KEY]: settings }, () => resolve())
  })
}

export const updateAuthSession = async (patch: Partial<AuthSettings>) => {
  const current = await loadSettings()
  const next: PowermaxxSettings = {
    ...current,
    auth: {
      ...current.auth,
      ...patch,
      baseUrl: normalizeBaseUrl(
        patch.baseUrl !== undefined ? patch.baseUrl : current.auth.baseUrl
      ),
      token:
        patch.token !== undefined
          ? String(patch.token || "").trim()
          : current.auth.token,
      email:
        patch.email !== undefined
          ? String(patch.email || "").trim()
          : current.auth.email,
      deviceName:
        patch.deviceName !== undefined
          ? String(patch.deviceName || "").trim() || current.auth.deviceName
          : current.auth.deviceName
    }
  }

  await saveSettings(next)
  return next
}

export const clearAuthSession = async () => {
  const current = await loadSettings()
  const next: PowermaxxSettings = {
    ...current,
    auth: {
      ...current.auth,
      token: "",
      profile: null
    }
  }

  await saveSettings(next)
  return next
}
