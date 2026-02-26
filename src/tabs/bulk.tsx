import { useEffect, useMemo, useState } from "react"

import type { RuntimeActionResponse } from "~src/core/messages/contracts"
import { sendRuntimeMessage } from "~src/core/messaging/runtime-client"

type StatusTone = "neutral" | "success" | "warning" | "error"

type BulkOrderInput = {
  id: string
  marketplace: "auto" | "shopee" | "tiktok_shop"
  idType: "order_sn" | "order_id"
}

type WorkerEventMessage = {
  type: "POWERMAXX_INTERNAL_WORKER_EVENT"
  event: string
  payload?: Record<string, unknown>
}

type WorkerStats = {
  claimed: number
  processed: number
  success: number
  failed: number
  timed_out: number
  report_failed: number
}

const pageStyle: React.CSSProperties = {
  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  maxWidth: 980,
  margin: "20px auto",
  padding: "0 18px 28px",
  color: "#0f172a",
  background: "#f8fafc"
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #dbe4ee",
  borderRadius: 12,
  padding: 16,
  background: "#ffffff",
  marginBottom: 12
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 28
}

const subtitleStyle: React.CSSProperties = {
  margin: "6px 0 0",
  color: "#64748b",
  fontSize: 14
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#334155",
  marginBottom: 5
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 9,
  padding: "10px 10px",
  background: "#ffffff",
  color: "#0f172a"
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 180,
  resize: "vertical"
}

const statusToneStyle: Record<StatusTone, React.CSSProperties> = {
  neutral: { border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155" },
  success: { border: "1px solid #86efac", background: "#f0fdf4", color: "#166534" },
  warning: { border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e" },
  error: { border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b" }
}

const statusStyle = (tone: StatusTone): React.CSSProperties => ({
  borderRadius: 10,
  padding: "10px 12px",
  marginBottom: 12,
  fontSize: 13,
  ...statusToneStyle[tone]
})

const grid3Style: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10
}

const actionsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 12
}

const buttonStyle = (
  variant: "primary" | "neutral" | "danger",
  disabled = false
): React.CSSProperties => {
  const palette =
    variant === "primary"
      ? { border: "#2563eb", background: "#2563eb", color: "#ffffff" }
      : variant === "danger"
        ? { border: "#ef4444", background: "#ef4444", color: "#ffffff" }
        : { border: "#94a3b8", background: "#f8fafc", color: "#0f172a" }

  return {
    border: `1px solid ${palette.border}`,
    borderRadius: 9,
    background: palette.background,
    color: palette.color,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1
  }
}

const summaryGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 8
}

const summaryCardStyle: React.CSSProperties = {
  border: "1px solid #dbe4ee",
  borderRadius: 9,
  background: "#f8fafc",
  padding: "8px 10px"
}

const summaryLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#64748b",
  marginBottom: 2
}

const summaryValueStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700
}

const logsStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  maxHeight: 240,
  overflow: "auto",
  fontSize: 12,
  lineHeight: 1.35
}

const parseMarketplace = (value: string): BulkOrderInput["marketplace"] => {
  const raw = String(value || "").trim().toLowerCase()
  if (raw === "shopee") return "shopee"
  if (raw === "tiktok_shop" || raw === "tiktok" || raw === "tiktok shop") {
    return "tiktok_shop"
  }
  return "auto"
}

const parseIdType = (value: string): BulkOrderInput["idType"] => {
  const raw = String(value || "").trim().toLowerCase()
  if (raw === "order_id" || raw === "mp_order_id") return "order_id"
  return "order_sn"
}

const normalizeOrdersInput = (args: {
  raw: string
  fallbackMarketplace: BulkOrderInput["marketplace"]
  fallbackIdType: BulkOrderInput["idType"]
}) => {
  const rows = String(args.raw || "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)

  return rows
    .map((row) => {
      const split = row
        .split(/[|,\t]/)
        .map((part) => part.trim())
        .filter(Boolean)

      if (!split.length) return null

      const id = split[0]
      if (!id) return null

      if (split.length === 1) {
        return {
          id,
          marketplace: args.fallbackMarketplace,
          idType: args.fallbackIdType
        }
      }

      if (split.length === 2) {
        const maybeMarketplace = parseMarketplace(split[1])
        if (maybeMarketplace !== "auto") {
          return {
            id,
            marketplace: maybeMarketplace,
            idType: args.fallbackIdType
          }
        }

        return {
          id,
          marketplace: args.fallbackMarketplace,
          idType: parseIdType(split[1])
        }
      }

      return {
        id,
        marketplace: parseMarketplace(split[1]),
        idType: parseIdType(split[2])
      }
    })
    .filter(Boolean) as BulkOrderInput[]
}

const formatNow = () =>
  new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })

