export interface ResumableBatchState {
  active: boolean
  stop_reason: string | null
}

export const isRetryablePollStatus = (status: number) =>
  status === 0 ||
  status === 408 ||
  status === 425 ||
  status === 429 ||
  status >= 500

export const computeIdleBackoffMs = (
  attempt: number,
  config: { minMs?: number; maxMs?: number } = {}
) => {
  const minMs = Number.isFinite(config.minMs)
    ? Math.max(0, Number(config.minMs))
    : 2000
  const maxMs = Number.isFinite(config.maxMs)
    ? Math.max(minMs, Number(config.maxMs))
    : 5000

  if (attempt <= 1) {
    return minMs
  }

  const spread = Math.min(attempt - 1, 6) * 450
  return Math.min(maxMs, minMs + spread)
}

export const computeRetryBackoffMs = (
  attempt: number,
  random: () => number,
  config: { baseMs?: number; maxMs?: number; jitterRatio?: number } = {}
) => {
  const baseMs = Number.isFinite(config.baseMs)
    ? Math.max(50, Number(config.baseMs))
    : 1000
  const maxMs = Number.isFinite(config.maxMs)
    ? Math.max(baseMs, Number(config.maxMs))
    : 30000
  const jitterRatio = Number.isFinite(config.jitterRatio)
    ? Math.max(0, Math.min(0.5, Number(config.jitterRatio)))
    : 0.2

  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1))
  const jitterWindow = Math.max(1, Math.floor(exponential * jitterRatio))
  const normalizedRandom = Number.isFinite(random())
    ? Math.max(0, Math.min(1, random()))
    : 0.5
  const jitter = Math.floor((normalizedRandom - 0.5) * 2 * jitterWindow)

  return Math.max(baseMs, Math.min(maxMs, exponential + jitter))
}

export const selectResumableBatchStates = <
  TBatch extends ResumableBatchState
>(
  states: TBatch[]
) =>
  states.filter(
    (state) => state.active === true && !String(state.stop_reason || "").trim()
  )
