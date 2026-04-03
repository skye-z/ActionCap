import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import rrwebPlayer from 'rrweb-player'
import { applyDocumentLocale, getLocaleTag, t } from '../common/i18n'
import { buildSessionArchive, db, getSessionBundle, importSessionArchive, listSessions } from '../common/storage'
import { getScopeLabel, getSessionDisplayName } from '../common/session-utils'
import type {
  NetworkEvent,
  ReplayEventRecord,
  SessionBundle,
  SessionRecord,
  UserActionEvent,
} from '../common/types'
import {
  formatRequestPayload,
  formatResponsePayload,
  type PayloadContentType,
  type PayloadFormatResult,
} from './payload-format'

type FilterKind = 'all' | 'actions' | 'network' | 'errors'
type ResultsView = 'timeline' | 'replay'
type HighlightLanguage = Exclude<PayloadContentType, 'empty'>

type NetworkPair = {
  id: string
  requestId: string
  tabId: number
  ts: number
  request?: NetworkEvent
  response?: NetworkEvent
}

type TimelineItem =
  | { id: string; ts: number; kind: 'action'; tabId: number; payload: UserActionEvent }
  | { id: string; ts: number; kind: 'network'; tabId: number; payload: NetworkPair }

type PayloadModalState = {
  title: string
  content: string
  language: HighlightLanguage
  sizeBytes: number
  contentTypeLabel: string
  bodyEncoding?: NetworkEvent['bodyEncoding']
  truncated?: boolean
}

type ReplayPlayerInstance = rrwebPlayer & {
  $set: (props: { width: number; height: number }) => void
}

const params = new URLSearchParams(window.location.search)
const PAYLOAD_MODAL_THRESHOLD_BYTES = 1024
const REPLAY_CONTROLLER_HEIGHT = 80
const REPLAY_VIEWPORT_WIDTH_OFFSET = 360
const REPLAY_VIEWPORT_HEIGHT_OFFSET = 300

function formatDate(ts?: number) {
  if (!ts) return '--'
  return new Date(ts).toLocaleString(getLocaleTag())
}

function formatDuration(start?: number, end?: number) {
  if (!start) return '--'
  const diff = (end ?? Date.now()) - start
  const seconds = Math.max(0, Math.floor(diff / 1000))
  const minutes = Math.floor(seconds / 60)
  return t('duration_compact', { minutes, seconds: seconds % 60 })
}

