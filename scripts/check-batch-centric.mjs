#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const filePath = resolve(process.cwd(), "src/background.ts")
const text = readFileSync(filePath, "utf8")

const requiredTokens = [
  "POWERMAXX_BATCH_WORKER",
  "POWERMAXX_STOP_BATCH_WORKER",
  "startBatchWorker",
  "stopBatchWorker",
  "batch_id wajib diisi untuk stop worker."
]

for (const token of requiredTokens) {
  if (!text.includes(token)) {
    console.error(`FAIL: missing token ${token}`)
    process.exit(1)
  }
}

console.log("PASS: worker mode is strict batch-centric")
