export type Marketplace = "shopee" | "tiktok_shop" | "auto"

export type BridgeAction = "update_both"

export type BridgeMode = "single" | "bulk"

export type ActionMode = "fetch_send"

export interface NormalizedOrder {
  id: string
  marketplace: Marketplace
  idType: "order_id" | "order_sn" | ""
}

export interface BridgeApiPaths {
  request?: string
  result?: string
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
  batch_id?: string | number
  batchId?: string | number
  worker_id?: string | number
  workerId?: string | number
  worker_mode?: boolean
  workerMode?: boolean
  api_paths?: Record<string, unknown>
  apiPaths?: Record<string, unknown>
}

export interface BridgeResponseEnvelope {
  source: "powermaxx_extension"
  ok: boolean
  error: string
  count: number
  mode: BridgeMode
  running: boolean
  batch_id: string
  worker_id: number | null
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

export interface RuntimeBatchWorkerRequest {
  type: "POWERMAXX_BATCH_WORKER"
  action: BridgeAction
  mode: BridgeMode
  batchId?: string
  batch_id?: string
  workerId?: string | number
  worker_id?: string | number
  apiPaths?: BridgeApiPaths
  api_paths?: BridgeApiPaths
  marketplace?: string
  id_type?: string
  orders: NormalizedOrder[]
  sourceUrl?: string
}

export interface RuntimeStopBatchWorkerRequest {
  type: "POWERMAXX_STOP_BATCH_WORKER"
  batchId?: string
  batch_id?: string
}

export interface RuntimePopupFetchSendRequest {
  type: "POWERMAXX_POPUP_FETCH_SEND"
  actionMode: ActionMode
}

export interface RuntimePopupFetchOnlyRequest {
  type: "POWERMAXX_POPUP_FETCH_ONLY"
  actionMode: ActionMode
}

export interface RuntimePopupFetchSendAwbRequest {
  type: "POWERMAXX_POPUP_FETCH_SEND_AWB"
}

export interface RuntimePopupDownloadAwbRequest {
  type: "POWERMAXX_POPUP_DOWNLOAD_AWB"
}

export interface RuntimePopupSendViewerRequest {
  type: "POWERMAXX_POPUP_SEND_VIEWER"
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

export interface RuntimePopupBridgeStatusRequest {
  type: "POWERMAXX_POPUP_BRIDGE_STATUS"
}

export interface RuntimePopupBridgeRepairRequest {
  type: "POWERMAXX_POPUP_BRIDGE_REPAIR"
}

export type RuntimeRequestMessage =
  | RuntimeGetTargetTabRequest
  | RuntimeBridgeRegisterRequest
  | RuntimeBatchWorkerRequest
  | RuntimeStopBatchWorkerRequest
  | RuntimePopupFetchSendRequest
  | RuntimePopupFetchOnlyRequest
  | RuntimePopupFetchSendAwbRequest
  | RuntimePopupDownloadAwbRequest
  | RuntimePopupSendViewerRequest
  | RuntimePopupLoginRequest
  | RuntimePopupLogoutRequest
  | RuntimePopupBridgeStatusRequest
  | RuntimePopupBridgeRepairRequest

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
  batchId?: string
  workerId?: number | null
  orderId?: string
  orderNo?: string
  openUrl?: string
  fetchOk?: boolean
  awbOk?: boolean
  awb?: RuntimeAwbResult
}

export interface RuntimeBridgeHealthResponse {
  ok: boolean
  status: "active" | "inactive"
  reason?: string
  tabId?: number
  url?: string
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