function formatDurationMs(durationMs?: number) {
  if (durationMs == null) return '--'
  return t('duration_ms', { duration: durationMs })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function getPayloadSize(body?: string) {
  if (!body) return 0
  return new TextEncoder().encode(body).length
}

function syncUrl(nextSessionId: string | null, nextView: ResultsView) {
  const url = new URL(window.location.href)
  if (nextSessionId) url.searchParams.set('sessionId', nextSessionId)
  else url.searchParams.delete('sessionId')
  url.searchParams.set('view', nextView)
  window.history.replaceState({}, '', url)
}

function matchesSession(session: SessionRecord, keyword: string) {
  if (!keyword) return true
  const lowered = keyword.toLowerCase()
  return [getSessionDisplayName(session), session.id, getScopeLabel(session.scope), formatDate(session.startTime)]
    .join(' ')
    .toLowerCase()
    .includes(lowered)
}

function getSessionListMeta(session: SessionRecord) {
  return t('session_meta', { duration: formatDuration(session.startTime, session.endTime), tabs: session.tabCount, actions: session.actionCount })
}

function getSessionOverviewMeta(session: SessionRecord) {
  return t('session_meta', { duration: formatDuration(session.startTime, session.endTime), tabs: session.tabCount, actions: session.actionCount })
}

function summarizeAction(event: UserActionEvent) {
  switch (event.type) {
    case 'click':
    case 'dblclick':
    case 'contextmenu':
      return t(`event_${event.type}` as const, { target: event.selector ?? event.element?.tagName ?? 'element' })
    case 'input':
    case 'change':
      return t(`event_${event.type}` as const, { target: event.selector ?? event.element?.tagName ?? 'field' })
    case 'submit':
      return t('event_submit', { target: event.selector ?? event.element?.tagName ?? 'form' })
    case 'keydown':
      return t('event_keydown', { target: event.selector ?? event.element?.tagName ?? 'field' })
    case 'keyup':
      return t('event_keyup', { target: event.selector ?? event.element?.tagName ?? 'field' })
    case 'focus':
      return t('event_focus', { target: event.selector ?? event.element?.tagName ?? 'field' })
    case 'blur':
      return t('event_blur', { target: event.selector ?? event.element?.tagName ?? 'field' })
    case 'scroll':
      return t('event_scroll', { value: event.scroll?.y ?? 0 })
    case 'navigation':
      return t('event_navigation', { url: event.url })
    case 'tab-activated':
      return t('event_tab_activated')
    case 'tab-created':
      return t('event_tab_created')
    case 'tab-removed':
      return t('event_tab_removed')
    case 'window-focus':
      return t('event_window_focus')
    default:
      return `${event.type} ${event.selector ?? ''}`.trim()
  }
}

function summarizeNetworkPair(pair: NetworkPair) {
  const request = pair.request ?? pair.response
  const method = request?.method ?? 'GET'
  const url = request?.url ?? '--'
  const response = pair.response
  if (!response) return `${method} ${url} -> pending`
  if (response.errorText) return `${method} ${url} -> ${response.errorText}`
  return `${method} ${url} -> ${response.status ?? '--'} ${response.statusText ?? ''}`.trim()
}

function getNetworkItemTitle(pair: NetworkPair) {
  const url = pair.request?.url ?? pair.response?.url ?? '--'
  if (url === '--') return url

  try {
    const parsed = new URL(url)
    const method = (pair.request?.method ?? pair.response?.method ?? 'GET').toUpperCase()
    const search = method === 'GET' ? '' : parsed.search
    return `${parsed.host}${parsed.pathname || '/'}${search}` || parsed.host || url
  } catch {
    return url
  }
}

function getTimelineTags(item: TimelineItem) {
  if (item.kind === 'action') {
    return [{ label: t('timeline_tag_action'), className: `kind-pill ${item.kind}` }]
  }

  const pair = item.payload as NetworkPair
  const request = pair.request ?? pair.response
  const tags: Array<{ label: string; className: string }> = [
    { label: request?.method ?? 'GET', className: 'kind-pill method' },
  ]

  if (pair.response?.status != null) {
    const statusClass =
      pair.response.status >= 500 ? 'status-error' :
      pair.response.status >= 400 ? 'status-warn' :
      'status-ok'

    tags.push({ label: String(pair.response.status), className: `kind-pill ${statusClass}` })
  } else if (pair.response?.errorText) {
    tags.push({ label: t('timeline_tag_error'), className: 'kind-pill status-error' })
  }

  return tags
}

function buildNetworkPairs(networkEvents: NetworkEvent[]) {
  const pairs = new Map<string, NetworkPair>()
  for (const event of networkEvents) {
    const key = `${event.tabId}:${event.requestId}`
    const existing =
      pairs.get(key) ??
      ({ id: key, requestId: event.requestId, tabId: event.tabId, ts: event.ts } satisfies NetworkPair)
    if (event.phase === 'request') existing.request = event
    else existing.response = event
    existing.ts = existing.request?.ts ?? existing.response?.ts ?? event.ts
    pairs.set(key, existing)
  }
  return [...pairs.values()].sort((a, b) => a.ts - b.ts)
}

function pairIsError(pair: NetworkPair) {
  return Boolean(pair.response?.errorText || (pair.response?.status != null && pair.response.status >= 400))
}

function buildTimeline(bundle: SessionBundle, tabFilter: number | 'all', filter: FilterKind, search: string) {
  const keyword = search.trim().toLowerCase()
  const networkPairs = buildNetworkPairs(bundle.networkEvents)
  const items: TimelineItem[] = [
    ...bundle.userActions.map((payload) => ({ id: payload.id, ts: payload.ts, kind: 'action' as const, tabId: payload.tabId, payload })),
    ...networkPairs.map((payload) => ({ id: payload.id, ts: payload.ts, kind: 'network' as const, tabId: payload.tabId, payload })),
  ]

  return items
    .filter((item) => (tabFilter === 'all' ? true : item.tabId === tabFilter))
    .filter((item) => {
      if (filter === 'all') return true
      if (filter === 'actions') return item.kind === 'action'
      if (filter === 'network') return item.kind === 'network'
      return item.kind === 'network' && pairIsError(item.payload as NetworkPair)
    })
    .filter((item) => {
      if (!keyword) return true
      const summary = item.kind === 'action' ? summarizeAction(item.payload as UserActionEvent) : summarizeNetworkPair(item.payload as NetworkPair)
      return summary.toLowerCase().includes(keyword)
    })
    .sort((a, b) => a.ts - b.ts)
}

function useSessionData(sessionId: string | null) {
  const [bundle, setBundle] = useState<SessionBundle>({ tabs: [], userActions: [], networkEvents: [], replayEvents: [] })
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [items, sessionBundle] = await Promise.all([
        listSessions(),
        sessionId ? getSessionBundle(sessionId) : Promise.resolve({ tabs: [], userActions: [], networkEvents: [], replayEvents: [] }),
      ])
      if (!cancelled) {
        setSessions(items)
        setBundle(sessionBundle)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sessionId, reloadToken])

  return { bundle, sessions, reload: () => setReloadToken((value) => value + 1) }
}

