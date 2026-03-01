import { useEffect, useMemo, useRef, useState } from "react"

import type { ActionMode } from "~src/core/messages/contracts"
import { sendRuntimeMessage } from "~src/core/messaging/runtime-client"
import { ensureHostPermission } from "~src/core/permissions/host-permissions"
import { normalizeBaseUrl } from "~src/core/settings/schema"
import { loadSettings } from "~src/core/settings/storage"

type StatusTone = "neutral" | "success" | "warning" | "error"

type RuntimeResult = {
  ok: boolean
  error?: string
  orderId?: string
  orderNo?: string
  openUrl?: string
  fetchOk?: boolean
  awbOk?: boolean
  fetchedOnly?: boolean
  awb?: {
    ok?: boolean
    error?: string
    downloaded?: boolean
    fileName?: string
    openUrl?: string
  }
}

type BridgeUiStatus = "checking" | "active" | "inactive"

type BridgeHealthRuntimeResult = {
  ok: boolean
  status?: "active" | "inactive"
  reason?: string
}

type BridgeStatusCachePayload = {
  baseUrl: string
  status: "active" | "inactive"
  reason: string
  checkedAt: number
}

const BRIDGE_STATUS_CACHE_KEY = "pmxBridgeStatusCacheV1"

const SPACE = {
  sm: 8,
  md: 12,
  lg: 16
} as const

const pageStyle: React.CSSProperties = {
  width: 344,
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: SPACE.md,
  color: "#0f172a",
  background: "#f8fafc",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  lineHeight: 1.35
}

const headerWrapStyle: React.CSSProperties = {
  position: "relative",
  marginBottom: SPACE.md
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: SPACE.sm
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18
}

const titleBlockStyle: React.CSSProperties = {
  minWidth: 0
}

const titleSubStyle: React.CSSProperties = {
  margin: "3px 0 0",
  fontSize: 11,
  color: "#64748b",
  overflowWrap: "anywhere"
}

const bridgeLineStyle: React.CSSProperties = {
  marginTop: 2,
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap"
}

const bridgeTextStyle = (_status: BridgeUiStatus): React.CSSProperties => ({
  ...titleSubStyle,
  margin: 0
})

const bridgeActionButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  margin: 0,
  width: 16,
  height: 16,
  color: "#64748b",
  display: "grid",
  placeItems: "center",
  cursor: "pointer"
}

const headerActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: SPACE.sm
}

const iconButtonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  border: "1px solid #94a3b8",
  borderRadius: 8,
  background: "#ffffff",
  color: "#0f172a",
  padding: 0,
  display: "grid",
  placeItems: "center",
  cursor: "pointer"
}

const userInitialButtonStyle = (disabled = false): React.CSSProperties => ({
  width: 34,
  height: 34,
  border: "1px solid #94a3b8",
  borderRadius: 9999,
  background: "#ffffff",
  color: "#0f172a",
  padding: 0,
  display: "grid",
  placeItems: "center",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.2,
  textTransform: "uppercase",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.6 : 1
})

const toolsMenuStyle: React.CSSProperties = {
  position: "absolute",
  top: 40,
  right: 0,
  zIndex: 10,
  width: 220,
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: SPACE.sm,
  background: "#ffffff",
  boxShadow: "0 6px 20px rgba(15, 23, 42, 0.12)"
}

const toolsMenuListStyle: React.CSSProperties = {
  display: "grid",
  gap: SPACE.sm
}

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 8
}

const statusToneStyle: Record<StatusTone, React.CSSProperties> = {
  neutral: {
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#334155"
  },
  success: {
    border: "1px solid #86efac",
    background: "#f0fdf4",
    color: "#166534"
  },
  warning: {
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e"
  },
  error: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b"
  }
}

const statusStyle = (tone: StatusTone): React.CSSProperties => ({
  borderRadius: 10,
  padding: "8px 10px",
  marginBottom: SPACE.md,
  fontSize: 12,
  overflowWrap: "anywhere",
  ...statusToneStyle[tone]
})

