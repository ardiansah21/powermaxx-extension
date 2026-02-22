export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogContext {
  feature: string
  domain: string
  step: string
  [key: string]: unknown
}

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: "[PMX:DEBUG]",
  info: "[PMX:INFO]",
  warn: "[PMX:WARN]",
  error: "[PMX:ERROR]"
}

const SENSITIVE_KEYS = new Set([
  "token",
  "password",
  "authorization",
  "access_token",
  "refresh_token"
])

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value
  if (depth > 5) return "[TRUNCATED]"

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1))
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const next: Record<string, unknown> = {}

    for (const [key, item] of Object.entries(record)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        next[key] = "[REDACTED]"
      } else {
        next[key] = sanitizeValue(item, depth + 1)
      }
    }

    return next
  }

  return value
}

export const log = (level: LogLevel, message: string, context: LogContext) => {
  const payload = {
    ts: new Date().toISOString(),
    message,
    ...(sanitizeValue(context) as LogContext)
  }

  if (level === "debug") {
    console.debug(LEVEL_PREFIX[level], payload)
    return
  }

  if (level === "info") {
    console.info(LEVEL_PREFIX[level], payload)
    return
  }

  if (level === "warn") {
    console.warn(LEVEL_PREFIX[level], payload)
    return
  }

  console.error(LEVEL_PREFIX[level], payload)
}

export const logger = {
  debug: (message: string, context: LogContext) => log("debug", message, context),
  info: (message: string, context: LogContext) => log("info", message, context),
  warn: (message: string, context: LogContext) => log("warn", message, context),
  error: (message: string, context: LogContext) => log("error", message, context)
}