function getDisplayLanguage(result: PayloadFormatResult): HighlightLanguage {
  if (result.kind === 'base64') return result.decodedKind ?? 'base64'
  return result.kind === 'empty' ? 'text' : result.kind
}

function getDisplayContent(result: PayloadFormatResult, body?: string) {
  return result.formatted ?? body ?? ''
}

function getContentTypeLabel(result: PayloadFormatResult) {
  if (result.kind === 'base64' && result.decodedKind) return `base64 → ${result.decodedKind}`
  return result.kind
}

function renderJsonSyntax(content: string) {
  const lines = content.split('\n')
  const pattern = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)?|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?|[{}\[\]:,])/g

  return lines.map((line, lineIndex) => {
    const fragments: JSX.Element[] = []
    let lastIndex = 0

    line.replace(pattern, (token, _group, offset: number) => {
      if (offset > lastIndex) {
        fragments.push(<span key={`text-${lineIndex}-${lastIndex}`} className="syntax-text">{line.slice(lastIndex, offset)}</span>)
      }

      const nextChar = line.slice(offset + token.length).trimStart()[0]
      let className = 'syntax-punctuation'
      if (token.startsWith('"')) className = nextChar === ':' ? 'syntax-key' : 'syntax-string'
      else if (token === 'true' || token === 'false') className = 'syntax-boolean'
      else if (token === 'null') className = 'syntax-null'
      else if (/^-?\d/.test(token)) className = 'syntax-number'

      fragments.push(<span key={`token-${lineIndex}-${offset}`} className={className}>{token}</span>)
      lastIndex = offset + token.length
      return token
    })

    if (lastIndex < line.length) {
      fragments.push(<span key={`tail-${lineIndex}-${lastIndex}`} className="syntax-text">{line.slice(lastIndex)}</span>)
    }
    if (!fragments.length) {
      fragments.push(<span key={`empty-${lineIndex}`} className="syntax-text">{' '}</span>)
    }

    return <Fragment key={`json-line-${lineIndex}`}>{fragments}{lineIndex < lines.length - 1 ? '\n' : null}</Fragment>
  })
}

function renderMarkupSyntax(content: string) {
  return content.split(/(<[^>]+>)/g).filter(Boolean).map((part, index) =>
    part.startsWith('<') ? <span key={`markup-${index}`} className="syntax-tag">{part}</span> : <span key={`text-${index}`} className="syntax-text">{part}</span>,
  )
}

function renderPayloadSyntax(content: string, language: HighlightLanguage) {
  if (language === 'json') return renderJsonSyntax(content)
  if (language === 'html' || language === 'xml') return renderMarkupSyntax(content)
  if (language === 'base64') return <span className="syntax-number">{content}</span>
  return <span className="syntax-text">{content}</span>
}

