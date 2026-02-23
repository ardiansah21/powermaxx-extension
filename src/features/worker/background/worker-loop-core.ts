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
  stopReason?: WorkerStopReason
  delayMs?: number | null
  actionHint?: string
}

export interface RetryableErrorSignal {
  type: "retryable_error"
  status: number
  message: string
  retryDelayMs?: number | null
  actionHint?: string
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
  onClaimEmpty?: (
    attempt: number,
    delayMs: number,
    signal: EmptySignal
  ) => Promise<void>
  onRetry?: (
    attempt: number,
    delayMs: number,
    signal: RetryableErrorSignal
  ) => Promise<void>
  shouldStop?: () => boolean | WorkerStopReason
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
    const stopSignal = options.shouldStop?.()
    if (stopSignal) {
      return {
        stopReason:
          stopSignal === true ? "user_stop" : (stopSignal as WorkerStopReason)
      }
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
        return { stopReason: signal.stopReason || "run_terminal" }
      }

      emptyAttempt += 1
      const controlDelayMs = Number(signal.delayMs)
      const delayMs =
        Number.isFinite(controlDelayMs) && controlDelayMs >= 0
          ? Math.trunc(controlDelayMs)
          : computeIdleBackoffMs(emptyAttempt)
      if (options.onClaimEmpty) {
        await options.onClaimEmpty(emptyAttempt, delayMs, signal)
      }
      await options.sleep(delayMs)
      continue
    }

    if (signal.type === "retryable_error") {
      retryAttempt += 1
      const computedDelayMs = computeRetryBackoffMs(retryAttempt, random)
      const controlDelayMs = Number(signal.retryDelayMs)
      const delayMs =
        Number.isFinite(controlDelayMs) && controlDelayMs > 0
          ? Math.max(Math.trunc(controlDelayMs), computedDelayMs)
          : computedDelayMs
      if (options.onRetry) {
        await options.onRetry(retryAttempt, delayMs, signal)
      }
      await options.sleep(delayMs)
      continue
    }

    return { stopReason: signal.stopReason }
  }
}
