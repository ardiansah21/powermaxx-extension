import { useEffect, useState } from "react"

import { sendRuntimeMessage } from "~src/core/messaging/runtime-client"
import { ensureHostPermission } from "~src/core/permissions/host-permissions"
import { loadSettings, saveSettings } from "~src/core/settings/storage"
import { type PowermaxxSettings } from "~src/core/settings/schema"

type StatusTone = "neutral" | "success" | "warning" | "error"

const SPACE = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20
} as const

const pageStyle: React.CSSProperties = {
  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  maxWidth: 900,
  margin: "20px auto",
  padding: `0 ${SPACE.lg}px 28px`,
  color: "#0f172a",
  background: "#f8fafc"
}

const headerStyle: React.CSSProperties = {
  marginBottom: SPACE.lg
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 26
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
  marginBottom: SPACE.lg,
  fontSize: 13,
  ...statusToneStyle[tone]
})

const sectionStyle: React.CSSProperties = {
  border: "1px solid #dbe4ee",
  borderRadius: 12,
  padding: SPACE.lg,
  background: "#ffffff",
  boxShadow: "0 1px 1px rgba(15, 23, 42, 0.03)"
}

const sectionTitleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 16
}

const sectionTextStyle: React.CSSProperties = {
  margin: `0 0 ${SPACE.md}px`,
  color: "#64748b",
  fontSize: 13
}

const formStackStyle: React.CSSProperties = {
  display: "grid",
  gap: SPACE.md
}

const fieldGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: SPACE.md
}

const fieldWrapStyle: React.CSSProperties = {
  minWidth: 0
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#334155",
  marginBottom: 4
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 9,
  padding: "10px 10px"
}

const actionBarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: SPACE.xl,
  paddingTop: SPACE.md,
  borderTop: "1px solid #e2e8f0"
}

const saveButtonStyle = (disabled: boolean): React.CSSProperties => ({
  border: "1px solid #2563eb",
  borderRadius: 9,
  padding: "10px 14px",
  minWidth: 132,
  background: "#2563eb",
  color: "#ffffff",
  fontWeight: 700,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.6 : 1
})

type FieldProps = {
  id: string
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: "text" | "url" | "email"
}

const Field = ({
  id,
  name,
  label,
  value,
  onChange,
  placeholder = "",
  type = "text"
}: FieldProps) => (
  <div style={fieldWrapStyle}>
    <label style={labelStyle} htmlFor={id}>
      {label}
    </label>
    <input
      id={id}
      name={name}
      style={inputStyle}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  </div>
)

