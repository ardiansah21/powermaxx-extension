const installBridgeScript = () => {
  const FLAG_KEY = "__powermaxxBridgeInstalled"

  if ((window as any)[FLAG_KEY]) {
    return
  }

  ;(window as any)[FLAG_KEY] = true
  ;(window as any).__pmxExtensionBridgeReady = true

  const SOURCE = "powermaxx"
  const RESPONSE_SOURCE = "powermaxx_extension"
  const BRIDGE_RESPONSE_TYPE = "bridge_response"
  const BRIDGE_PROBE_TYPE = "bridge_probe"
  const BRIDGE_PROBE_ACK_TYPE = "bridge_probe_ack"
  const WORKER_EVENT_TYPE = "worker_event"

  const ALLOWED_ACTIONS = new Set(["update_order", "update_income", "update_both"])
  const ALLOWED_MODES = new Set(["single", "bulk"])

  const EXTENSION_VERSION =
    chrome?.runtime?.getManifest?.()?.version || ""

  let activeBatchId = ""
  let bridgeQueue = Promise.resolve()

  const isObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value)

  const normalizeBatchId = (value: unknown) => String(value ?? "").trim()

  const normalizeAction = (value: unknown) => {
    const raw = String(value ?? "").trim().toLowerCase()
    return ALLOWED_ACTIONS.has(raw) ? raw : ""
  }

  const normalizeMode = (value: unknown) => {
    const raw = String(value ?? "").trim().toLowerCase()
    return ALLOWED_MODES.has(raw) ? raw : ""
  }

  const normalizeMarketplace = (value: unknown) => {
    const raw = String(value ?? "").trim().toLowerCase()

    if (raw === "shopee") {
      return "shopee"
    }

    if (raw === "tiktok" || raw === "tiktok shop" || raw === "tiktok_shop") {
      return "tiktok_shop"
    }

    if (raw === "auto") {
      return "auto"
    }

    return ""
  }

  const normalizeIdType = (value: unknown) => {
    const raw = String(value ?? "").trim().toLowerCase()

    if (raw === "mp_order_id" || raw === "order_id") {
      return "order_id"
    }

    if (raw === "mp_order_sn" || raw === "order_sn") {
      return "order_sn"
    }

    return ""
  }

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

  const normalizeOrderItem = (
    item: unknown,
    fallbackMarketplace: unknown,
    fallbackIdType: unknown
  ) => {
    if (item === null || item === undefined) {
      return null
    }

    if (typeof item === "string" || typeof item === "number") {
      const id = String(item).trim()
      if (!id) {
        return null
      }

      return {
        id,
        marketplace: normalizeMarketplace(fallbackMarketplace) || "auto",
        idType: normalizeIdType(fallbackIdType)
      }
    }

    if (!isObject(item)) {
      return null
    }

    const rawId =
      item.mp_order_id ??
      item.order_id ??
      item.order_sn ??
      item.id ??
      item.orderId ??
      item.orderSn

    const id = String(rawId ?? "").trim()
    if (!id) {
      return null
    }

    let idType = normalizeIdType(item.id_type ?? item.idType ?? fallbackIdType)

    if (!idType) {
      if (item.mp_order_id !== undefined || item.order_id !== undefined) {
        idType = "order_id"
      } else if (item.order_sn !== undefined || item.orderSn !== undefined) {
        idType = "order_sn"
      }
    }

    return {
      id,
      marketplace:
        normalizeMarketplace(item.marketplace) ||
        normalizeMarketplace(fallbackMarketplace) ||
        "auto",
      idType
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

  const normalizeApiPaths = (payload: unknown) => {
    if (!isObject(payload)) {
      return {}
    }

    const normalized: Record<string, string> = {}

    const request = payload.request || payload.request_path || payload.requestPath
    const result = payload.result || payload.result_path || payload.resultPath

    if (typeof request === "string" && request.trim()) {
      normalized.request = request.trim()
    }

    if (typeof result === "string" && result.trim()) {
      normalized.result = result.trim()
    }

    return normalized
  }

  const postResponse = (
    payload: Record<string, unknown>,
    requestId: string
  ) => {
    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        type: BRIDGE_RESPONSE_TYPE,
        request_id: requestId,
        ...payload
      },
      "*"
    )
  }

  const postProbeAck = (requestId: string) => {
    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        type: BRIDGE_PROBE_ACK_TYPE,
        request_id: requestId,
        ok: true,
        extension_version: EXTENSION_VERSION
      },
      "*"
    )
  }

  const postWorkerEvent = (
    eventName: string,
    payload: Record<string, unknown>
  ) => {
    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        type: WORKER_EVENT_TYPE,
        event: eventName,
        ...payload
      },
      "*"
    )
  }

  const dispatchBridgeRequest = async (data: Record<string, unknown>) => {
    const requestId = String(data.request_id || "").trim()

    if (String(data.type || "") === BRIDGE_PROBE_TYPE) {
      postProbeAck(requestId)
      return
    }

    const action = normalizeAction(data.action)
    const mode = (normalizeMode(data.mode) || "bulk") as "single" | "bulk"
    const orders = normalizeOrders(data)
    const batchId = normalizeBatchId(data.batch_id || data.batchId)
    const workerMode = Boolean(
      data.worker_mode === true ||
        data.workerMode === true ||
        batchId
    )

    if (!action) {
      postResponse(
        {
          ok: false,
          error: "Aksi tidak dikenali.",
          count: orders.length,
          mode,
          running: false,
          batch_id: batchId,
          worker_id: null
        },
        requestId
      )
      return
    }

    if (!batchId) {
      postResponse(
        {
          ok: false,
          error: "batch_id wajib diisi.",
          count: orders.length,
          mode,
          running: false,
          batch_id: "",
          worker_id: null
        },
        requestId
      )
      return
    }

    if (!workerMode && mode === "single" && orders.length !== 1) {
      postResponse(
        {
          ok: false,
          error: "Mode single hanya untuk 1 order.",
          count: orders.length,
          mode,
          running: false,
          batch_id: batchId,
          worker_id: null
        },
        requestId
      )
      return
    }

    const runtimeMessage = {
      type: "POWERMAXX_BATCH_WORKER",
      action,
      mode,
      batchId,
      batch_id: batchId,
      workerId: data.worker_id || data.workerId || "",
      worker_id: data.worker_id || data.workerId || "",
      marketplace: normalizeMarketplace(data.marketplace),
      id_type: normalizeIdType(data.id_type || data.idType),
      apiPaths: normalizeApiPaths(data.api_paths || data.apiPaths || data.worker_api),
      api_paths: normalizeApiPaths(data.api_paths || data.apiPaths || data.worker_api),
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
              error: runtimeErrorMessage,
              count: orders.length,
              mode,
              running: false,
              batch_id: batchId,
              worker_id: null
            },
            requestId
          )
          return
        }

        const responseBatchId = normalizeBatchId(
          (response as Record<string, unknown>)?.batchId ||
            (response as Record<string, unknown>)?.batch_id ||
            batchId
        )

        activeBatchId = responseBatchId || batchId

        postResponse(
          {
            ok: Boolean((response as Record<string, unknown>)?.ok),
            error: String((response as Record<string, unknown>)?.error || ""),
            count: Number((response as Record<string, unknown>)?.count ?? orders.length),
            mode,
            running: Boolean((response as Record<string, unknown>)?.running),
            batch_id: activeBatchId,
            worker_id:
              Number((response as Record<string, unknown>)?.workerId) ||
              Number((response as Record<string, unknown>)?.worker_id) ||
              null
          },
          requestId
        )
      })
    } catch (error) {
      postResponse(
        {
          ok: false,
          error: String((error as Error)?.message || error || "Gagal menghubungi extension worker."),
          count: orders.length,
          mode,
          running: false,
          batch_id: batchId,
          worker_id: null
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
    if (!isObject(message) || message.type !== "POWERMAXX_BRIDGE_EVENT") {
      return
    }

    const eventName = String(message.event || "").trim()
    const payload = isObject(message.payload)
      ? (message.payload as Record<string, unknown>)
      : {}

    if (!eventName) {
      return
    }

    const eventBatchId = normalizeBatchId(payload.batch_id || payload.batchId)

    if (activeBatchId && eventBatchId && eventBatchId !== activeBatchId) {
      return
    }

    postWorkerEvent(eventName, payload)
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
