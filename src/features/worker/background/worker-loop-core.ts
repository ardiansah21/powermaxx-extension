export type WorkerStopReason =
  | "run_terminal"
  | "user_stop"
  | "fatal_config"
  | "unrecoverable_auth"
  | "unrecoverable_error"

export interface ClaimedSignal<TClaim> {
  type: "claimed"
  claim: TClaim
}

export interface EmptySignal {
  type: "empty"
  terminal: boolean
}

export interface RetryableErrorSignal {
  type: "retryable_error"
  status: number
  message: string
}

export interface FatalErrorSignal {
  type: "fatal_error"
  stopReason: Exclude<WorkerStopReason, "run_terminal" | "user_stop">
  status: number
  message: string
}

export type ClaimLoopSignal<TClaim> =
  | ClaimedSignal<TClaim>
  | EmptySignal
  | RetryableErrorSignal
  | FatalErrorSignal

export interface DurableClaimLoopOptions<TClaim> {
  poll: () => Promise<ClaimLoopSignal<TClaim>>
  onClaimed: (claim: TClaim) => Promise<void>
  onClaimEmpty?: (attempt: number, delayMs: number) => Promise<void>
  onRetry?: (
    attempt: number,
    delayMs: number,
    signal: RetryableErrorSignal
  ) => Promise<void>
  shouldStop?: () => boolean
  sleep: (ms: number) => Promise<void>
  random?: () => number
}

export interface DurableClaimLoopResult {
  stopReason: WorkerStopReason
}

export interface ResumableRunState {
  active: boolean
  stop_reason: WorkerStopReason | null | string
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

export const selectResumableRunStates = <TRun extends ResumableRunState>(
  states: TRun[]
) =>
  states.filter(
    (state) => state.active === true && !String(state.stop_reason || "").trim()
  )

export const runDurableClaimLoop = async <TClaim>(
  options: DurableClaimLoopOptions<TClaim>
): Promise<DurableClaimLoopResult> => {
  let emptyAttempt = 0
  let retryAttempt = 0
  const random = options.random || Math.random

  while (true) {
    if (options.shouldStop?.()) {
      return { stopReason: "user_stop" }
    }

    const signal = await options.poll()

    if (signal.type === "claimed") {
      emptyAttempt = 0
      retryAttempt = 0
      await options.onClaimed(signal.claim)
      continue
    }

    if (signal.type === "empty") {
      retryAttempt = 0

      if (signal.terminal) {
        return { stopReason: "run_terminal" }
      }

      emptyAttempt += 1
      const delayMs = computeIdleBackoffMs(emptyAttempt)
      if (options.onClaimEmpty) {
        await options.onClaimEmpty(emptyAttempt, delayMs)
      }
      await options.sleep(delayMs)
      continue
    }

    if (signal.type === "retryable_error") {
      retryAttempt += 1
      const delayMs = computeRetryBackoffMs(retryAttempt, random)
      if (options.onRetry) {
        await options.onRetry(retryAttempt, delayMs, signal)
      }
      await options.sleep(delayMs)
      continue
    }

    return { stopReason: signal.stopReason }
  }
}