function OptionsPage() {
  const [settings, setSettings] = useState<PowermaxxSettings | null>(null)
  const [status, setStatus] = useState("Memuat pengaturan...")
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings().then((loaded) => {
      setSettings(loaded)
      setStatus("Pengaturan siap.")
      setStatusTone("success")
    })
  }, [])

  if (!settings) {
    return <main style={pageStyle}>Memuat...</main>
  }

  const setStatusMessage = (message: string, tone: StatusTone = "neutral") => {
    setStatus(message)
    setStatusTone(tone)
  }

  const update = (patch: Partial<PowermaxxSettings>) => {
    setSettings((current) => {
      if (!current) return current
      return {
        ...current,
        ...patch
      }
    })
  }

  const save = async (event?: React.FormEvent) => {
    event?.preventDefault()

    try {
      setSaving(true)
      setStatusMessage("Menyimpan pengaturan...", "neutral")
      await saveSettings(settings)

      const granted = await ensureHostPermission(settings.auth.baseUrl)
      if (granted) {
        await sendRuntimeMessage({
          type: "POWERMAXX_BRIDGE_REGISTER",
          baseUrl: settings.auth.baseUrl
        })
      }

      setStatusMessage(
        granted
          ? "Pengaturan tersimpan dan bridge terdaftar."
          : "Pengaturan tersimpan. Grant host permission untuk aktivasi bridge.",
        granted ? "success" : "warning"
      )
    } catch (error) {
      setStatusMessage(
        `Gagal menyimpan: ${String((error as Error)?.message || error)}`,
        "error"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>Powermaxx Options</h1>
        <p style={subtitleStyle}>
          Atur Base URL API dan endpoint marketplace.
        </p>
      </header>

      <div style={statusStyle(statusTone)} aria-live="polite">
        {status}
      </div>

      <form onSubmit={save}>
        <div style={formStackStyle}>
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Autentikasi</h2>
            <p style={sectionTextStyle}>
              Login dilakukan dari popup. Pengaturan di sini hanya untuk Base URL API.
            </p>
            <div style={fieldGridStyle}>
              <Field
                id="opt-base-url"
                name="auth_base_url"
                label="Base URL API"
                type="url"
                value={settings.auth.baseUrl}
                onChange={(value) =>
                  update({
                    auth: {
                      ...settings.auth,
                      baseUrl: value
                    }
                  })
                }
                placeholder="https://powermaxx.test"
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Shopee</h2>
            <div style={fieldGridStyle}>
              <Field
                id="opt-shopee-search"
                name="shopee_search_endpoint"
                label="Search Endpoint"
                type="url"
                value={settings.marketplaces.shopee.searchEndpoint}
                onChange={(value) =>
                  update({
                    marketplaces: {
                      ...settings.marketplaces,
                      shopee: {
                        ...settings.marketplaces.shopee,
                        searchEndpoint: value
                      }
                    }
                  })
                }
              />

              <Field
                id="opt-shopee-income"
                name="shopee_income_endpoint"
                label="Income Endpoint"
                type="url"
                value={settings.marketplaces.shopee.incomeEndpoint}
                onChange={(value) =>
                  update({
                    marketplaces: {
                      ...settings.marketplaces,
                      shopee: {
                        ...settings.marketplaces.shopee,
                        incomeEndpoint: value
                      }
                    }
                  })
                }
              />

              <Field
                id="opt-shopee-order"
                name="shopee_order_endpoint"
                label="Order Endpoint"
                type="url"
                value={settings.marketplaces.shopee.orderEndpoint}
                onChange={(value) =>
                  update({
                    marketplaces: {
                      ...settings.marketplaces,
                      shopee: {
                        ...settings.marketplaces.shopee,
                        orderEndpoint: value
                      }
                    }
                  })
                }
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>TikTok Shop</h2>
            <div style={fieldGridStyle}>
              <Field
                id="opt-tiktok-order"
                name="tiktok_order_endpoint"
                label="Order Endpoint"
                type="url"
                value={settings.marketplaces.tiktok_shop.orderEndpoint}
                onChange={(value) =>
                  update({
                    marketplaces: {
                      ...settings.marketplaces,
                      tiktok_shop: {
                        ...settings.marketplaces.tiktok_shop,
                        orderEndpoint: value
                      }
                    }
                  })
                }
              />

              <Field
                id="opt-tiktok-statement"
                name="tiktok_statement_endpoint"
                label="Statement Endpoint"
                type="url"
                value={settings.marketplaces.tiktok_shop.statementEndpoint}
                onChange={(value) =>
                  update({
                    marketplaces: {
                      ...settings.marketplaces,
                      tiktok_shop: {
                        ...settings.marketplaces.tiktok_shop,
                        statementEndpoint: value
                      }
                    }
                  })
                }
              />

              <Field
                id="opt-tiktok-statement-detail"
                name="tiktok_statement_detail_endpoint"
                label="Statement Detail Endpoint"
                type="url"
                value={settings.marketplaces.tiktok_shop.statementDetailEndpoint}
                onChange={(value) =>
                  update({
                    marketplaces: {
                      ...settings.marketplaces,
                      tiktok_shop: {
                        ...settings.marketplaces.tiktok_shop,
                        statementDetailEndpoint: value
                      }
                    }
                  })
                }
              />
            </div>
          </section>
        </div>

        <div style={actionBarStyle}>
          <button type="submit" style={saveButtonStyle(saving)} disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    </main>
  )
}

export default OptionsPage