function CodeBlock({ content, language, className = '' }: { content: string; language: HighlightLanguage; className?: string }) {
  return <pre className={`payload-block syntax-block ${className}`.trim()} data-language={language}><code>{renderPayloadSyntax(content, language)}</code></pre>
}

function ReplayPanel({ replayEvents }: { replayEvents: ReplayEventRecord[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<ReplayPlayerInstance | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.replaceChildren()
    playerRef.current = null

    const events = replayEvents.map((item) => item.payload).filter(Boolean) as any[]
    if (!events.length) return

    const getPlayerSize = () => {
      const width = Math.max(window.innerWidth - REPLAY_VIEWPORT_WIDTH_OFFSET, 360)
      const totalHeight = Math.max(window.innerHeight - REPLAY_VIEWPORT_HEIGHT_OFFSET, 320)
      return {
        width,
        height: Math.max(totalHeight - REPLAY_CONTROLLER_HEIGHT, 220),
      }
    }

    const player = new rrwebPlayer({
      target: container,
      props: { events, autoPlay: false, width: getPlayerSize().width, height: getPlayerSize().height, maxScale: 0 },
    }) as ReplayPlayerInstance
    playerRef.current = player

    let resizeFrame = 0
    const syncPlayerSize = () => {
      resizeFrame = 0
      const currentContainer = containerRef.current
      const currentPlayer = playerRef.current
      if (!currentContainer || !currentPlayer) return

      const { width, height } = getPlayerSize()
      currentPlayer.$set({ width, height })
      currentPlayer.triggerResize()
    }

    const scheduleSync = () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame)
      resizeFrame = window.requestAnimationFrame(syncPlayerSize)
    }

    const observer = new ResizeObserver(scheduleSync)
    observer.observe(container)
    window.addEventListener('resize', scheduleSync)
    scheduleSync()

    return () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame)
      observer.disconnect()
      window.removeEventListener('resize', scheduleSync)
      container.replaceChildren()
      playerRef.current = null
    }
  }, [replayEvents])

  return (
    <div className="replay-layout">
      {replayEvents.length ? <div className="replay-stage" ref={containerRef} /> : <div className="empty-state">{t('no_replay_data')}</div>}
    </div>
  )
}

function MetaGrid({ items }: { items: Array<{ label: string; value: string | number | undefined }> }) {
  return <div className="meta-grid">{items.map((item) => <div key={item.label} className="meta-card"><span>{item.label}</span><strong>{item.value == null || item.value === '' ? '--' : String(item.value)}</strong></div>)}</div>
}

function HeaderTable({ title, headers }: { title: string; headers?: Record<string, string> }) {
  const entries = Object.entries(headers ?? {})
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {entries.length ? <div className="header-table">{entries.map(([key, value]) => <div key={key} className="header-row"><span>{key}</span><code>{value}</code></div>)}</div> : <div className="detail-empty">{t('none')}</div>}
    </section>
  )
}

function getUrlQueryEntries(url?: string) {
  if (!url) return []

  try {
    const parsed = new URL(url)
    const grouped = new Map<string, string[]>()

    parsed.searchParams.forEach((value, key) => {
      const values = grouped.get(key) ?? []
      values.push(value === '' ? t('empty_value') : value)
      grouped.set(key, values)
    })

    return [...grouped.entries()].map(([key, values]) => ({ key, value: values.join('\n') }))
  } catch {
    return []
  }
}