const cardStyle: React.CSSProperties = {
  border: "1px solid #dbe4ee",
  borderRadius: 10,
  background: "#ffffff",
  padding: SPACE.md,
  marginBottom: SPACE.md
}

const sectionTitleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 14
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
  fontSize: 12,
  color: "#334155"
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "8px 10px",
  marginBottom: SPACE.md
}

const passwordRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: SPACE.sm
}

const actionStackStyle: React.CSSProperties = {
  display: "grid",
  gap: SPACE.sm
}

const fullButtonStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 38
}

const buttonStyle = (
  variant: "primary" | "neutral",
  disabled = false
): React.CSSProperties => ({
  border: variant === "primary" ? "1px solid #2563eb" : "1px solid #94a3b8",
  borderRadius: 8,
  background: variant === "primary" ? "#2563eb" : "#f8fafc",
  color: variant === "primary" ? "#ffffff" : "#0f172a",
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 700,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.6 : 1
})

const buildUserInitials = (rawEmail: string) => {
  const emailText = String(rawEmail || "").trim()
  if (!emailText) {
    return "U"
  }

  const local = (emailText.split("@")[0] || emailText).trim()
  const parts = local.split(/[._\-\s]+/).filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase()
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }

  return local.slice(0, 2).toUpperCase()
}

