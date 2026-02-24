export type AutomationErrorCode =
  | "TIMEOUT"
  | "EXTENSION_PERMISSION"
  | "NETWORK_OR_CORS"
  | "AUTH"
  | "ORDER_NOT_FOUND"
  | "INVALID_MARKETPLACE"
  | "INVALID_BASE_URL"
  | "EXTENSION_RUNTIME"
  | "PROCESSING_FAILED"
  | "UNKNOWN"

const KNOWN_ERROR_CODES = new Set<AutomationErrorCode>([
  "TIMEOUT",
  "EXTENSION_PERMISSION",
  "NETWORK_OR_CORS",
  "AUTH",
  "ORDER_NOT_FOUND",
  "INVALID_MARKETPLACE",
  "INVALID_BASE_URL",
  "EXTENSION_RUNTIME",
  "PROCESSING_FAILED",
  "UNKNOWN"
])

export const sanitizeErrorMessage = (
  value: unknown,
  fallback = "Gagal memproses order marketplace."
) => {
  const message = String(value || "").replace(/^Error:\s*/i, "").trim()
  return message || fallback
}

export const sanitizeTechnicalError = (value: unknown, max = 1200) => {
  const text = String(value || "")
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

export const classifyAutomationErrorCode = (message: unknown): AutomationErrorCode => {
  const raw = String(message || "").toLowerCase()
  if (!raw) return "UNKNOWN"
  if (raw.includes("timeout") || raw.includes("timed out")) return "TIMEOUT"
  if (raw.includes("cannot access contents of the page")) return "EXTENSION_PERMISSION"
  if (raw.includes("failed to fetch")) return "NETWORK_OR_CORS"
  if (raw.includes("unauthorized") || raw.includes("forbidden")) return "AUTH"
  if (raw.includes("order tidak ditemukan")) return "ORDER_NOT_FOUND"
  if (raw.includes("marketplace tidak valid") || raw.includes("marketplace wajib")) {
    return "INVALID_MARKETPLACE"
  }
  if (raw.includes("base url")) return "INVALID_BASE_URL"
  if (
    raw.includes("runner tidak tersedia") ||
    raw.includes("context invalidated") ||
    raw.includes("extension worker")
  ) {
    return "EXTENSION_RUNTIME"
  }
  if (
    raw.includes("gagal memproses") ||
    raw.includes("data marketplace") ||
    raw.includes("response content script kosong")
  ) {
    return "PROCESSING_FAILED"
  }

  return "UNKNOWN"
}

export const toAutomationErrorCode = (value: unknown): AutomationErrorCode => {
  const asCode = String(value || "").trim().toUpperCase()
  if (KNOWN_ERROR_CODES.has(asCode as AutomationErrorCode)) {
    return asCode as AutomationErrorCode
  }

  return classifyAutomationErrorCode(value)
}

export const buildAutomationActionHint = (errorCode: AutomationErrorCode) => {
  if (errorCode === "TIMEOUT") {
    return "Pastikan tab marketplace terbuka, akun login, lalu coba jalankan ulang batch."
  }
  if (errorCode === "EXTENSION_PERMISSION") {
    return "Berikan izin host extension untuk domain marketplace lalu ulangi."
  }
  if (errorCode === "NETWORK_OR_CORS" || errorCode === "INVALID_BASE_URL") {
    return "Periksa Base URL API, koneksi jaringan, dan kebijakan CORS server."
  }
  if (errorCode === "AUTH") {
    return "Login ulang di popup extension, lalu jalankan kembali batch."
  }
  if (errorCode === "ORDER_NOT_FOUND") {
    return "Periksa ID order dari backend batch job dan status order di marketplace."
  }
  if (errorCode === "INVALID_MARKETPLACE") {
    return "Periksa mapping marketplace dan id_type dari payload job."
  }
  if (errorCode === "EXTENSION_RUNTIME") {
    return "Reload extension, refresh tab marketplace, lalu ulangi proses."
  }
  return "Coba ulang batch. Jika tetap gagal, kirim log worker ke tim teknis."
}

export const toAutomationStatus = (errorCode: AutomationErrorCode) => {
  return errorCode === "TIMEOUT" ? "timed_out" : "failed"
}