function PayloadViewer({
  title,
  body,
  formatter,
  headers,
  mimeType,
  bodyEncoding,
  truncated,
  onOpenFullPayload,
}: {
  title: string
  body?: string
  formatter: typeof formatRequestPayload | typeof formatResponsePayload
  headers?: Record<string, string>
  mimeType?: string
  bodyEncoding?: NetworkEvent['bodyEncoding']
  truncated?: boolean
  onOpenFullPayload: (next: PayloadModalState) => void
}) {
  if (!body) {
    return <section className="detail-section"><h3>{title}</h3><div className="detail-empty">{t('none')}</div></section>
  }

  const sizeBytes = getPayloadSize(body)
  const result = formatter({ body, headers, mimeType, encoding: bodyEncoding })
  const displayContent = getDisplayContent(result, body)
  const language = getDisplayLanguage(result)
  const contentTypeLabel = getContentTypeLabel(result)
  const hiddenByDefault = sizeBytes > PAYLOAD_MODAL_THRESHOLD_BYTES

  return (
    <section className="detail-section">
      <div className="payload-section-head">
        <h3>{title}</h3>
        <span className="payload-type-chip">{contentTypeLabel}</span>
      </div>
      {hiddenByDefault ? (
        <div className="payload-shell payload-shell-hidden">
          <p className="payload-hidden-hint">{t('payload_hidden_hint')}</p>
          <div className="payload-meta-row">
            <span>{formatBytes(sizeBytes)}</span>
            {bodyEncoding ? <span>{bodyEncoding}</span> : null}
            {truncated ? <span>{t('truncated_saved')}</span> : null}
          </div>
          <button type="button" className="payload-open-button" onClick={() => onOpenFullPayload({ title, content: displayContent, language, sizeBytes, bodyEncoding, truncated, contentTypeLabel })}>
            {t('view_full_payload')}
          </button>
        </div>
      ) : (
        <div className="payload-shell">
          <div className="payload-meta-row">
            <span>{formatBytes(sizeBytes)}</span>
            {bodyEncoding ? <span>{bodyEncoding}</span> : null}
            {truncated ? <span>{t('truncated_saved')}</span> : null}
          </div>
          <CodeBlock content={displayContent} language={language} />
        </div>
      )}
    </section>
  )
}

function PayloadModal({ payload, onClose }: { payload: PayloadModalState; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="payload-modal-backdrop" onClick={onClose} role="presentation">
      <div className="payload-modal-card detail-panel" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={payload.title}>
        <div className="payload-modal-header">
          <div>
            <p className="eyebrow">{t('payload_viewer')}</p>
            <h3>{payload.title}</h3>
            <div className="payload-meta-row payload-meta-row-modal">
              <span>{payload.contentTypeLabel}</span>
              <span>{formatBytes(payload.sizeBytes)}</span>
              {payload.bodyEncoding ? <span>{payload.bodyEncoding}</span> : null}
              {payload.truncated ? <span>{t('truncated_saved')}</span> : null}
            </div>
          </div>
          <button type="button" className="payload-modal-close" onClick={onClose}>{t('action_close')}</button>
        </div>
        <CodeBlock content={payload.content} language={payload.language} className="payload-modal-code" />
      </div>
    </div>
  )
}

function ActionDetail({ event }: { event: UserActionEvent }) {
  return (
    <div className="detail-panel">
      <div className="detail-head"><span className="kind-pill action">{t('timeline_tag_action')}</span><strong>{formatDate(event.ts)}</strong></div>
      <section className="detail-section">
        <h3>{t('action_overview')}</h3>
        <MetaGrid items={[{ label: t('label_type'), value: event.type }, { label: t('label_tab'), value: event.tabId }, { label: t('label_url'), value: event.url }, { label: t('label_selector'), value: event.selector }]} />
      </section>
      <section className="detail-section">
        <h3>{t('action_elements_input')}</h3>
        <MetaGrid items={[
          { label: t('label_tag'), value: event.element?.tagName },
          { label: t('label_text'), value: event.element?.text },
          { label: t('label_id'), value: event.element?.id },
          { label: t('label_class'), value: event.element?.className },
          { label: t('label_coordinates'), value: event.coordinates ? `${event.coordinates.x}, ${event.coordinates.y}` : undefined },
          { label: t('label_scroll'), value: event.scroll ? `${event.scroll.x}, ${event.scroll.y}` : undefined },
          { label: t('label_value'), value: event.value },
          { label: t('label_masked'), value: event.masked ? t('yes') : t('no') },
        ]} />
      </section>
      {event.metadata ? <section className="detail-section"><h3>{t('action_metadata')}</h3><CodeBlock content={JSON.stringify(event.metadata, null, 2)} language="json" /></section> : null}
    </div>
  )
}

