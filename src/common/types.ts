export type RecordingScope = 'current-tab' | 'cross-tab' | 'all-windows'

export type RecorderStatus = 'idle' | 'recording' | 'stopping'

export type ActionType =
  | 'click'
  | 'dblclick'
  | 'contextmenu'
  | 'input'
  | 'change'
  | 'submit'
  | 'keydown'
  | 'keyup'
  | 'scroll'
  | 'focus'
  | 'blur'
  | 'navigation'
  | 'tab-activated'
  | 'tab-created'
  | 'tab-removed'
  | 'window-focus'

export interface SessionRecord {
  id: string
  name?: string
  scope: RecordingScope
  status: 'recording' | 'stopped' | 'failed'
  startTime: number
  endTime?: number
  startTabId: number
  startWindowId: number
  tabCount: number
  actionCount: number
  networkCount: number
  replayCount: number
}

export interface TrackedTabRecord {
  id: string
  sessionId: string
  tabId: number
  windowId: number
  title?: string
  url?: string
  faviconUrl?: string
  attachedDebugger: boolean
  firstSeenAt: number
  lastSeenAt: number
}

export interface ElementSnapshot {
  tagName?: string
  text?: string
  id?: string
  className?: string
  role?: string
  name?: string
}

export interface UserActionEvent {
  id: string
  sessionId: string
  tabId: number
  frameId: number
  ts: number
  type: ActionType
  url: string
  title?: string
  selector?: string
  element?: ElementSnapshot
  coordinates?: { x: number; y: number }
  scroll?: { x: number; y: number }
  value?: string
  masked?: boolean
  metadata?: Record<string, string | number | boolean | undefined>
}

export interface NetworkEvent {
  id: string
  sessionId: string
  tabId: number
  requestId: string
  ts: number
  phase: 'request' | 'response'
  url: string
  method?: string
  status?: number
  statusText?: string
  resourceType?: string
  mimeType?: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  bodyEncoding?: 'plain' | 'base64'
  durationMs?: number
  initiator?: string
  truncated?: boolean
  errorText?: string
}

export interface ReplayEventRecord {
  id: string
  sessionId: string
  tabId: number
  ts: number
  payload: unknown
}

export interface RecordingStats {
  tabCount: number
  actionCount: number
  networkCount: number
  replayCount: number
}

export interface ActiveRecordingState {
  sessionId: string
  scope: RecordingScope
  status: RecorderStatus
  startTime: number
  startTabId: number
  startWindowId: number
  trackedTabIds: number[]
  debuggerTabIds: number[]
  stats: RecordingStats
}

export interface RecordingStateSnapshot {
  active: boolean
  status: RecorderStatus
  sessionId?: string
  scope?: RecordingScope
  startTime?: number
  stats: RecordingStats
  trackedTabIds: number[]
}

export type RuntimeMessage =
  | { type: 'GET_RECORDING_STATE' }
  | { type: 'START_RECORDING'; scope: RecordingScope }
  | { type: 'STOP_RECORDING' }
  | { type: 'CONTENT_BOOTSTRAP_REQUEST'; url: string; title: string }
  | { type: 'RECORDED_USER_ACTION'; event: UserActionEvent }
  | { type: 'RECORDED_RRWEB_EVENT'; event: ReplayEventRecord }

export type RuntimeResponse =
  | { ok: true; state?: RecordingStateSnapshot; shouldRecord?: boolean; sessionId?: string }
  | { ok: false; error: string }

export interface SessionBundle {
  session?: SessionRecord
  tabs: TrackedTabRecord[]
  userActions: UserActionEvent[]
  networkEvents: NetworkEvent[]
  replayEvents: ReplayEventRecord[]
}
