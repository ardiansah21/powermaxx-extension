const installBridgeScript = () => {
  const FLAG_KEY = "__powermaxxBridgeInstalled"

  if ((window as any)[FLAG_KEY]) {
    return
  }

  ;(window as any)[FLAG_KEY] = true

  const SOURCE = "powermaxx"
  const RESPONSE_SOURCE = "powermaxx_extension"
  const WORKER_EVENT_TYPE = "worker_event"
  const BRIDGE_OWNER = "powermaxx_plasmo"
  const OWNER_FIELD = "__pmx_bridge_owner"
  const REQUEST_ID_FIELD = "__pmx_request_id"
  const INITIAL_EXTERNAL_GRACE_MS = 450
  const KNOWN_EXTERNAL_GRACE_MS = 180
  const EXTERNAL_RECENT_WINDOW_MS = 30_000
  const ALLOWED_ACTIONS = new Set(["update_order", "update_income", "update_both"])
  const ALLOWED_MODES = new Set(["single", "bulk"])
  let requestSequence = 0
  let externalBridgeLastSeenAt = 0
  let bridgeQueue = Promise.resolve()

  const normalizeList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.map(String).map((item) => item.trim()).filter(Boolean)
    }

    if (typeof value === "string") {
      return value
        .split(/[\n,;\t ]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    }

    return []
  }

  const normalizeMarketplace = (value: unknown) => {
    const raw = String(value ?? "").trim().toLowerCase()
    if (!raw) return ""
    if (raw === "shopee") return "shopee"
    if (raw === "tiktok" || raw === "tiktok shop" || raw === "tiktok_shop") {
      return "tiktok_shop"
    }
    if (raw === "auto") return "auto"
    return ""
  }

  const normalizeIdType = (value: unknown) => {
    const raw = String(value ?? "").trim().toLowerCase()
    if (!raw) return ""
    if (raw === "mp_order_id" || raw === "order_id") return "order_id"
    if (raw === "mp_order_sn" || raw === "order_sn") return "order_sn"
    return ""
  }

  const normalizeOrderItem = (
    item: unknown,
    fallbackMarketplace: unknown,
    fallbackIdType: unknown
  ) => {
    if (item === null || item === undefined) return null

    if (typeof item === "string" || typeof item === "number") {
      const id = String(item).trim()
      if (!id) return null
      return {
        id,
        marketplace: normalizeMarketplace(fallbackMarketplace),
        id_type: normalizeIdType(fallbackIdType)
      }
    }

    if (typeof item !== "object" || Array.isArray(item)) return null

    const record = item as Record<string, unknown>
    const rawId =
      record.mp_order_id ??
      record.order_id ??
      record.order_sn ??
      record.id ??
      record.orderId ??
      record.orderSn

    const id = String(rawId ?? "").trim()
    if (!id) return null

    let idType = normalizeIdType(record.id_type ?? record.idType ?? fallbackIdType)
    if (!idType) {
      if (record.mp_order_id !== undefined || record.order_id !== undefined) {
        idType = "order_id"
      } else if (record.order_sn !== undefined || record.orderSn !== undefined) {
        idType = "order_sn"
      }
    }

    return {
      id,
      marketplace:
        normalizeMarketplace(record.marketplace) ||
        normalizeMarketplace(fallbackMarketplace),
      id_type: idType
    }
  }

  const normalizeOrders = (payload: Record<string, unknown>) => {
    const fallbackMarketplace = payload.marketplace
    const fallbackIdType = payload.id_type

    if (Array.isArray(payload.orders)) {
      return payload.orders
        .map((item) => normalizeOrderItem(item, fallbackMarketplace, fallbackIdType))
        .filter(Boolean)
    }

    const list = normalizeList(payload.order_sn_list || payload.order_sn)

    return list
      .map((item) => normalizeOrderItem(item, fallbackMarketplace, fallbackIdType))
      .filter(Boolean)
  }

  const normalizeMode = (value: unknown) => {
    const raw = String(value ?? "").trim().toLowerCase()
    if (!raw) return ""
    return ALLOWED_MODES.has(raw) ? raw : ""
  }

  const normalizeRunId = (value: unknown) => String(value ?? "").trim()

  const isObject = (value: unknown) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value)

  const normalizeApiPaths = (payload: unknown) => {
    if (!isObject(payload)) return {}

    const normalized: Record<string, string> = {}
    const map: Record<string, string[]> = {
      claimNext: ["claimNext", "claim_next"],
      heartbeat: ["heartbeat"],
      report: ["report"],
      complete: ["complete"]
    }

    Object.entries(map).forEach(([targetKey, keys]) => {
      const matched = keys
        .map((key) => payload[key])
        .find((value) => typeof value === "string" && value.trim())

      if (typeof matched === "string") {
        normalized[targetKey] = matched.trim()
      }
    })

    return normalized
  }

  const buildResponsePayload = (payload: Record<string, unknown>) => {
    const countNumber = Number(payload?.count)

    return {
      ok: Boolean(payload?.ok),
      error: payload?.error ? String(payload.error) : "",
      count: Number.isFinite(countNumber) ? countNumber : 0,
      mode: payload?.mode === "single" ? "single" : "bulk",
      running: Boolean(payload?.running),
      run_id: normalizeRunId(payload?.runId || payload?.run_id),
      worker_id: String(payload?.workerId || payload?.worker_id || "").trim()
    }
  }

  const toRecord = (value: unknown) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null

  const isExternalBridgePayload = (value: unknown) => {
    const payload = toRecord(value)
    if (!payload) return false
    if (payload.source !== RESPONSE_SOURCE) return false
    if (String(payload[OWNER_FIELD] || "").trim() === BRIDGE_OWNER) {
      return false
    }

    return true
  }

  const isLikelyMatchingExternalResponse = (
    value: unknown,
    expectedMode: "single" | "bulk",
    expectedRunId: string
  ) => {
    const payload = toRecord(value)
    if (!payload) return false
    if (!isExternalBridgePayload(payload)) return false
    if (payload.type === WORKER_EVENT_TYPE) return false

    const mode = String(payload.mode || "").trim().toLowerCase()
    if (mode && mode !== expectedMode) return false

    if (expectedRunId) {
      const responseRunId = normalizeRunId(payload.run_id || payload.runId)
      if (responseRunId && responseRunId !== expectedRunId) {
        return false
      }
    }

    return true
  }

  const waitForExternalBridgeResponse = (
    expectedMode: "single" | "bulk",
    expectedRunId: string
  ) => {
    const now = Date.now()
    const hasRecentExternal =
      now - externalBridgeLastSeenAt <= EXTERNAL_RECENT_WINDOW_MS
    const timeoutMs = hasRecentExternal
      ? KNOWN_EXTERNAL_GRACE_MS
      : INITIAL_EXTERNAL_GRACE_MS

    return new Promise<boolean>((resolve) => {
      let completed = false

      const finalize = (handledExternally: boolean) => {
        if (completed) return
        completed = true
        window.removeEventListener("message", onMessage)
        window.clearTimeout(timer)
        resolve(handledExternally)
      }

      const onMessage = (event: MessageEvent) => {
        if (event.source !== window || !event.data) {
          return
        }

        if (
          !isLikelyMatchingExternalResponse(
            event.data,
            expectedMode,
            expectedRunId
          )
        ) {
          return
        }

        externalBridgeLastSeenAt = Date.now()
        finalize(true)
      }

      const timer = window.setTimeout(() => finalize(false), timeoutMs)

      window.addEventListener("message", onMessage)
    })
  }

  const buildRequestId = () => {
    requestSequence += 1
    return `${Date.now()}-${requestSequence}`
  }

  const postResponse = (payload: Record<string, unknown>, requestId?: string) => {
    const response = buildResponsePayload(payload)

    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        ...response,
        [OWNER_FIELD]: BRIDGE_OWNER,
        [REQUEST_ID_FIELD]: requestId || ""
      },
      "*"
    )
  }

  const postWorkerEvent = (
    eventName: unknown,
    payload: unknown,
    requestId?: string
  ) => {
    const safePayload = isObject(payload)
      ? (payload as Record<string, unknown>)
      : {}

    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        type: WORKER_EVENT_TYPE,
        event: String(eventName || ""),
        ...safePayload,
        [OWNER_FIELD]: BRIDGE_OWNER,
        [REQUEST_ID_FIELD]: requestId || ""
      },
      "*"
    )
  }

  const isContextInvalidatedMessage = (message: unknown) =>
    String(message || "").toLowerCase().includes("context invalidated")

  const buildExtensionUnavailableMessage = () =>
    "Koneksi extension terputus (context invalidated). Refresh halaman ini lalu coba lagi."

  const dispatchBridgeRequest = async (data: Record<string, unknown>) => {
    const requestId = buildRequestId()

    const runId = normalizeRunId(data.run_id || data.runId)
    const workerModeRequested = Boolean(
      runId || data.worker_mode === true || data.workerMode === true
    )

    const rawAction = String(data.action || "").trim().toLowerCase()
    const action = rawAction || (workerModeRequested ? "update_both" : "")

    const rawMode = String(data.mode || "").trim().toLowerCase()
    const normalizedMode = normalizeMode(rawMode)
    const responseMode = (normalizedMode || "bulk") as "single" | "bulk"

    const handledExternally = await waitForExternalBridgeResponse(
      responseMode,
      runId
    )

    if (handledExternally) {
      return
    }

    if (!ALLOWED_ACTIONS.has(action)) {
      postResponse(
        {
          ok: false,
          error: "Aksi tidak dikenali.",
          count: 0,
          mode: responseMode
        },
        requestId
      )
      return
    }

    const orders = normalizeOrders(data)
    if (!workerModeRequested && !orders.length) {
      postResponse(
        {
          ok: false,
          error: "Order tidak ditemukan.",
          count: 0,
          mode: responseMode
        },
        requestId
      )
      return
    }

    if (rawMode && !normalizedMode) {
      postResponse(
        {
          ok: false,
          error: "Mode tidak dikenali.",
          count: orders.length,
          mode: responseMode
        },
        requestId
      )
      return
    }

    const mode = (normalizedMode || "bulk") as "single" | "bulk"

    if (!workerModeRequested && mode === "single" && orders.length !== 1) {
      postResponse(
        {
          ok: false,
          error: "Mode single hanya untuk 1 order.",
          count: orders.length,
          mode
        },
        requestId
      )
      return
    }

    if (mode === "single" && !runId) {
      postResponse(
        {
          ok: false,
          error: "Mode single bridge wajib menyertakan run_id.",
          count: orders.length,
          mode
        },
        requestId
      )
      return
    }

    const apiPaths = normalizeApiPaths(
      data.api_paths || data.apiPaths || data.worker_api
    )

    const messageType = workerModeRequested
      ? "POWERMAXX_RUN_WORKER"
      : mode === "single"
        ? "POWERMAXX_SINGLE"
        : "POWERMAXX_BULK"

    const runtimeMessage = workerModeRequested
      ? {
          type: messageType,
          action,
          mode,
          runId,
          workerId: data.worker_id || data.workerId || "",
          marketplace: normalizeMarketplace(data.marketplace),
          id_type: normalizeIdType(data.id_type || data.idType),
          heartbeat_interval_ms:
            data.heartbeat_interval_ms ?? data.heartbeatMs ?? null,
          order_timeout_ms: data.order_timeout_ms ?? data.orderTimeoutMs ?? null,
          request_timeout_ms:
            data.request_timeout_ms ?? data.requestTimeoutMs ?? null,
          complete_on_finish:
            data.complete_on_finish === true || data.completeOnFinish === true,
          apiPaths,
          orders,
          sourceUrl: window.location.href
        }
      : {
          type: messageType,
          action,
          mode,
          orders,
          sourceUrl: window.location.href
        }

    try {
      chrome.runtime.sendMessage(runtimeMessage, (response) => {
        const runtimeErrorMessage = chrome.runtime.lastError?.message || ""

        if (runtimeErrorMessage) {
          postResponse(
            {
              ok: false,
              error: isContextInvalidatedMessage(runtimeErrorMessage)
                ? buildExtensionUnavailableMessage()
                : runtimeErrorMessage,
              count: orders.length,
              mode
            },
            requestId
          )
          return
        }

        postResponse(
          {
            ok: Boolean((response as any)?.ok),
            error: (response as any)?.error || "",
            count:
              (response as any)?.count ?? (workerModeRequested ? 0 : orders.length),
            mode,
            running: Boolean((response as any)?.running),
            runId: (response as any)?.runId || runId,
            workerId:
              (response as any)?.workerId ||
              String(data.worker_id || data.workerId || "")
          },
          requestId
        )
      })
    } catch (error) {
      const message = String((error as Error)?.message || error || "")
      postResponse(
        {
          ok: false,
          error: isContextInvalidatedMessage(message)
            ? buildExtensionUnavailableMessage()
            : message || "Gagal menghubungi extension worker.",
          count: orders.length,
          mode
        },
        requestId
      )
    }
  }

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== window || !event.data) {
      return
    }

    const data = event.data as Record<string, unknown>
    if (data.source !== SOURCE) {
      return
    }

    bridgeQueue = bridgeQueue
      .catch(() => undefined)
      .then(() => dispatchBridgeRequest(data))
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "POWERMAXX_BRIDGE_EVENT") return
    postWorkerEvent(message.event || "", message.payload || "")
  })

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || !event.data) {
      return
    }

    if (!isExternalBridgePayload(event.data)) {
      return
    }

    externalBridgeLastSeenAt = Date.now()
  })

  window.addEventListener("message", handleMessage)
}

export const injectBridgeScriptToTab = async (tabId: number) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: installBridgeScript
  })
}