function NetworkDetail({ pair, onOpenFullPayload }: { pair: NetworkPair; onOpenFullPayload: (next: PayloadModalState) => void }) {
  const request = pair.request ?? pair.response
  const response = pair.response
  const requestHeaders = pair.request?.requestHeaders ?? pair.response?.requestHeaders
  const requestBody = pair.request?.requestBody ?? pair.response?.requestBody
  const responseHeaders = pair.response?.responseHeaders
  const responseBody = pair.response?.responseBody
  const queryEntries = getUrlQueryEntries(request?.url)

  return (
    <div className="detail-panel">
      <div className="detail-head"><span className="kind-pill network">{t('timeline_tag_network')}</span><strong>{formatDate(pair.ts)}</strong></div>
      <section className="detail-section">
        <h3>{t('request_section')}</h3>
        <MetaGrid items={[{ label: t('label_method'), value: request?.method }, { label: t('label_url'), value: request?.url }, { label: t('label_resource_type'), value: request?.resourceType }, { label: t('label_initiator'), value: request?.initiator }, { label: t('label_request_id'), value: pair.requestId }, { label: t('label_tab'), value: pair.tabId }]} />
      </section>
      {queryEntries.length ? (
        <section className="detail-section">
          <h3>{t('url_params')}</h3>
          {queryEntries.length ? <div className="header-table">{queryEntries.map((entry) => <div key={entry.key} className="header-row"><span>{entry.key}</span><code>{entry.value}</code></div>)}</div> : <div className="detail-empty">{t('none')}</div>}
        </section>
      ) : null}
      <HeaderTable title={t('request_headers')} headers={requestHeaders} />
      <PayloadViewer title={t('request_body')} body={requestBody} headers={requestHeaders} bodyEncoding={pair.request?.bodyEncoding} truncated={pair.request?.truncated} formatter={formatRequestPayload} onOpenFullPayload={onOpenFullPayload} />
      <section className="detail-section">
        <h3>{t('response_section')}</h3>
        <MetaGrid items={[{ label: t('label_status_code'), value: response?.status }, { label: t('label_status_text'), value: response?.statusText ?? response?.errorText }, { label: t('label_duration'), value: formatDurationMs(response?.durationMs) }, { label: t('label_mime'), value: response?.mimeType }, { label: t('label_encoding'), value: response?.bodyEncoding }, { label: t('label_is_truncated'), value: response?.truncated ? t('yes') : t('no') }]} />
      </section>
      <HeaderTable title={t('response_headers')} headers={responseHeaders} />
      <PayloadViewer title={t('response_body')} body={responseBody} headers={responseHeaders} mimeType={response?.mimeType} bodyEncoding={response?.bodyEncoding} truncated={response?.truncated} formatter={formatResponsePayload} onOpenFullPayload={onOpenFullPayload} />
    </div>
  )
}

function DetailPanel({ selected, onOpenFullPayload }: { selected: TimelineItem | null; onOpenFullPayload: (next: PayloadModalState) => void }) {
  if (!selected) return <div className="detail-panel empty-state">{t('detail_empty')}</div>
  if (selected.kind === 'action') return <ActionDetail event={selected.payload} />
  return <NetworkDetail pair={selected.payload} onOpenFullPayload={onOpenFullPayload} />
}

function ViewTabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={`results-view-tab ${active ? 'active' : ''}`} onClick={onClick}>{label}</button>
}

