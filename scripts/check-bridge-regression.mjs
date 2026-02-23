#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const rootDir = process.cwd()

const checks = [
  {
    file: "src/features/worker/background/run-worker.ts",
    required: [
      "run_started",
      "run_order_started",
      "run_order_heartbeat",
      "run_order_finished",
      "run_finished",
      "run_failed",
      "worker.loop.start",
      "worker.claim.empty",
      "worker.poll.retry",
      "worker.loop.stop",
      "idempotency_key",
      "attempt_no",
      "error_code",
      "action_hint",
      "technical_error"
    ]
  },
  {
    file: "src/features/bulk/background/run-bulk.ts",
    required: [
      "run_started",
      "run_order_started",
      "run_order_finished",
      "run_finished",
      "run_failed",
      "error_code",
      "action_hint",
      "technical_error",
      "duration_ms"
    ]
  },
  {
    file: "src/features/bridge/background/bridge-injector.ts",
    required: [
      "__pmx_bridge_owner",
      "__pmx_request_id",
      "POWERMAXX_RUN_WORKER",
      "POWERMAXX_SINGLE",
      "POWERMAXX_BULK"
    ]
  },
  {
    file: "src/core/errors/automation-error.ts",
    required: [
      "classifyAutomationErrorCode",
      "buildAutomationActionHint",
      "toAutomationStatus"
    ]
  }
]

const readText = (path) => {
  const full = resolve(rootDir, path)
  if (!existsSync(full)) {
    return {
      ok: false,
      path,
      text: "",
      error: "File not found"
    }
  }

  return {
    ok: true,
    path,
    text: readFileSync(full, "utf8"),
    error: ""
  }
}

const results = checks.map((check) => {
  const file = readText(check.file)
  if (!file.ok) {
    return {
      file: check.file,
      ok: false,
      missing: check.required,
      error: file.error
    }
  }

  const missing = check.required.filter((token) => !file.text.includes(token))

  return {
    file: check.file,
    ok: missing.length === 0,
    missing,
    error: ""
  }
})

const failed = results.filter((result) => !result.ok)

console.log("Powermaxx bridge regression guard")
console.log("================================")

for (const result of results) {
  if (result.ok) {
    console.log(`PASS ${result.file}`)
    continue
  }

  console.log(`FAIL ${result.file}`)
  if (result.error) {
    console.log(`  - ${result.error}`)
  }
  for (const token of result.missing) {
    console.log(`  - missing: ${token}`)
  }
}

if (failed.length > 0) {
  console.log("")
  console.log("Regression guard failed. Review missing tokens above.")
  process.exitCode = 1
} else {
  console.log("")
  console.log("All regression guards passed.")
}
