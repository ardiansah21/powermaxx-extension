import { useEffect, useState } from "react"

import { sendRuntimeMessage } from "~src/core/messaging/runtime-client"
import { ensureHostPermission } from "~src/core/permissions/host-permissions"
import { type PowermaxxSettings } from "~src/core/settings/schema"
import { loadSettings, saveSettings } from "~src/core/settings/storage"

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

const sectionHeaderButtonStyle: React.CSSProperties = {
  width: "100%",
  border: "none",
  padding: 0,
  margin: 0,
  background: "transparent",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  textAlign: "left",
  cursor: "pointer",
  color: "#0f172a"
}

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16
}

const sectionTextStyle: React.CSSProperties = {
  margin: `${SPACE.sm}px 0 0`,
  color: "#64748b",
  fontSize: 13
}

const sectionBodyStyle: React.CSSProperties = {
  marginTop: SPACE.md
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
  padding: "10px 10px",
  background: "#ffffff"
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

type SectionKey =
  | "auth"
  | "shopee"
  | "shopeeAwb"
  | "tiktok"
  | "tiktokAwb"

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
  const [status, setStatus] = useState("")
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral")
  const [saving, setSaving] = useState(false)
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    auth: true,
    shopee: true,
    shopeeAwb: false,
    tiktok: true,
    tiktokAwb: false
  })

  useEffect(() => {
    loadSettings()
      .then((loaded) => {
        setSettings(loaded)
        setStatus("")
      })
      .catch((error) => {
        setStatus(`Gagal memuat pengaturan: ${String((error as Error)?.message || error)}`)
        setStatusTone("error")
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

  const toggleSection = (section: SectionKey) => {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section]
    }))
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
          Atur endpoint marketplace, default fallback, dan konfigurasi AWB.
        </p>
      </header>

      {status && (
        <div style={statusStyle(statusTone)} aria-live="polite">
          {status}
        </div>
      )}

      <form onSubmit={save}>
        <div style={formStackStyle}>
          <section style={sectionStyle}>
            <button
              type="button"
              style={sectionHeaderButtonStyle}
              onClick={() => toggleSection("auth")}
              aria-expanded={openSections.auth}>
              <h2 style={sectionTitleStyle}>Autentikasi</h2>
              <span aria-hidden="true">{openSections.auth ? "▾" : "▸"}</span>
            </button>
            <p style={sectionTextStyle}>
              Login dilakukan dari popup. Pengaturan di sini hanya untuk Base URL API.
            </p>
            {openSections.auth && (
              <div style={sectionBodyStyle}>
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

                  <div style={fieldWrapStyle}>
                    <label style={labelStyle} htmlFor="opt-default-marketplace">
                      Marketplace Default
                    </label>
                    <select
                      id="opt-default-marketplace"
                      name="default_marketplace"
                      style={inputStyle}
                      value={settings.defaultMarketplace}
                      onChange={(event) =>
                        update({
                          defaultMarketplace:
                            event.target.value === "tiktok_shop"
                              ? "tiktok_shop"
                              : "shopee"
                        })
                      }>
                      <option value="shopee">Shopee</option>
                      <option value="tiktok_shop">TikTok Shop</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <button
              type="button"
              style={sectionHeaderButtonStyle}
              onClick={() => toggleSection("shopee")}
              aria-expanded={openSections.shopee}>
              <h2 style={sectionTitleStyle}>Shopee</h2>
              <span aria-hidden="true">{openSections.shopee ? "▾" : "▸"}</span>
            </button>
            {openSections.shopee && (
              <div style={sectionBodyStyle}>
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
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <button
              type="button"
              style={sectionHeaderButtonStyle}
              onClick={() => toggleSection("shopeeAwb")}
              aria-expanded={openSections.shopeeAwb}>
              <h2 style={sectionTitleStyle}>Shopee AWB</h2>
              <span aria-hidden="true">{openSections.shopeeAwb ? "▾" : "▸"}</span>
            </button>
            <p style={sectionTextStyle}>
              Dipakai untuk aksi Download AWB dan Fetch + Send + AWB.
            </p>
            {openSections.shopeeAwb && (
              <div style={sectionBodyStyle}>
                <div style={fieldGridStyle}>
                  <Field
                    id="opt-shopee-awb-package"
                    name="shopee_awb_package_endpoint"
                    label="Get Package Endpoint"
                    type="url"
                    value={settings.marketplaces.shopee.awb.packageEndpoint}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          shopee: {
                            ...settings.marketplaces.shopee,
                            awb: {
                              ...settings.marketplaces.shopee.awb,
                              packageEndpoint: value
                            }
                          }
                        }
                      })
                    }
                  />

                  <Field
                    id="opt-shopee-awb-create-job"
                    name="shopee_awb_create_job_endpoint"
                    label="Create SD Job Endpoint"
                    type="url"
                    value={settings.marketplaces.shopee.awb.createJobEndpoint}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          shopee: {
                            ...settings.marketplaces.shopee,
                            awb: {
                              ...settings.marketplaces.shopee.awb,
                              createJobEndpoint: value
                            }
                          }
                        }
                      })
                    }
                  />

                  <Field
                    id="opt-shopee-awb-download-job"
                    name="shopee_awb_download_job_endpoint"
                    label="Download SD Job Endpoint"
                    type="url"
                    value={settings.marketplaces.shopee.awb.downloadJobEndpoint}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          shopee: {
                            ...settings.marketplaces.shopee,
                            awb: {
                              ...settings.marketplaces.shopee.awb,
                              downloadJobEndpoint: value
                            }
                          }
                        }
                      })
                    }
                  />

                  <Field
                    id="opt-shopee-awb-region"
                    name="shopee_awb_region_id"
                    label="Region ID"
                    value={settings.marketplaces.shopee.awb.regionId}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          shopee: {
                            ...settings.marketplaces.shopee,
                            awb: {
                              ...settings.marketplaces.shopee.awb,
                              regionId: value
                            }
                          }
                        }
                      })
                    }
                  />

                  <Field
                    id="opt-shopee-awb-async"
                    name="shopee_awb_async_version"
                    label="Async SD Version"
                    value={settings.marketplaces.shopee.awb.asyncSdVersion}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          shopee: {
                            ...settings.marketplaces.shopee,
                            awb: {
                              ...settings.marketplaces.shopee.awb,
                              asyncSdVersion: value
                            }
                          }
                        }
                      })
                    }
                  />

                  <Field
                    id="opt-shopee-awb-file-type"
                    name="shopee_awb_file_type"
                    label="File Type"
                    value={settings.marketplaces.shopee.awb.fileType}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          shopee: {
                            ...settings.marketplaces.shopee,
                            awb: {
                              ...settings.marketplaces.shopee.awb,
                              fileType: value
                            }
                          }
                        }
                      })
                    }
                  />

                  <Field
                    id="opt-shopee-awb-file-name"
                    name="shopee_awb_file_name"
                    label="File Name"
                    value={settings.marketplaces.shopee.awb.fileName}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          shopee: {
                            ...settings.marketplaces.shopee,
                            awb: {
                              ...settings.marketplaces.shopee.awb,
                              fileName: value
                            }
                          }
                        }
                      })
                    }
                  />

                  <Field
                    id="opt-shopee-awb-file-contents"
                    name="shopee_awb_file_contents"
                    label="File Contents"
                    value={settings.marketplaces.shopee.awb.fileContents}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          shopee: {
                            ...settings.marketplaces.shopee,
                            awb: {
                              ...settings.marketplaces.shopee.awb,
                              fileContents: value
                            }
                          }
                        }
                      })
                    }
                  />
                </div>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <button
              type="button"
              style={sectionHeaderButtonStyle}
              onClick={() => toggleSection("tiktok")}
              aria-expanded={openSections.tiktok}>
              <h2 style={sectionTitleStyle}>TikTok Shop</h2>
              <span aria-hidden="true">{openSections.tiktok ? "▾" : "▸"}</span>
            </button>
            {openSections.tiktok && (
              <div style={sectionBodyStyle}>
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
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <button
              type="button"
              style={sectionHeaderButtonStyle}
              onClick={() => toggleSection("tiktokAwb")}
              aria-expanded={openSections.tiktokAwb}>
              <h2 style={sectionTitleStyle}>TikTok Shop AWB</h2>
              <span aria-hidden="true">{openSections.tiktokAwb ? "▾" : "▸"}</span>
            </button>
            {openSections.tiktokAwb && (
              <div style={sectionBodyStyle}>
                <div style={fieldGridStyle}>
                  <Field
                    id="opt-tiktok-awb-generate"
                    name="tiktok_awb_generate_endpoint"
                    label="Generate Endpoint"
                    type="url"
                    value={settings.marketplaces.tiktok_shop.awb.generateEndpoint}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          tiktok_shop: {
                            ...settings.marketplaces.tiktok_shop,
                            awb: {
                              ...settings.marketplaces.tiktok_shop.awb,
                              generateEndpoint: value
                            }
                          }
                        }
                      })
                    }
                  />

                  <Field
                    id="opt-tiktok-awb-file-prefix"
                    name="tiktok_awb_file_prefix"
                    label="File Prefix"
                    value={settings.marketplaces.tiktok_shop.awb.filePrefix}
                    onChange={(value) =>
                      update({
                        marketplaces: {
                          ...settings.marketplaces,
                          tiktok_shop: {
                            ...settings.marketplaces.tiktok_shop,
                            awb: {
                              ...settings.marketplaces.tiktok_shop.awb,
                              filePrefix: value
                            }
                          }
                        }
                      })
                    }
                  />
                </div>
              </div>
            )}
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
