import { useEffect, useMemo, useState } from "react"

import { sendRuntimeMessage } from "~src/core/messaging/runtime-client"
import {
  clearViewerPayload,
  loadViewerPayload,
  type ViewerPayload
} from "~src/features/viewer/shared/storage"

type StatusTone = "neutral" | "success" | "warning" | "error"
type RuntimeResult = {
  ok: boolean
  error?: string
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
    padding: "9px 12px",
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1
  }
}

const summaryGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
  fontSize: 14,
  fontWeight: 700,
  overflowWrap: "anywhere"
}

const codeStyle: React.CSSProperties = {
  border: "1px solid #dbe4ee",
  borderRadius: 10,
  background: "#0b1220",
  color: "#e2e8f0",
  padding: "12px 12px",
  margin: 0,
  overflow: "auto",
  maxHeight: 360,
  fontSize: 12,
  lineHeight: 1.4
}

const actionsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 8
}

const toPrettyJson = (value: unknown) => {
  if (!value) return ""

  try {
    return JSON.stringify(value, null, 2)
  } catch (_error) {
    return String(value)
  }
}

const getMarketplaceLabel = (value: string) => {
  if (value === "shopee") return "Shopee"
  if (value === "tiktok_shop") return "TikTok Shop"
  return "-"
}

function ViewerTabPage() {
  const [payload, setPayload] = useState<ViewerPayload | null>(null)
  const [status, setStatus] = useState("Memuat data viewer...")
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral")
  const [busy, setBusy] = useState(false)

  const refresh = async (autoFetchIfEmpty = true) => {
    setBusy(true)
    try {
      const loaded = await loadViewerPayload()
      setPayload(loaded)

      if (loaded) {
        setStatus("Data viewer siap.")
        setStatusTone("success")
        return
      }

      if (!autoFetchIfEmpty) {
        setStatus("Belum ada data viewer.")
        setStatusTone("warning")
        return
      }

      setStatus("Belum ada data. Mengambil data dari tab marketplace aktif...")
      setStatusTone("neutral")

      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_FETCH_ONLY",
        actionMode: "fetch_send"
      })

      if (!response?.ok) {
        setStatus(
          `Belum ada data viewer dan auto-fetch gagal: ${response?.error || "Unknown error"}`
        )
        setStatusTone("warning")
        return
      }

      const fetched = await loadViewerPayload()
      setPayload(fetched)

      if (!fetched) {
        setStatus("Auto-fetch selesai, tetapi data viewer belum tersedia.")
        setStatusTone("warning")
        return
      }

      setStatus("Data viewer berhasil diambil otomatis.")
      setStatusTone("success")
    } catch (error) {
      setStatus(`Gagal memuat: ${String((error as Error)?.message || error)}`)
      setStatusTone("error")
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const orderJson = useMemo(() => toPrettyJson(payload?.orderRawJson), [payload])
  const incomeJson = useMemo(() => toPrettyJson(payload?.incomeRawJson), [payload])
  const incomeDetailJson = useMemo(
    () => toPrettyJson(payload?.incomeDetailRawJson),
    [payload]
  )
  const fetchMetaJson = useMemo(() => toPrettyJson(payload?.fetchMeta), [payload])

  const copyText = async (value: string, label: string) => {
    if (!value) {
      setStatus(`${label} kosong.`)
      setStatusTone("warning")
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setStatus(`${label} berhasil dicopy.`)
      setStatusTone("success")
    } catch (error) {
      setStatus(`Gagal copy ${label}: ${String((error as Error)?.message || error)}`)
      setStatusTone("error")
    }
  }

  const downloadText = (filename: string, value: string, mimeType: string) => {
    if (!value) {
      setStatus("Data kosong.")
      setStatusTone("warning")
      return
    }

    const blob = new Blob([value], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)

    setStatus(`Berhasil download ${filename}.`)
    setStatusTone("success")
  }

  const downloadJson = (filename: string, value: string) => {
    downloadText(filename, value, "application/json")
  }

  const clear = async () => {
    setBusy(true)
    try {
      await clearViewerPayload()
      setPayload(null)
      setStatus("Data viewer dibersihkan.")
      setStatusTone("success")
    } catch (error) {
      setStatus(`Gagal membersihkan data: ${String((error as Error)?.message || error)}`)
      setStatusTone("error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: 12 }}>
        <h1 style={titleStyle}>Powermaxx Viewer</h1>
        <p style={subtitleStyle}>
          Viewer payload terakhir dari proses extension. Jika kosong, Viewer akan auto-fetch dari tab aktif.
        </p>
      </header>

      <div style={statusStyle(statusTone)}>{status}</div>

      <section style={cardStyle}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button
            type="button"
            style={buttonStyle("primary", busy)}
            disabled={busy}
            onClick={() => void refresh()}>
            Refresh
          </button>
          <button
            type="button"
            style={buttonStyle("danger", busy)}
            disabled={busy}
            onClick={() => void clear()}>
            Clear
          </button>
        </div>

        <div style={summaryGridStyle}>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Marketplace</div>
            <div style={summaryValueStyle}>
              {payload ? getMarketplaceLabel(payload.marketplace) : "-"}
            </div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Action Mode</div>
            <div style={summaryValueStyle}>{payload?.actionMode || "-"}</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Order ID</div>
            <div style={summaryValueStyle}>{payload?.orderId || "-"}</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Updated</div>
            <div style={summaryValueStyle}>
              {payload?.updatedAt
                ? new Date(payload.updatedAt).toLocaleString("id-ID")
                : "-"}
            </div>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Order JSON</h2>
        <div style={actionsRowStyle}>
          <button
            type="button"
            style={buttonStyle("neutral")}
            onClick={() => void copyText(orderJson, "Order JSON")}>
            Copy
          </button>
          <button
            type="button"
            style={buttonStyle("neutral")}
            onClick={() => downloadJson("order.json", orderJson)}>
            Download
          </button>
        </div>
        <pre style={codeStyle}>{orderJson || "// kosong"}</pre>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Income JSON</h2>
        <div style={actionsRowStyle}>
          <button
            type="button"
            style={buttonStyle("neutral")}
            onClick={() => void copyText(incomeJson, "Income JSON")}>
            Copy
          </button>
          <button
            type="button"
            style={buttonStyle("neutral")}
            onClick={() => downloadJson("income.json", incomeJson)}>
            Download
          </button>
        </div>
        <pre style={codeStyle}>{incomeJson || "// kosong"}</pre>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Income Detail JSON</h2>
        <div style={actionsRowStyle}>
          <button
            type="button"
            style={buttonStyle("neutral")}
            onClick={() => void copyText(incomeDetailJson, "Income Detail JSON")}>
            Copy
          </button>
          <button
            type="button"
            style={buttonStyle("neutral")}
            onClick={() => downloadJson("income-detail.json", incomeDetailJson)}>
            Download
          </button>
        </div>
        <pre style={codeStyle}>{incomeDetailJson || "// kosong"}</pre>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Fetch Meta</h2>
        <pre style={codeStyle}>{fetchMetaJson || "// kosong"}</pre>
      </section>
    </main>
  )
}

export default ViewerTabPage
