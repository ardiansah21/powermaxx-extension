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

function PopupPage() {
  const headerWrapRef = useRef<HTMLDivElement | null>(null)
  const [baseUrl, setBaseUrl] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [status, setStatus] = useState("")
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral")
  const [pendingOrderUrl, setPendingOrderUrl] = useState("")
  const [busyLogin, setBusyLogin] = useState(false)
  const [busyAction, setBusyAction] = useState(false)

  const setStatusMessage = (message: string, tone: StatusTone = "neutral") => {
    setStatus(message)
    setStatusTone(tone)
  }

  const clearStatusMessage = () => {
    setStatus("")
  }

  const setOrderUrlIfAny = (value?: string) => {
    const next = String(value || "").trim()
    setPendingOrderUrl(next)
  }

  const canLogin = useMemo(
    () => Boolean(String(email).trim() && password),
    [email, password]
  )

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
      await syncSession()
      clearStatusMessage()
    })()
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
      setOrderUrlIfAny("")
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
    try {
      setBusyLogin(true)
      setOrderUrlIfAny("")
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
      await syncSession()
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
      setOrderUrlIfAny("")
      setStatusMessage(`Menjalankan ${actionMode}...`, "neutral")
      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_FETCH_SEND",
        actionMode
      })

      if (!response?.ok) {
        setStatusMessage(response?.error || "Fetch + Send gagal.", "error")
        return
      }

      setOrderUrlIfAny(response.openUrl)

      setStatusMessage(
        response.orderId
          ? `Berhasil. Order: ${response.orderId}`
          : "Berhasil kirim data.",
        "success"
      )
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
      setOrderUrlIfAny("")
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
      setOrderUrlIfAny("")
      setStatusMessage("Menjalankan fetch + send + AWB...", "neutral")

      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_FETCH_SEND_AWB"
      })

      const fetchOk = Boolean(response?.fetchOk)
      const awbOk = Boolean(response?.awbOk)

      if (response?.awb?.openUrl && !response.awb?.downloaded) {
        await chrome.tabs.create({ url: response.awb.openUrl })
      }

      setOrderUrlIfAny(response?.openUrl)

      if (fetchOk && awbOk) {
        const awbLabel = response.awb?.downloaded
          ? response.awb.fileName
            ? `AWB diunduh (${response.awb.fileName}).`
            : "AWB diunduh."
          : "AWB diproses."
        setStatusMessage(
          response.orderId
            ? `Sukses. Order: ${response.orderId}. ${awbLabel}`
            : `Sukses. ${awbLabel}`,
          "success"
        )
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
                <rect
                  x="4"
                  y="4"
                  width="6"
                  height="6"
                  rx="1.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <rect
                  x="14"
                  y="4"
                  width="6"
                  height="6"
                  rx="1.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <rect
                  x="4"
                  y="14"
                  width="6"
                  height="6"
                  rx="1.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <rect
                  x="14"
                  y="14"
                  width="6"
                  height="6"
                  rx="1.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </button>
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
              {loggedIn && (
                <button
                  type="button"
                  style={{
                    ...buttonStyle("neutral", busyLogin || busyAction),
                    ...fullButtonStyle
                  }}
                  disabled={busyLogin || busyAction}
                  onClick={handleLogout}>
                  <span style={menuItemStyle}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true">
                      <path
                        d="M10 4H5.5C4.7 4 4 4.7 4 5.5V18.5C4 19.3 4.7 20 5.5 20H10"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                      <path
                        d="M14 8L19 12L14 16"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M9 12H19"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span>Logout</span>
                  </span>
                </button>
              )}
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
            Open Order
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
