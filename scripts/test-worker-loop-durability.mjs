#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createContext, Script } from "node:vm"
import ts from "typescript"

const loadCoreModule = () => {
  const sourcePath = resolve(
    process.cwd(),
    "src/features/worker/background/worker-loop-core.ts"
  )
  const source = readFileSync(sourcePath, "utf8")

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS
    },
    fileName: "worker-loop-core.ts"
  }).outputText

  const module = { exports: {} }
  const context = createContext({
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    Math
  })

  new Script(transpiled, { filename: "worker-loop-core.js" }).runInContext(
    context
  )
  return module.exports
}

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

const run = async () => {
  const core = loadCoreModule()
  const {
    runDurableClaimLoop,
    computeIdleBackoffMs,
    computeRetryBackoffMs,
    selectResumableRunStates
  } = core

  const sleepCalls1 = []
  const processedClaims1 = []
  const events1 = [
    { type: "empty", terminal: false },
    { type: "empty", terminal: false },
    { type: "claimed", claim: { id: "order-1" } },
    { type: "empty", terminal: true }
  ]

  const result1 = await runDurableClaimLoop({
    sleep: async (ms) => {
      sleepCalls1.push(ms)
    },
    poll: async () => events1.shift(),
    onClaimed: async (claim) => {
      processedClaims1.push(claim.id)
    }
  })

  assert(
    result1.stopReason === "run_terminal",
    "scenario1: expected run_terminal stop"
  )
  assert(
    processedClaims1.length === 1 && processedClaims1[0] === "order-1",
    "scenario1: claim should be processed after empty polls"
  )
  assert(sleepCalls1.length >= 2, "scenario1: should backoff on empty claims")
  assert(
    sleepCalls1.every((ms) => ms >= 2000 && ms <= 5000),
    "scenario1: idle backoff must stay in 2-5s"
  )

  const sleepCalls2 = []
  const retryEvents2 = []
  const events2 = [
    { type: "retryable_error", status: 429, message: "rate limit 1" },
    { type: "retryable_error", status: 429, message: "rate limit 2" },
    { type: "claimed", claim: { id: "order-2" } },
    { type: "empty", terminal: true }
  ]

  const result2 = await runDurableClaimLoop({
    random: () => 0.5,
    sleep: async (ms) => {
      sleepCalls2.push(ms)
    },
    poll: async () => events2.shift(),
    onClaimed: async () => undefined,
    onRetry: async (attempt, delayMs, signal) => {
      retryEvents2.push({ attempt, delayMs, status: signal.status })
    }
  })

  assert(
    result2.stopReason === "run_terminal",
    "scenario2: expected terminal stop after recovery"
  )
  assert(retryEvents2.length === 2, "scenario2: expected two retry events")
  assert(sleepCalls2.length >= 2, "scenario2: expected retry sleeps")
  assert(
    sleepCalls2[0] >= 1000 && sleepCalls2[1] >= 2000,
    "scenario2: exponential backoff should increase"
  )

  const resumable = selectResumableRunStates([
    { run_id: "run-1", active: true, stop_reason: null },
    { run_id: "run-2", active: true, stop_reason: "run_terminal" },
    { run_id: "run-3", active: false, stop_reason: null }
  ])
  assert(
    resumable.length === 1 && resumable[0].run_id === "run-1",
    "scenario3: only active non-terminal run should be resumed"
  )

  const idleBackoffBounds = [1, 2, 3, 8].map((attempt) =>
    computeIdleBackoffMs(attempt)
  )
  assert(
    idleBackoffBounds.every((ms) => ms >= 2000 && ms <= 5000),
    "idle backoff bounds must stay within 2-5s"
  )

  const retryBackoff = [1, 2, 3].map((attempt) =>
    computeRetryBackoffMs(attempt, () => 0.5)
  )
  assert(
    retryBackoff[0] <= retryBackoff[1] && retryBackoff[1] <= retryBackoff[2],
    "retry backoff should be monotonic with deterministic jitter"
  )

  console.log("Worker durability simulation tests passed")
  console.log("- Scenario 1: empty claim then order processing")
  console.log("- Scenario 2: repeated 429 then recover")
  console.log("- Scenario 3: resumable state selection after restart")
}

run().catch((error) => {
  console.error("Worker durability simulation tests failed")
  console.error(String(error?.message || error))
  process.exitCode = 1
})
