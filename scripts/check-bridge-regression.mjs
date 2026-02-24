#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const rootDir = process.cwd()

const checks = [
  {
    file: "src/features/worker/background/batch-worker.ts",
    required: [
      "batch.started",
      "batch.job.start",
      "batch.job.finish",
      "batch.finished",
      "worker.loop.start",
      "worker.claim.empty",
      "worker.poll.retry",
      "worker.loop.stop",
      "batch_terminal",
      "POWERMAXX_BATCH_WORKER",
      "request",
      "result"
    ]
  },
  {
    file: "src/background.ts",
    required: [
      "POWERMAXX_BATCH_WORKER",
      "POWERMAXX_STOP_BATCH_WORKER",
      "startBatchWorker",
      "stopBatchWorker"
    ]
  },
  {
    file: "src/features/bridge/background/bridge-injector.ts",
    required: [
      "bridge_probe",
      "bridge_probe_ack",
      "POWERMAXX_BATCH_WORKER",
      "batch_id",
      "request",
      "result"
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
