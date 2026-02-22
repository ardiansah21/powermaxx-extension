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
  const legacyTikTok = marketplaces.tiktok || {}
  const tiktokShop = marketplaces.tiktok_shop || legacyTikTok

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
        ...(marketplaces.shopee || {}),
        baseUrl:
          normalizeBaseUrl(marketplaces?.shopee?.baseUrl) ||
          normalizeBaseUrl(record?.auth?.baseUrl) ||
          DEFAULT_SETTINGS.marketplaces.shopee.baseUrl,
        searchEndpoint:
          String(marketplaces?.shopee?.searchEndpoint || "").trim() ||
          DEFAULT_SETTINGS.marketplaces.shopee.searchEndpoint,
        incomeEndpoint:
          String(marketplaces?.shopee?.incomeEndpoint || "").trim() ||
          DEFAULT_SETTINGS.marketplaces.shopee.incomeEndpoint,
        orderEndpoint:
          String(marketplaces?.shopee?.orderEndpoint || "").trim() ||
          DEFAULT_SETTINGS.marketplaces.shopee.orderEndpoint
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
          DEFAULT_SETTINGS.marketplaces.tiktok_shop.statementDetailEndpoint
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