function PopupPage() {
  const headerWrapRef = useRef<HTMLDivElement | null>(null)
  const bridgeCheckSeqRef = useRef(0)
  const bridgeCheckTimeoutRef = useRef<number | null>(null)
  const [baseUrl, setBaseUrl] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [status, setStatus] = useState("")
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral")
  const [pendingOrderUrl, setPendingOrderUrl] = useState("")
  const [pendingOrderNo, setPendingOrderNo] = useState("")
  const [busyLogin, setBusyLogin] = useState(false)
  const [busyAction, setBusyAction] = useState(false)
  const [bridgeStatus, setBridgeStatus] = useState<BridgeUiStatus>("inactive")
  const [bridgeHint, setBridgeHint] = useState("")
  const [bridgeBusy, setBridgeBusy] = useState(false)

  const setStatusMessage = (message: string, tone: StatusTone = "neutral") => {
    setStatus(message)
    setStatusTone(tone)
  }

  const clearStatusMessage = () => {
    setStatus("")
  }

  const loadBridgeStatusCache = async (): Promise<BridgeStatusCachePayload | null> => {
    if (!chrome.storage?.local) {
      return null
    }

    return new Promise((resolve) => {
      chrome.storage.local.get([BRIDGE_STATUS_CACHE_KEY], (result) => {
        const raw = result?.[BRIDGE_STATUS_CACHE_KEY]

        if (!raw || typeof raw !== "object") {
          resolve(null)
          return
        }

        const payload = raw as Partial<BridgeStatusCachePayload>
        const status = payload.status === "active" ? "active" : "inactive"

        resolve({
          baseUrl: normalizeBaseUrl(payload.baseUrl || ""),
          status,
          reason: String(payload.reason || ""),
          checkedAt: Number(payload.checkedAt || 0)
        })
      })
    })
  }

  const applyBridgeStatusFromCache = async (rawBaseUrl: string) => {
    const normalizedBaseUrl = normalizeBaseUrl(rawBaseUrl)

    if (!normalizedBaseUrl) {
      setBridgeStatus("inactive")
      setBridgeHint("Base URL belum diatur.")
      return
    }

    const cached = await loadBridgeStatusCache()
    if (!cached) {
      setBridgeStatus("inactive")
      setBridgeHint("Status bridge belum dicek. Klik Refresh Status.")
      return
    }

    if (normalizeBaseUrl(cached.baseUrl) !== normalizedBaseUrl) {
      setBridgeStatus("inactive")
      setBridgeHint("Base URL berubah. Klik Refresh Status.")
      return
    }

    setBridgeStatus(cached.status === "active" ? "active" : "inactive")
    setBridgeHint(cached.status === "inactive" ? cached.reason || "Bridge tidak aktif." : "")
  }

  const syncBridgeStatus = async (attemptRepair = false) => {
    const checkSeq = bridgeCheckSeqRef.current + 1
    bridgeCheckSeqRef.current = checkSeq

    if (bridgeCheckTimeoutRef.current !== null) {
      window.clearTimeout(bridgeCheckTimeoutRef.current)
      bridgeCheckTimeoutRef.current = null
    }

    try {
      setBridgeBusy(true)
      setBridgeStatus("checking")
      setBridgeHint("")

      const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
      if (attemptRepair && normalizedBaseUrl) {
        const granted = await ensureHostPermission(normalizedBaseUrl)
        if (!granted) {
          setBridgeStatus("inactive")
          setBridgeHint("Host permission ditolak. Bridge tidak bisa diaktifkan.")
          return
        }
      }

      bridgeCheckTimeoutRef.current = window.setTimeout(() => {
        if (bridgeCheckSeqRef.current !== checkSeq) {
          return
        }

        setBridgeBusy(false)
        setBridgeStatus("inactive")
        setBridgeHint("Bridge check timeout. Coba klik lagi.")
      }, 3500)

      const response = await sendRuntimeMessage<BridgeHealthRuntimeResult>({
        type: attemptRepair
          ? "POWERMAXX_POPUP_BRIDGE_REPAIR"
          : "POWERMAXX_POPUP_BRIDGE_STATUS"
      })

      if (bridgeCheckSeqRef.current !== checkSeq) {
        return
      }

      if (response?.status === "active") {
        setBridgeStatus("active")
        setBridgeHint("")
        return
      }

      setBridgeStatus("inactive")
      setBridgeHint(String(response?.reason || "Bridge tidak aktif."))
    } catch (error) {
      if (bridgeCheckSeqRef.current !== checkSeq) {
        return
      }

      setBridgeStatus("inactive")
      setBridgeHint(String((error as Error)?.message || error || "Bridge check gagal."))
    } finally {
      if (bridgeCheckTimeoutRef.current !== null) {
        window.clearTimeout(bridgeCheckTimeoutRef.current)
        bridgeCheckTimeoutRef.current = null
      }

      if (bridgeCheckSeqRef.current === checkSeq) {
        setBridgeBusy(false)
      }
    }
  }

  const extractOrderNoFromUrl = (value?: string) => {
    const raw = String(value || "").trim()
    if (!raw) return ""

    try {
      const parsed = new URL(raw)
      const queryOrderNo = String(
        parsed.searchParams.get("order_no") ||
          parsed.searchParams.get("orderNo") ||
          ""
      ).trim()
      if (queryOrderNo) return queryOrderNo
    } catch (_error) {
      // ignore
    }

    return ""
  }

  const setOrderReference = (args?: { url?: string; orderNo?: string }) => {
    const nextUrl = String(args?.url || "").trim()
    const explicitOrderNo = String(args?.orderNo || "").trim()
    const nextOrderNo = explicitOrderNo || extractOrderNoFromUrl(nextUrl)

    setPendingOrderUrl(nextUrl)
    setPendingOrderNo(nextOrderNo)
  }

  const canLogin = useMemo(
    () => Boolean(String(email).trim() && password),
    [email, password]
  )
  const userInitials = useMemo(() => buildUserInitials(email), [email])
  const userTooltip = useMemo(() => {
    const activeEmail = String(email || "").trim() || "akun login"
    return `Login: ${activeEmail}. Klik untuk logout.`
  }, [email])

  const syncSession = async () => {
    const settings = await loadSettings()
    const active = Boolean(settings.auth.token)
    setBaseUrl(settings.auth.baseUrl || "")
    setEmail(settings.auth.email || "")
    setLoggedIn(active)
    setShowToolsMenu(false)
    return {
      active,
      email: settings.auth.email || "",
      baseUrl: settings.auth.baseUrl || ""
    }
  }

  useEffect(() => {
    void (async () => {
      const session = await syncSession()
      await applyBridgeStatusFromCache(session.baseUrl)
      clearStatusMessage()
    })()

    return () => {
      if (bridgeCheckTimeoutRef.current !== null) {
        window.clearTimeout(bridgeCheckTimeoutRef.current)
        bridgeCheckTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!showToolsMenu) return

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (!headerWrapRef.current?.contains(target)) {
        setShowToolsMenu(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowToolsMenu(false)
      }
    }

    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [showToolsMenu])

  const handleLogin = async (event?: React.FormEvent) => {
    event?.preventDefault()
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
    const normalizedEmail = String(email || "").trim()

    if (!normalizedEmail || !password) {
      setStatusMessage("Email dan password wajib diisi.", "warning")
      return
    }

    if (!normalizedBaseUrl) {
      setStatusMessage("Base URL belum diatur. Atur di Options.", "warning")
      return
    }

    try {
      setBusyLogin(true)
      setOrderReference()
      setStatusMessage("Meminta host permission...", "neutral")

      const granted = await ensureHostPermission(normalizedBaseUrl)
      if (!granted) {
        setStatusMessage("Host permission ditolak.", "warning")
        return
      }

      setStatusMessage("Login ke Powermaxx...", "neutral")
      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_LOGIN",
        baseUrl: normalizedBaseUrl,
        email: normalizedEmail,
        password
      })

      if (!response?.ok) {
        setStatusMessage(response?.error || "Login gagal.", "error")
        return
      }

      setPassword("")
      setShowPassword(false)
      setShowToolsMenu(false)
      const session = await syncSession()
      await applyBridgeStatusFromCache(session.baseUrl)
      setStatusMessage(
        `Login berhasil: ${session.email || normalizedEmail}`,
        "success"
      )
    } catch (error) {
      setStatusMessage(
        `Login gagal: ${String((error as Error)?.message || error)}`,
        "error"
      )
    } finally {
      setBusyLogin(false)
    }
  }

  const handleLogout = async () => {
    const confirmed = window.confirm("Logout dari akun ini?")
    if (!confirmed) {
      return
    }

    try {
      setBusyLogin(true)
      setOrderReference()
      setStatusMessage("Logout...", "neutral")
      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_LOGOUT"
      })

      if (!response?.ok) {
        setStatusMessage(response?.error || "Logout gagal.", "error")
        return
      }

      setPassword("")
      setShowPassword(false)
      setShowToolsMenu(false)
      const session = await syncSession()
      await applyBridgeStatusFromCache(session.baseUrl)
      setStatusMessage("Logout berhasil.", "success")
    } catch (error) {
      setStatusMessage(
        `Logout gagal: ${String((error as Error)?.message || error)}`,
        "error"
      )
    } finally {
      setBusyLogin(false)
    }
  }

  const runFetchSend = async (actionMode: ActionMode) => {
    if (!loggedIn) {
      setStatusMessage("Belum login.", "warning")
      return
    }

    try {
      setShowToolsMenu(false)
      setBusyAction(true)
      setOrderReference()
      setStatusMessage("Menjalankan Update MP...", "neutral")
      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_FETCH_SEND",
        actionMode
      })

      if (!response?.ok) {
        setStatusMessage(response?.error || "Fetch + Send gagal.", "error")
        return
      }

      setOrderReference({
        url: response.openUrl,
        orderNo: response.orderNo
      })

      const orderNo = String(response.orderNo || "").trim()

      if (orderNo) {
        setStatusMessage(`Berhasil. Order No: ${orderNo}`, "success")
      } else {
        setStatusMessage(
          "Data berhasil dikirim, tetapi Order No tidak tersedia dari API.",
          "warning"
        )
      }
    } catch (error) {
      setStatusMessage(
        `Fetch + Send gagal: ${String((error as Error)?.message || error)}`,
        "error"
      )
    } finally {
      setBusyAction(false)
    }
  }

  const openBulkOperator = async () => {
    try {
      setShowToolsMenu(false)
      await chrome.tabs.create({
        url: chrome.runtime.getURL("tabs/bulk.html")
      })
    } catch (error) {
      setStatusMessage(
        `Gagal membuka Bulk Operator: ${String((error as Error)?.message || error)}`,
        "error"
      )
    }
  }

  const openViewer = async () => {
    try {
      setShowToolsMenu(false)
      await chrome.tabs.create({
        url: chrome.runtime.getURL("tabs/viewer.html")
      })
    } catch (error) {
      setStatusMessage(
        `Gagal membuka Viewer: ${String((error as Error)?.message || error)}`,
        "error"
      )
    }
  }

  const runDownloadAwb = async () => {
    if (!loggedIn) {
      setStatusMessage("Belum login.", "warning")
      return
    }

    try {
      setShowToolsMenu(false)
      setBusyAction(true)
      setOrderReference()
      setStatusMessage("Menjalankan AWB...", "neutral")

      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_DOWNLOAD_AWB"
      })

      if (!response?.ok) {
        setStatusMessage(response?.error || "Download AWB gagal.", "error")
        return
      }

      if (response.awb?.openUrl && !response.awb?.downloaded) {
        await chrome.tabs.create({ url: response.awb.openUrl })
      }

      if (response.awb?.downloaded) {
        setStatusMessage(
          response.awb.fileName
            ? `AWB diunduh: ${response.awb.fileName}`
            : "AWB berhasil diunduh.",
          "success"
        )
        return
      }

      setStatusMessage("AWB berhasil diproses.", "success")
    } catch (error) {
      setStatusMessage(
        `Download AWB gagal: ${String((error as Error)?.message || error)}`,
        "error"
      )
    } finally {
      setBusyAction(false)
    }
  }

  const runFetchSendAwb = async () => {
    if (!loggedIn) {
      setStatusMessage("Belum login.", "warning")
      return
    }

    try {
      setShowToolsMenu(false)
      setBusyAction(true)
      setOrderReference()
      setStatusMessage("Menjalankan fetch + send + AWB...", "neutral")

      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_FETCH_SEND_AWB"
      })

      const fetchOk = Boolean(response?.fetchOk)
      const awbOk = Boolean(response?.awbOk)

      if (response?.awb?.openUrl && !response.awb?.downloaded) {
        await chrome.tabs.create({ url: response.awb.openUrl })
      }

      setOrderReference({
        url: response?.openUrl,
        orderNo: response?.orderNo
      })

      const orderNo = String(response?.orderNo || "").trim()

      if (fetchOk && awbOk) {
        const awbLabel = response.awb?.downloaded
          ? response.awb.fileName
            ? `AWB diunduh (${response.awb.fileName}).`
            : "AWB diunduh."
          : "AWB diproses."

        if (orderNo) {
          setStatusMessage(`Sukses. Order No: ${orderNo}. ${awbLabel}`, "success")
        } else {
          setStatusMessage(
            `Sukses, tetapi Order No tidak tersedia dari API. ${awbLabel}`,
            "warning"
          )
        }
        return
      }

      if (fetchOk && !awbOk) {
        setStatusMessage(
          `Data terkirim, tapi AWB gagal. ${response?.error || ""}`.trim(),
          "warning"
        )
        return
      }

      if (!fetchOk && awbOk) {
        setStatusMessage(
          `AWB berhasil, tapi fetch/send gagal. ${response?.error || ""}`.trim(),
          "warning"
        )
        return
      }

      setStatusMessage(response?.error || "Fetch + Send + AWB gagal.", "error")
    } catch (error) {
      setStatusMessage(
        `Fetch + Send + AWB gagal: ${String((error as Error)?.message || error)}`,
        "error"
      )
    } finally {
      setBusyAction(false)
    }
  }

  return (
    <main style={pageStyle}>
      <div style={headerWrapStyle} ref={headerWrapRef}>
        <header style={headerStyle}>
          <div style={titleBlockStyle}>
            <h1 style={titleStyle}>Powermaxx</h1>
            <p style={titleSubStyle}>
              Base URL: {baseUrl || "Belum diatur di options."}
            </p>
            <div style={bridgeLineStyle}>
              <span style={bridgeTextStyle(bridgeStatus)}>
                Bridge:{" "}
                {bridgeStatus === "active"
                  ? "ACTIVE"
                  : bridgeStatus === "inactive"
                    ? "INACTIVE"
                    : "CHECKING"}
              </span>
              <button
                type="button"
                style={{
                  ...bridgeActionButtonStyle,
                  opacity: bridgeBusy ? 0.6 : 1,
                  cursor: bridgeBusy ? "default" : "pointer"
                }}
                disabled={bridgeBusy}
                onClick={() =>
                  void syncBridgeStatus(bridgeStatus === "inactive")
                }
                aria-label={
                  bridgeBusy
                    ? "Checking bridge status"
                    : bridgeStatus === "inactive"
                      ? "Perbaiki Bridge"
                      : "Refresh Status"
                }
                title={
                  bridgeBusy
                    ? "Checking bridge status"
                    : bridgeStatus === "inactive"
                      ? "Perbaiki Bridge"
                      : "Refresh Status"
                }>
                {bridgeBusy ? (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true">
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeDasharray="4 3"
                    />
                  </svg>
                ) : bridgeStatus === "inactive" ? (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true">
                    <path
                      d="M17 17L22 12C23.4 10.6 23.4 8.4 22 7C20.6 5.6 18.4 5.6 17 7L13 11"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M7 7L2 12C0.6 13.4 0.6 15.6 2 17C3.4 18.4 5.6 18.4 7 17L11 13"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 3L21 21"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true">
                    <path
                      d="M21 12A9 9 0 0 0 5.5 5.7L3 8"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 3V8H8"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 12A9 9 0 0 0 18.5 18.3L21 16"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M16 21H21V16"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>
            {bridgeStatus === "inactive" && bridgeHint && (
              <p style={{ ...titleSubStyle, margin: "2px 0 0" }}>
                {bridgeHint}
              </p>
            )}
          </div>
          <div style={headerActionsStyle}>
            <button
              type="button"
              style={iconButtonStyle}
              onClick={() => setShowToolsMenu((value) => !value)}
              aria-label="Buka menu">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true">
                <path
                  d="M4.5 7.5H19.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M4.5 12H19.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M4.5 16.5H19.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {loggedIn && (
              <button
                type="button"
                style={userInitialButtonStyle(busyLogin || busyAction)}
                disabled={busyLogin || busyAction}
                onClick={handleLogout}
                aria-label={userTooltip}
                title={userTooltip}>
                {userInitials}
              </button>
            )}
          </div>
        </header>

        {showToolsMenu && (
          <div style={toolsMenuStyle}>
            <div style={toolsMenuListStyle}>
              <button
                type="button"
                style={{
                  ...buttonStyle("neutral", false),
                  ...fullButtonStyle
                }}
                onClick={() => {
                  setShowToolsMenu(false)
                  void openViewer()
                }}>
                <span style={menuItemStyle}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true">
                    <path
                      d="M2.5 12C4.7 7.8 8.1 5.7 12 5.7C15.9 5.7 19.3 7.8 21.5 12C19.3 16.2 15.9 18.3 12 18.3C8.1 18.3 4.7 16.2 2.5 12Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="3"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                  </svg>
                  <span>Viewer</span>
                </span>
              </button>
              <button
                type="button"
                style={{
                  ...buttonStyle("neutral", false),
                  ...fullButtonStyle
                }}
                onClick={() => {
                  setShowToolsMenu(false)
                  void openBulkOperator()
                }}>
                <span style={menuItemStyle}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true">
                    <rect
                      x="3.5"
                      y="4"
                      width="17"
                      height="16"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M7 9H17"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M7 13H17"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M7 17H13"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>Bulk Operator</span>
                </span>
              </button>
              <button
                type="button"
                style={{
                  ...buttonStyle("neutral", false),
                  ...fullButtonStyle
                }}
                onClick={() => {
                  setShowToolsMenu(false)
                  chrome.runtime.openOptionsPage()
                }}>
                <span style={menuItemStyle}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true">
                    <path
                      d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M19.4 13.5C19.46 13 19.5 12.5 19.5 12C19.5 11.5 19.46 11 19.4 10.5L21.1 9.2L19.4 6.3L17.3 7.1C16.5 6.5 15.6 6 14.6 5.7L14.3 3.5H10.9L10.6 5.7C9.6 6 8.7 6.5 7.9 7.1L5.8 6.3L4.1 9.2L5.8 10.5C5.74 11 5.7 11.5 5.7 12C5.7 12.5 5.74 13 5.8 13.5L4.1 14.8L5.8 17.7L7.9 16.9C8.7 17.5 9.6 18 10.6 18.3L10.9 20.5H14.3L14.6 18.3C15.6 18 16.5 17.5 17.3 16.9L19.4 17.7L21.1 14.8L19.4 13.5Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Pengaturan</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {status && (
        <div style={statusStyle(statusTone)} aria-live="polite">
          {status}
        </div>
      )}

      {pendingOrderUrl && (
        <div style={{ ...cardStyle, paddingTop: 10, paddingBottom: 10 }}>
          <button
            type="button"
            style={{
              ...buttonStyle("primary", busyLogin || busyAction),
              ...fullButtonStyle
            }}
            disabled={busyLogin || busyAction}
            onClick={() => chrome.tabs.create({ url: pendingOrderUrl })}>
            {pendingOrderNo ? `Open Order No ${pendingOrderNo}` : "Open Order"}
          </button>
        </div>
      )}

      {!loggedIn && (
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Login</h2>
          <form onSubmit={handleLogin}>
            <label style={labelStyle} htmlFor="pmx-email">
              Email
            </label>
            <input
              id="pmx-email"
              name="email"
              style={inputStyle}
              type="email"
              value={email}
              placeholder="nama@email.com"
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
            />

            <label style={labelStyle} htmlFor="pmx-password">
              Password
            </label>
            <div style={passwordRowStyle}>
              <input
                id="pmx-password"
                name="password"
                style={{ ...inputStyle, marginBottom: 0 }}
                type={showPassword ? "text" : "password"}
                value={password}
                placeholder="Masukkan password"
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                style={buttonStyle("neutral")}
                onClick={() => setShowPassword((value) => !value)}
                aria-label={
                  showPassword ? "Sembunyikan password" : "Tampilkan password"
                }>
                {showPassword ? "Tutup" : "Lihat"}
              </button>
            </div>

            <button
              type="submit"
              style={{
                ...buttonStyle("primary", busyLogin || busyAction || !canLogin),
                ...fullButtonStyle,
                marginTop: SPACE.lg
              }}
              disabled={busyLogin || busyAction || !canLogin}>
              {busyLogin ? "Memproses..." : "Login"}
            </button>
          </form>
        </section>
      )}

      {loggedIn && (
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Aksi Utama</h2>
          <div style={actionStackStyle}>
            <button
              type="button"
              style={{
                ...buttonStyle("primary", busyLogin || busyAction),
                ...fullButtonStyle
              }}
              disabled={busyLogin || busyAction}
              onClick={runFetchSendAwb}>
              Fetch + Send + AWB
            </button>

            <button
              type="button"
              style={{
                ...buttonStyle("neutral", busyLogin || busyAction),
                ...fullButtonStyle
              }}
              disabled={busyLogin || busyAction}
              onClick={() => runFetchSend("fetch_send")}>
              Fetch + Send
            </button>

            <button
              type="button"
              style={{
                ...buttonStyle("neutral", busyLogin || busyAction),
                ...fullButtonStyle
              }}
              disabled={busyLogin || busyAction}
              onClick={runDownloadAwb}>
              Download AWB
            </button>
          </div>
        </section>
      )}
    </main>
  )
}

export default PopupPage
