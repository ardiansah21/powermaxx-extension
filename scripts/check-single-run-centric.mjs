#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const filePath = resolve(process.cwd(), "src/background.ts")
const text = readFileSync(filePath, "utf8")

const sectionMatch = text.match(
  /const handleSingle = async \([\s\S]*?\n\}\n\nconst handleRunWorker = async/
)

if (!sectionMatch) {
  console.error("FAIL: handleSingle section not found")
  process.exit(1)
}

const section = sectionMatch[0]
const requiredError = "run_id wajib diisi untuk single mode (run-centric)."

const hasRequiredError = section.includes(requiredError)
const hasFallbackBulk = section.includes("runBulkHeadless(")

if (!hasRequiredError) {
  console.error("FAIL: single mode missing strict run_id validation error")
  process.exit(1)
}

if (hasFallbackBulk) {
  console.error("FAIL: single mode still falls back to bulk")
  process.exit(1)
}

console.log("PASS: single mode is strict run-centric (no bulk fallback)")