export function ResultsApp() {
  const initialSessionId = params.get('sessionId')
  const initialView = params.get('view') === 'replay' ? 'replay' : 'timeline'
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId)
  const [view, setView] = useState<ResultsView>(initialView)
  const [tabFilter, setTabFilter] = useState<number | 'all'>('all')
  const [filter, setFilter] = useState<FilterKind>('all')
  const [search, setSearch] = useState('')
  const [sessionSearch, setSessionSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftSessionName, setDraftSessionName] = useState('')
  const [payloadModal, setPayloadModal] = useState<PayloadModalState | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const { bundle, sessions, reload } = useSessionData(sessionId)
  const deferredSearch = useDeferredValue(search)
  const deferredSessionSearch = useDeferredValue(sessionSearch.trim().toLowerCase())
  const session = bundle.session

  useEffect(() => {
    applyDocumentLocale()
  }, [])

  useEffect(() => {
    if (session) setDraftSessionName(getSessionDisplayName(session))
    else {
      setDraftSessionName('')
      setRenaming(false)
    }
  }, [session?.id, session?.name, session?.startTime, session?.scope])

  useEffect(() => {
    document.title = session ? t('results_title_with_name', { name: getSessionDisplayName(session) }) : t('results_title')
  }, [session?.id, session?.name, session?.startTime, session?.scope])

  useEffect(() => {
    setPayloadModal(null)
  }, [sessionId, tabFilter, view, selectedId])

  const filteredSessions = useMemo(() => sessions.filter((item) => matchesSession(item, deferredSessionSearch)), [sessions, deferredSessionSearch])
  const timeline = useMemo(() => buildTimeline(bundle, tabFilter, filter, deferredSearch), [bundle, tabFilter, filter, deferredSearch])
  const selected = useMemo(() => timeline.find((item) => item.id === selectedId) ?? timeline[0] ?? null, [timeline, selectedId])
  const replayEvents = useMemo(() => bundle.replayEvents.filter((item) => (tabFilter === 'all' ? item.tabId === selected?.tabId : item.tabId === tabFilter)), [bundle.replayEvents, selected, tabFilter])

  const updateView = (next: ResultsView) => {
    setView(next)
    syncUrl(sessionId, next)
  }

  const selectSession = (nextSessionId: string | null) => {
    setSessionId(nextSessionId)
    setSelectedId(null)
    setTabFilter('all')
    setView('timeline')
    syncUrl(nextSessionId, 'timeline')
  }

  const onRename = async () => {
    if (!sessionId || !draftSessionName.trim()) return
    await db.sessions.update(sessionId, { name: draftSessionName.trim() })
    setRenaming(false)
    reload()
  }

  const onExport = async () => {
    if (!sessionId) return
    const json = JSON.stringify(buildSessionArchive(bundle), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `actioncap-${sessionId}.bxdac`
    link.click()
    URL.revokeObjectURL(url)
  }

  const onOpenImport = () => {
    importInputRef.current?.click()
  }

  const onImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const importedSessionId = await importSessionArchive(JSON.parse(text))
      selectSession(importedSessionId)
      reload()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t('import_failed'))
    }
  }

  const onDelete = async () => {
    if (!sessionId) return
    await Promise.all([
      db.sessions.delete(sessionId),
      db.tabs.where('sessionId').equals(sessionId).delete(),
      db.userActions.where('sessionId').equals(sessionId).delete(),
      db.networkEvents.where('sessionId').equals(sessionId).delete(),
      db.replayEvents.where('sessionId').equals(sessionId).delete(),
    ])
    const nextId = filteredSessions.find((item) => item.id !== sessionId)?.id ?? null
    selectSession(nextId)
    reload()
  }

  return (
    <>
      <div className="results-shell">
        <div className="left-rail">
          <div className="session-search"><input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder={t('session_search_placeholder')} /></div>
          <section className="session-list">{filteredSessions.map((item) => <button key={item.id} className={`session-card ${sessionId === item.id ? 'selected' : ''}`} onClick={() => selectSession(item.id)}><strong>{getSessionDisplayName(item)}</strong><small>{getSessionListMeta(item)}</small></button>)}</section>
        </div>

        <main className="main-panel">
          {session ? (
            <>
              <header className="toolbar">
                <div>
                  <p className="eyebrow">{t('results_title')}</p>
                  {renaming ? <div className="rename-row"><input value={draftSessionName} onChange={(event) => setDraftSessionName(event.target.value)} placeholder={t('rename_placeholder')} /><button onClick={onRename}>{t('action_save')}</button><button className="ghost" onClick={() => { setDraftSessionName(getSessionDisplayName(session)); setRenaming(false) }}>{t('action_cancel')}</button></div> : <h2>{getSessionDisplayName(session)}</h2>}
                  <span>{formatDate(session.startTime)} · {formatDuration(session.startTime, session.endTime)} · {getScopeLabel(session.scope)}</span>
                </div>
                <div className="toolbar-actions">{view === 'timeline' ? <><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('search_timeline_placeholder')} /><select value={filter} onChange={(event) => setFilter(event.target.value as FilterKind)}><option value="all">{t('filter_all')}</option><option value="actions">{t('filter_actions')}</option><option value="network">{t('filter_network')}</option><option value="errors">{t('filter_errors')}</option></select></> : null}<button className="ghost" onClick={() => setRenaming((value) => !value)}>{renaming ? t('action_close_rename') : t('action_rename')}</button><button className="ghost" onClick={onOpenImport}>{t('action_import')}</button><button onClick={onExport}>{t('action_export')}</button><button className="danger" onClick={onDelete}>{t('action_delete_session')}</button></div>
              </header>

              <section className="results-content-nav">
                <div className="results-view-tabs"><ViewTabButton active={view === 'timeline'} label={t('view_timeline')} onClick={() => updateView('timeline')} /><ViewTabButton active={view === 'replay'} label={t('view_replay')} onClick={() => updateView('replay')} /></div>
                <div className="top-tab-nav tab-list--top"><button className={`tab-card ${tabFilter === 'all' ? 'selected' : ''}`} onClick={() => setTabFilter('all')}><strong>{t('all_tabs')}</strong><span>{bundle.tabs.length} {t('tabs_lower')}</span></button>{bundle.tabs.map((tab) => <button key={tab.id} className={`tab-card ${tabFilter === tab.tabId ? 'selected' : ''}`} onClick={() => setTabFilter(tab.tabId)}><strong>{tab.title || t('tab_with_id', { id: tab.tabId })}</strong><span>{tab.url}</span></button>)}</div>
              </section>

              {view === 'timeline' ? <div className="content-grid"><section className="timeline-panel"><div className="timeline-list">{timeline.length ? timeline.map((item) => <button key={item.id} className={`timeline-item ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}><div className="timeline-meta"><div className="timeline-tags">{getTimelineTags(item).map((tag) => <span key={`${item.id}-${tag.label}`} className={tag.className}>{tag.label}</span>)}</div><small>{formatDate(item.ts)}</small></div><strong>{item.kind === 'action' ? summarizeAction(item.payload as UserActionEvent) : getNetworkItemTitle(item.payload as NetworkPair)}</strong><span>{t('tab_with_id', { id: item.tabId })}{item.kind === 'network' && (item.payload as NetworkPair).response?.durationMs != null ? ` · ${formatDurationMs((item.payload as NetworkPair).response?.durationMs)}` : ''}</span></button>) : <div className="empty-state">{t('no_timeline_events')}</div>}</div></section><DetailPanel selected={selected} onOpenFullPayload={setPayloadModal} /></div> : <ReplayPanel replayEvents={replayEvents} />}
            </>
          ) : (
            <div className="session-browser">
              <header className="toolbar session-toolbar"><div><p className="eyebrow">{t('sessions_header')}</p><h2>{t('sessions_list_title')}</h2><span>{t('sessions_count', { filtered: filteredSessions.length, total: sessions.length })}</span></div><div className="toolbar-actions"><input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder={t('session_search_placeholder')} /><button className="ghost" onClick={onOpenImport}>{t('action_import')}</button></div></header>
              {filteredSessions.length ? <section className="session-grid">{filteredSessions.map((item) => <button key={item.id} className="session-browser-card" onClick={() => selectSession(item.id)}><div className="session-browser-head"><span className="kind-pill action">{getScopeLabel(item.scope)}</span><small>{formatDate(item.startTime)}</small></div><strong>{getSessionDisplayName(item)}</strong><p>{getSessionOverviewMeta(item)}</p></button>)}</section> : <div className="empty-state">{t('no_matching_sessions')}</div>}
            </div>
          )}
        </main>
      </div>
      <input ref={importInputRef} type="file" accept=".bxdac,.json,application/json" hidden onChange={onImport} />
      {payloadModal ? <PayloadModal payload={payloadModal} onClose={() => setPayloadModal(null)} /> : null}
    </>
  )
}