const emptyWorkerStats = (): WorkerStats => ({
  claimed: 0,
  processed: 0,
  success: 0,
  failed: 0,
  timed_out: 0,
  report_failed: 0
})

function BulkTabPage() {
  const [rawInput, setRawInput] = useState("")
  const [marketplace, setMarketplace] = useState<BulkOrderInput["marketplace"]>("auto")
  const [idType, setIdType] = useState<BulkOrderInput["idType"]>("order_sn")
  const [status, setStatus] = useState("Siap menjalankan bulk.")
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral")
  const [busy, setBusy] = useState(false)
  const [batchIdInput, setBatchIdInput] = useState("")
  const [batchId, setBatchId] = useState("")
  const [workerId, setWorkerId] = useState("")
  const [stats, setStats] = useState<WorkerStats | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [totalOrders, setTotalOrders] = useState(0)

  const parsedPreview = useMemo(
    () =>
      normalizeOrdersInput({
        raw: rawInput,
        fallbackMarketplace: marketplace,
        fallbackIdType: idType
      }),
    [rawInput, marketplace, idType]
  )

  const appendLog = (line: string) => {
    setLogs((current) => [`[${formatNow()}] ${line}`, ...current].slice(0, 120))
  }

  useEffect(() => {
    const onRuntimeMessage = (message: WorkerEventMessage) => {
      if (
        !message ||
        typeof message !== "object" ||
        message.type !== "POWERMAXX_INTERNAL_WORKER_EVENT"
      ) {
        return
      }

      const payload = message.payload || {}
      const eventBatchId = String(payload.batch_id || payload.batchId || "")
      if (batchId && eventBatchId && eventBatchId !== batchId) {
        return
      }

      if (message.event === "batch.started") {
        const nextBatchId = String(payload.batch_id || payload.batchId || "")
        const nextWorkerId = String(payload.worker_id || "")
        if (nextBatchId) setBatchId(nextBatchId)
        if (nextWorkerId) setWorkerId(nextWorkerId)
        setBusy(true)
        setStatus("Batch sedang berjalan...")
        setStatusTone("neutral")
        appendLog(`Batch started (${nextBatchId || "-"})`)
        return
      }

      if (message.event === "batch.job.start") {
        const identifier = String(payload.identifier || "-")
        const market = String(payload.marketplace || "-")
        const jobId = String(payload.job_id || payload.jobId || "-")
        setStats((current) => {
          const next = current || emptyWorkerStats()
          return {
            ...next,
            claimed: next.claimed + 1
          }
        })
        appendLog(`Start job ${jobId} | ${identifier} (${market})`)
        return
      }

      if (message.event === "batch.job.finish") {
        const statusText = String(payload.status || "")
        const jobId = String(payload.job_id || payload.jobId || "")
        const error = String(payload.error_message || "")
        const success =
          payload.success === true || String(payload.status || "") === "success"

        setStats((current) => {
          const next = current || emptyWorkerStats()
          return {
            ...next,
            processed: next.processed + 1,
            success: success ? next.success + 1 : next.success,
            failed: success ? next.failed : next.failed + 1
          }
        })

        appendLog(
          `Finish job ${jobId || "-"} -> ${statusText || "-"}${
            error ? ` (${error})` : ""
          }`
        )
        return
      }

      if (message.event === "batch.finished") {
        const stopReason = String(payload.stop_reason || "")
        const lastError = String(payload.last_error || "")
        setBusy(false)

        if (stopReason === "batch_terminal") {
          setStatus("Batch selesai.")
          setStatusTone("success")
          appendLog("Batch finished")
        } else {
          setStatus(`Batch berhenti: ${lastError || stopReason || "unknown"}`)
          setStatusTone("warning")
          appendLog(`Batch stopped (${lastError || stopReason || "unknown"})`)
        }
      }
    }

    chrome.runtime.onMessage.addListener(onRuntimeMessage)
    return () => chrome.runtime.onMessage.removeListener(onRuntimeMessage)
  }, [batchId])

  const startBulk = async () => {
    const orders = normalizeOrdersInput({
      raw: rawInput,
      fallbackMarketplace: marketplace,
      fallbackIdType: idType
    })

    if (!orders.length) {
      setStatus("Daftar order kosong.")
      setStatusTone("warning")
      return
    }

    const normalizedBatchId = String(batchIdInput || "").trim()
    if (!normalizedBatchId) {
      setStatus("Batch ID wajib diisi.")
      setStatusTone("warning")
      return
    }

    try {
      setBusy(true)
      setStats(emptyWorkerStats())
      setLogs([])
      setTotalOrders(orders.length)
      setStatus("Memulai batch worker...")
      setStatusTone("neutral")

      const response = await sendRuntimeMessage<RuntimeActionResponse>({
        type: "POWERMAXX_BATCH_WORKER",
        mode: "bulk",
        action: "update_both",
        batchId: normalizedBatchId,
        batch_id: normalizedBatchId,
        orders
      })

      if (!response?.ok) {
        setBusy(false)
        setStatus(response?.error || "Batch gagal dijalankan.")
        setStatusTone("error")
        appendLog(`Start failed (${response?.error || "error"})`)
        return
      }

      setBatchId(String(response.batchId || normalizedBatchId))
      setWorkerId(String(response.workerId || ""))
      setStatus("Batch berjalan di background.")
      setStatusTone("success")
      appendLog(`Batch started (${response.batchId || normalizedBatchId})`)
    } catch (error) {
      setBusy(false)
      setStatus(`Gagal memulai batch: ${String((error as Error)?.message || error)}`)
      setStatusTone("error")
    }
  }

  const clearAll = () => {
    if (busy) return
    setRawInput("")
    setLogs([])
    setStats(null)
    setBatchIdInput("")
    setBatchId("")
    setWorkerId("")
    setTotalOrders(0)
    setStatus("Siap menjalankan batch.")
    setStatusTone("neutral")
  }

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: 12 }}>
        <h1 style={titleStyle}>Powermaxx Bulk Operator</h1>
        <p style={subtitleStyle}>
          Jalankan worker batch dengan kontrak request/result ke Laravel.
        </p>
      </header>

      <div style={statusStyle(statusTone)}>{status}</div>

      <section style={cardStyle}>
        <div style={grid3Style}>
          <div>
            <label style={labelStyle} htmlFor="bulk-batch-id">
              Batch ID
            </label>
            <input
              id="bulk-batch-id"
              style={inputStyle}
              value={batchIdInput}
              disabled={busy}
              onChange={(event) => setBatchIdInput(event.target.value)}
              placeholder="contoh: 123"
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="bulk-marketplace">
              Marketplace
            </label>
            <select
              id="bulk-marketplace"
              style={inputStyle}
              value={marketplace}
              disabled={busy}
              onChange={(event) =>
                setMarketplace(parseMarketplace(event.target.value))
              }>
              <option value="auto">Auto</option>
              <option value="shopee">Shopee</option>
              <option value="tiktok_shop">TikTok Shop</option>
            </select>
          </div>

          <div>
            <label style={labelStyle} htmlFor="bulk-idtype">
              ID Type
            </label>
            <select
              id="bulk-idtype"
              style={inputStyle}
              value={idType}
              disabled={busy}
              onChange={(event) => setIdType(parseIdType(event.target.value))}>
              <option value="order_sn">order_sn</option>
              <option value="order_id">order_id</option>
            </select>
          </div>

        </div>

        <div style={{ marginTop: 12 }}>
          <label style={labelStyle} htmlFor="bulk-orders">
            Daftar Order (1 per baris). Format opsional: `id|marketplace|id_type`
          </label>
          <textarea
            id="bulk-orders"
            style={textareaStyle}
            value={rawInput}
            disabled={busy}
            onChange={(event) => setRawInput(event.target.value)}
            placeholder={"1234567890\n7100112233|tiktok_shop|order_sn"}
          />
        </div>

        <div style={actionsStyle}>
          <button
            type="button"
            style={buttonStyle("primary", busy)}
            disabled={busy}
            onClick={startBulk}>
            {busy ? "Sedang berjalan..." : "Jalankan Batch"}
          </button>
          <button
            type="button"
            style={buttonStyle("neutral", busy)}
            disabled={busy}
            onClick={clearAll}>
            Clear
          </button>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Ringkasan Batch</h2>
        <div style={summaryGridStyle}>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Batch ID</div>
            <div style={summaryValueStyle}>{batchId || "-"}</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Worker ID</div>
            <div style={summaryValueStyle}>{workerId || "-"}</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Order Input</div>
            <div style={summaryValueStyle}>{totalOrders || parsedPreview.length}</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Processed</div>
            <div style={summaryValueStyle}>{stats?.processed ?? 0}</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Success</div>
            <div style={summaryValueStyle}>{stats?.success ?? 0}</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Failed</div>
            <div style={summaryValueStyle}>{stats?.failed ?? 0}</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Timed Out</div>
            <div style={summaryValueStyle}>{stats?.timed_out ?? 0}</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Report Failed</div>
            <div style={summaryValueStyle}>{stats?.report_failed ?? 0}</div>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Event Log</h2>
        {logs.length ? (
          <ul style={logsStyle}>
            {logs.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
            Belum ada event.
          </p>
        )}
      </section>
    </main>
  )
}

export default BulkTabPage
