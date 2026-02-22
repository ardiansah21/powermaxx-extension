export type Marketplace = "shopee" | "tiktok_shop" | "auto"

export type BridgeAction = "update_order" | "update_income" | "update_both"

export type BridgeMode = "single" | "bulk"

export type ActionMode = "fetch_send" | "update_income" | "update_order"

export interface NormalizedOrder {
  id: string
  marketplace: Marketplace
  idType: "order_id" | "order_sn" | ""
}

export interface BridgeApiPaths {
  claimNext?: string
  heartbeat?: string
  report?: string
  complete?: string
}

export interface BridgeInboundMessage {
  source: "powermaxx"
  action?: BridgeAction
  mode?: BridgeMode
  orders?: Array<string | number | Record<string, unknown>>
  order_sn?: string
  order_sn_list?: string[]
  marketplace?: string
  id_type?: string
  run_id?: string | number
  runId?: string | number
  worker_id?: string
  workerId?: string
  worker_mode?: boolean
  workerMode?: boolean
  api_paths?: Record<string, unknown>
  apiPaths?: Record<string, unknown>
  worker_api?: Record<string, unknown>
  heartbeat_interval_ms?: number
  heartbeatMs?: number
  order_timeout_ms?: number
  orderTimeoutMs?: number
  request_timeout_ms?: number
  requestTimeoutMs?: number
  complete_on_finish?: boolean
  completeOnFinish?: boolean
}

export interface BridgeResponseEnvelope {
  source: "powermaxx_extension"
  ok: boolean
  error: string
  count: number
  mode: BridgeMode
  running: boolean
  run_id: string
  worker_id: string
}

export interface BridgeWorkerEventEnvelope {
  source: "powermaxx_extension"
  type: "worker_event"
  event: string
  [key: string]: unknown
}

export interface RuntimeGetTargetTabRequest {
  type: "POWERMAXX_GET_TARGET_TAB"
}

export interface RuntimeBridgeRegisterRequest {
  type: "POWERMAXX_BRIDGE_REGISTER"
  baseUrl?: string
  baseUrls?: string[]
}

export interface RuntimeSingleRequest {
  type: "POWERMAXX_SINGLE"
  action: BridgeAction
  mode: "single"
  runId?: string
  run_id?: string
  workerId?: string
  worker_id?: string
  apiPaths?: BridgeApiPaths
  api_paths?: BridgeApiPaths
  marketplace?: string
  id_type?: string
  heartbeat_interval_ms?: number
  order_timeout_ms?: number
  request_timeout_ms?: number
  complete_on_finish?: boolean
  orders: NormalizedOrder[]
  sourceUrl?: string
}

export interface RuntimeBulkRequest {
  type: "POWERMAXX_BULK"
  action: BridgeAction
  mode: "bulk"
  orders: NormalizedOrder[]
  sourceUrl?: string
}

export interface RuntimeRunWorkerRequest {
  type: "POWERMAXX_RUN_WORKER"
  action: BridgeAction
  mode: BridgeMode
  runId?: string
  run_id?: string
  workerId?: string
  worker_id?: string
  apiPaths?: BridgeApiPaths
  api_paths?: BridgeApiPaths
  marketplace?: string
  id_type?: string
  heartbeat_interval_ms?: number
  order_timeout_ms?: number
  request_timeout_ms?: number
  complete_on_finish?: boolean
  orders: NormalizedOrder[]
  sourceUrl?: string
}

export interface RuntimePopupFetchSendRequest {
  type: "POWERMAXX_POPUP_FETCH_SEND"
  actionMode: ActionMode
}

export interface RuntimePopupFetchSendAwbRequest {
  type: "POWERMAXX_POPUP_FETCH_SEND_AWB"
}

export interface RuntimePopupDownloadAwbRequest {
  type: "POWERMAXX_POPUP_DOWNLOAD_AWB"
}

export interface RuntimePopupLoginRequest {
  type: "POWERMAXX_POPUP_LOGIN"
  baseUrl: string
  email: string
  password: string
}

export interface RuntimePopupLogoutRequest {
  type: "POWERMAXX_POPUP_LOGOUT"
}

export type RuntimeRequestMessage =
  | RuntimeGetTargetTabRequest
  | RuntimeBridgeRegisterRequest
  | RuntimeSingleRequest
  | RuntimeBulkRequest
  | RuntimeRunWorkerRequest
  | RuntimePopupFetchSendRequest
  | RuntimePopupFetchSendAwbRequest
  | RuntimePopupDownloadAwbRequest
  | RuntimePopupLoginRequest
  | RuntimePopupLogoutRequest

export interface RuntimeTargetTabResponse {
  ok: boolean
  tabId?: number
  url?: string
  error?: string
}

export interface RuntimeBridgeRegisterResponse {
  ok: boolean
  matches: string[]
}

export interface RuntimeAwbResult {
  ok: boolean
  error?: string
  downloaded?: boolean
  fileName?: string
  openUrl?: string
  printUrl?: string
  step?: string
  detail?: string
  marketplace?: Exclude<Marketplace, "auto">
}

export interface RuntimeActionResponse {
  ok: boolean
  error?: string
  count?: number
  mode?: BridgeMode
  running?: boolean
  runId?: string
  workerId?: string
  orderId?: string
  openUrl?: string
  fetchOk?: boolean
  awbOk?: boolean
  awb?: RuntimeAwbResult
}

export interface ContentFetchRequest {
  type: "POWERMAXX_CONTENT_FETCH_SEND"
  request: {
    marketplace: Exclude<Marketplace, "auto">
    actionMode: ActionMode
    components: string
    endpoints: {
      incomeEndpoint?: string
      orderEndpoint: string
      statementEndpoint?: string
      statementDetailEndpoint?: string
    }
  }
}

export interface ContentFetchResponse {
  ok: boolean
  error?: string
  orderRawJson: Record<string, unknown> | null
  incomeRawJson: Record<string, unknown> | null
  incomeDetailRawJson: Record<string, unknown> | null
  fetchMeta?: Record<string, unknown>
}

export interface ContentAwbRequest {
  type: "POWERMAXX_CONTENT_AWB"
  request: {
    marketplace: Exclude<Marketplace, "auto">
    endpoints: {
      orderEndpoint: string
      packageEndpoint?: string
      createJobEndpoint?: string
      downloadJobEndpoint?: string
      generateEndpoint?: string
    }
    options: {
      regionId?: string
      asyncSdVersion?: string
      fileType?: string
      fileName?: string
      fileContents?: string
      filePrefix?: string
    }
  }
}

export interface ContentAwbResponse {
  ok: boolean
  error?: string
  downloaded?: boolean
  fileName?: string
  openUrl?: string
  printUrl?: string
  step?: string
  detail?: string
  jobId?: string
}
