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
  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
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
  width: 30,
  height: 30,
  border: "1px solid #94a3b8",
  borderRadius: 8,
  background: "#ffffff",
  color: "#0f172a",
  padding: 0,
  display: "grid",
  placeItems: "center",
  cursor: "pointer"
}

const avatarButtonStyle = (loggedIn: boolean): React.CSSProperties => ({
  width: 30,
  height: 30,
  borderRadius: 999,
  border: `1px solid ${loggedIn ? "#10b981" : "#f59e0b"}`,
  background: loggedIn ? "#ecfdf5" : "#fffbeb",
  color: loggedIn ? "#065f46" : "#92400e",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
  display: "grid",
  placeItems: "center"
})

const accountMenuStyle: React.CSSProperties = {
  position: "absolute",
  top: 36,
  right: 0,
  zIndex: 10,
  width: 216,
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: SPACE.sm,
  background: "#ffffff",
  boxShadow: "0 6px 20px rgba(15, 23, 42, 0.12)"
}

const menuEmailStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  overflowWrap: "anywhere"
}

const menuMutedStyle: React.CSSProperties = {
  margin: "2px 0 8px",
  fontSize: 11,
  color: "#64748b"
}

const statusToneStyle: Record<StatusTone, React.CSSProperties> = {
  neutral: { border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155" },
  success: { border: "1px solid #86efac", background: "#f0fdf4", color: "#166534" },
  warning: { border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e" },
  error: { border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b" }
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

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: SPACE.sm
}

const fullButtonStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box"
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
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [status, setStatus] = useState("Memuat sesi...")
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral")
  const [busyLogin, setBusyLogin] = useState(false)
  const [busyAction, setBusyAction] = useState(false)

  const setStatusMessage = (message: string, tone: StatusTone = "neutral") => {
    setStatus(message)
    setStatusTone(tone)
  }

  const canLogin = useMemo(
    () => Boolean(String(email).trim() && password),
    [email, password]
  )

  const avatarLabel = loggedIn ? String(email || "U").charAt(0).toUpperCase() : "U"

  const syncSession = async () => {
    const settings = await loadSettings()
    const active = Boolean(settings.auth.token)
    setBaseUrl(settings.auth.baseUrl || "")
    setEmail(settings.auth.email || "")
    setLoggedIn(active)
    setShowAccountMenu(false)
    return { active, email: settings.auth.email || "", baseUrl: settings.auth.baseUrl || "" }
  }

  useEffect(() => {
    void (async () => {
      const session = await syncSession()
      setStatusMessage(
        session.active
          ? `Sesi aktif: ${session.email || "akun tersimpan"}`
          : "Belum login.",
        session.active ? "success" : "warning"
      )
    })()
  }, [])

  useEffect(() => {
    if (!showAccountMenu) return

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (!headerWrapRef.current?.contains(target)) {
        setShowAccountMenu(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAccountMenu(false)
      }
    }

    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [showAccountMenu])

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
      setShowAccountMenu(false)
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
      setShowAccountMenu(false)
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
      setShowAccountMenu(false)
      setBusyAction(true)
      setStatusMessage(`Menjalankan ${actionMode}...`, "neutral")
      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_FETCH_SEND",
        actionMode
      })

      if (!response?.ok) {
        setStatusMessage(response?.error || "Fetch + Send gagal.", "error")
        return
      }

      if (response.openUrl) {
        await chrome.tabs.create({ url: response.openUrl })
      }

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

  const runDownloadAwb = async () => {
    if (!loggedIn) {
      setStatusMessage("Belum login.", "warning")
      return
    }

    try {
      setShowAccountMenu(false)
      setBusyAction(true)
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
      setShowAccountMenu(false)
      setBusyAction(true)
      setStatusMessage("Menjalankan fetch + send + AWB...", "neutral")

      const response = await sendRuntimeMessage<RuntimeResult>({
        type: "POWERMAXX_POPUP_FETCH_SEND_AWB"
      })

      const fetchOk = Boolean(response?.fetchOk)
      const awbOk = Boolean(response?.awbOk)

      if (response?.awb?.openUrl && !response.awb?.downloaded) {
        await chrome.tabs.create({ url: response.awb.openUrl })
      } else if (response?.openUrl) {
        await chrome.tabs.create({ url: response.openUrl })
      }

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
              onClick={() => chrome.runtime.openOptionsPage()}
              aria-label="Buka options">
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
            </button>
            {loggedIn && (
              <button
                type="button"
                style={avatarButtonStyle(true)}
                onClick={() => setShowAccountMenu((value) => !value)}
                aria-label={`Sesi aktif ${email}`}>
                {avatarLabel}
              </button>
            )}
          </div>
        </header>

        {loggedIn && showAccountMenu && (
          <div style={accountMenuStyle}>
            <p style={menuEmailStyle}>{email}</p>
            <p style={menuMutedStyle}>Sesi aktif</p>
            <button
              type="button"
              style={{
                ...buttonStyle("neutral", busyLogin || busyAction || !loggedIn),
                ...fullButtonStyle
              }}
              disabled={busyLogin || busyAction || !loggedIn}
              onClick={handleLogout}>
              Logout
            </button>
          </div>
        )}
      </div>

      <div style={statusStyle(statusTone)} aria-live="polite">
        {status}
      </div>

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
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}>
                {showPassword ? "Hide" : "Show"}
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
          <h2 style={sectionTitleStyle}>Fetch + Send</h2>
          <button
            type="button"
            style={{
              ...buttonStyle("primary", busyLogin || busyAction),
              ...fullButtonStyle,
              marginBottom: SPACE.sm
            }}
            disabled={busyLogin || busyAction}
            onClick={runFetchSendAwb}>
            Fetch + Send + AWB
          </button>

          <button
            type="button"
            style={{
              ...buttonStyle("neutral", busyLogin || busyAction),
              ...fullButtonStyle,
              marginBottom: SPACE.sm
            }}
            disabled={busyLogin || busyAction}
            onClick={() => runFetchSend("fetch_send")}>
            Fetch + Send
          </button>

          <div style={rowStyle}>
            <button
              type="button"
              style={{
                ...buttonStyle("neutral", busyLogin || busyAction),
                ...fullButtonStyle
              }}
              disabled={busyLogin || busyAction}
              onClick={() => runFetchSend("update_order")}>
              Update Order
            </button>
            <button
              type="button"
              style={{
                ...buttonStyle("neutral", busyLogin || busyAction),
                ...fullButtonStyle
              }}
              disabled={busyLogin || busyAction}
              onClick={() => runFetchSend("update_income")}>
              Update Income
            </button>
          </div>

          <button
            type="button"
            style={{
              ...buttonStyle("neutral", busyLogin || busyAction),
              ...fullButtonStyle,
              marginTop: SPACE.sm
            }}
            disabled={busyLogin || busyAction}
            onClick={runDownloadAwb}>
            Download AWB
          </button>
        </section>
      )}
    </main>
  )
}

export default PopupPage
