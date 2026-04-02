import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import rrwebPlayer from 'rrweb-player'
import { db, getSessionBundle, listSessions } from '../common/storage'
import { getScopeLabel, getSessionDisplayName } from '../common/session-utils'
import type {
  NetworkEvent,
  ReplayEventRecord,
  SessionBundle,
  SessionRecord,
  TrackedTabRecord,
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

const params = new URLSearchParams(window.location.search)
const PAYLOAD_MODAL_THRESHOLD_BYTES = 1024

function formatDate(ts?: number) {
  if (!ts) return '--'
  return new Date(ts).toLocaleString()
}

function formatDuration(start?: number, end?: number) {
  if (!start) return '--'
  const diff = (end ?? Date.now()) - start
  const seconds = Math.max(0, Math.floor(diff / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function formatDurationMs(durationMs?: number) {
  if (durationMs == null) return '--'
  return `${durationMs} ms`
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

function summarizeAction(event: UserActionEvent) {
  switch (event.type) {
    case 'click':
    case 'dblclick':
    case 'contextmenu':
      return `${event.type} ${event.selector ?? event.element?.tagName ?? 'element'}`
    case 'input':
    case 'change':
      return `${event.type} ${event.selector ?? event.element?.tagName ?? 'field'}`
    case 'scroll':
      return `scroll Y=${event.scroll?.y ?? 0}`
    case 'navigation':
      return `navigate ${event.url}`
    case 'tab-activated':
      return 'tab activated'
    case 'tab-created':
      return 'tab created'
    case 'tab-removed':
      return 'tab removed'
    case 'window-focus':
      return 'window focused'
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

function ReplayPanel({ tab, replayEvents }: { tab?: TrackedTabRecord; replayEvents: ReplayEventRecord[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<rrwebPlayer | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''
    playerRef.current = null
    const events = replayEvents.map((item) => item.payload).filter(Boolean) as any[]
    if (!events.length) return

    playerRef.current = new rrwebPlayer({
      target: containerRef.current,
      props: { events, autoPlay: false, width: 960, height: 540 },
    })

    return () => {
      containerRef.current?.replaceChildren()
      playerRef.current = null
    }
  }, [replayEvents])

  return (
    <div className="replay-layout">
      <div className="replay-head">
        <div>
          <p className="eyebrow">Replay</p>
          <h2>{tab?.title ?? '未选择 Tab'}</h2>
          <span>{tab?.url ?? '请选择顶部 Tab 以查看 rrweb 回放。'}</span>
        </div>
      </div>
      {replayEvents.length ? <div className="replay-stage" ref={containerRef} /> : <div className="empty-state">当前 Tab 没有可用回放数据。该页面可能不支持脚本注入，或录制尚未产生快照。</div>}
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
      {entries.length ? <div className="header-table">{entries.map(([key, value]) => <div key={key} className="header-row"><span>{key}</span><code>{value}</code></div>)}</div> : <div className="detail-empty">无</div>}
    </section>
  )
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
    return <section className="detail-section"><h3>{title}</h3><div className="detail-empty">无</div></section>
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
          <p className="payload-hidden-hint">内容超过 1KB，默认隐藏。点击按钮在模态框中查看格式化后的完整内容。</p>
          <div className="payload-meta-row">
            <span>{formatBytes(sizeBytes)}</span>
            {bodyEncoding ? <span>{bodyEncoding}</span> : null}
            {truncated ? <span>已截断保存</span> : null}
          </div>
          <button type="button" className="payload-open-button" onClick={() => onOpenFullPayload({ title, content: displayContent, language, sizeBytes, bodyEncoding, truncated, contentTypeLabel })}>
            查看完整内容
          </button>
        </div>
      ) : (
        <div className="payload-shell">
          <div className="payload-meta-row">
            <span>{formatBytes(sizeBytes)}</span>
            {bodyEncoding ? <span>{bodyEncoding}</span> : null}
            {truncated ? <span>已截断保存</span> : null}
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
            <p className="eyebrow">Payload viewer</p>
            <h3>{payload.title}</h3>
            <div className="payload-meta-row payload-meta-row-modal">
              <span>{payload.contentTypeLabel}</span>
              <span>{formatBytes(payload.sizeBytes)}</span>
              {payload.bodyEncoding ? <span>{payload.bodyEncoding}</span> : null}
              {payload.truncated ? <span>已截断保存</span> : null}
            </div>
          </div>
          <button type="button" className="payload-modal-close" onClick={onClose}>关闭</button>
        </div>
        <CodeBlock content={payload.content} language={payload.language} className="payload-modal-code" />
      </div>
    </div>
  )
}

function ActionDetail({ event }: { event: UserActionEvent }) {
  return (
    <div className="detail-panel">
      <div className="detail-head"><span className="kind-pill action">action</span><strong>{formatDate(event.ts)}</strong></div>
      <section className="detail-section">
        <h3>操作概览</h3>
        <MetaGrid items={[{ label: '类型', value: event.type }, { label: 'Tab', value: event.tabId }, { label: 'URL', value: event.url }, { label: 'Selector', value: event.selector }]} />
      </section>
      <section className="detail-section">
        <h3>元素与输入</h3>
        <MetaGrid items={[
          { label: '标签', value: event.element?.tagName },
          { label: '文本', value: event.element?.text },
          { label: 'ID', value: event.element?.id },
          { label: 'Class', value: event.element?.className },
          { label: '坐标', value: event.coordinates ? `${event.coordinates.x}, ${event.coordinates.y}` : undefined },
          { label: '滚动', value: event.scroll ? `${event.scroll.x}, ${event.scroll.y}` : undefined },
          { label: '值', value: event.value },
          { label: '已脱敏', value: event.masked ? 'yes' : 'no' },
        ]} />
      </section>
      {event.metadata ? <section className="detail-section"><h3>附加信息</h3><CodeBlock content={JSON.stringify(event.metadata, null, 2)} language="json" /></section> : null}
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

  return (
    <div className="detail-panel">
      <div className="detail-head"><span className="kind-pill network">network</span><strong>{formatDate(pair.ts)}</strong></div>
      <section className="detail-section">
        <h3>请求</h3>
        <MetaGrid items={[{ label: '方法', value: request?.method }, { label: 'URL', value: request?.url }, { label: '资源类型', value: request?.resourceType }, { label: '发起方式', value: request?.initiator }, { label: 'Request ID', value: pair.requestId }, { label: 'Tab', value: pair.tabId }]} />
      </section>
      <HeaderTable title="请求头" headers={requestHeaders} />
      <PayloadViewer title="请求体" body={requestBody} headers={requestHeaders} bodyEncoding={pair.request?.bodyEncoding} truncated={pair.request?.truncated} formatter={formatRequestPayload} onOpenFullPayload={onOpenFullPayload} />
      <section className="detail-section">
        <h3>响应</h3>
        <MetaGrid items={[{ label: '状态码', value: response?.status }, { label: '状态文本', value: response?.statusText ?? response?.errorText }, { label: '耗时', value: formatDurationMs(response?.durationMs) }, { label: 'MIME', value: response?.mimeType }, { label: '编码', value: response?.bodyEncoding }, { label: '是否截断', value: response?.truncated ? 'yes' : 'no' }]} />
      </section>
      <HeaderTable title="响应头" headers={responseHeaders} />
      <PayloadViewer title="响应体" body={responseBody} headers={responseHeaders} mimeType={response?.mimeType} bodyEncoding={response?.bodyEncoding} truncated={response?.truncated} formatter={formatResponsePayload} onOpenFullPayload={onOpenFullPayload} />
    </div>
  )
}

function DetailPanel({ selected, onOpenFullPayload }: { selected: TimelineItem | null; onOpenFullPayload: (next: PayloadModalState) => void }) {
  if (!selected) return <div className="detail-panel empty-state">选择一条事件查看详情。</div>
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
  const { bundle, sessions, reload } = useSessionData(sessionId)
  const deferredSearch = useDeferredValue(search)
  const deferredSessionSearch = useDeferredValue(sessionSearch.trim().toLowerCase())
  const session = bundle.session

  useEffect(() => {
    if (session) setDraftSessionName(getSessionDisplayName(session))
    else {
      setDraftSessionName('')
      setRenaming(false)
    }
  }, [session?.id, session?.name, session?.startTime, session?.scope])

  useEffect(() => {
    setPayloadModal(null)
  }, [sessionId, tabFilter, view, selectedId])

  const filteredSessions = useMemo(() => sessions.filter((item) => matchesSession(item, deferredSessionSearch)), [sessions, deferredSessionSearch])
  const timeline = useMemo(() => buildTimeline(bundle, tabFilter, filter, deferredSearch), [bundle, tabFilter, filter, deferredSearch])
  const selected = useMemo(() => timeline.find((item) => item.id === selectedId) ?? timeline[0] ?? null, [timeline, selectedId])
  const selectedTab = useMemo(() => bundle.tabs.find((tab) => tab.tabId === (tabFilter === 'all' ? selected?.tabId : tabFilter)), [bundle.tabs, selected, tabFilter])
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
    const json = JSON.stringify(bundle, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `actioncap-${sessionId}.json`
    link.click()
    URL.revokeObjectURL(url)
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
        <aside className="left-rail">
          <div className="brand-card"><p className="eyebrow">ActionCap</p><h1>Session Atlas</h1><span>左侧仅保留会话导航，顶部负责视图切换与 Tab 导航。</span></div>
          <div className="session-search"><input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="搜索会话 / 范围 / 时间" /></div>
          <section className="session-list">{filteredSessions.map((item) => <button key={item.id} className={`session-card ${sessionId === item.id ? 'selected' : ''}`} onClick={() => selectSession(item.id)}><strong>{getSessionDisplayName(item)}</strong><span>{formatDate(item.startTime)}</span><small>{getScopeLabel(item.scope)}</small><small>{item.actionCount} actions · {Math.floor(item.networkCount / 2)} exchanges</small></button>)}</section>
        </aside>

        <main className="main-panel">
          {session ? (
            <>
              <header className="toolbar">
                <div>
                  <p className="eyebrow">Results</p>
                  {renaming ? <div className="rename-row"><input value={draftSessionName} onChange={(event) => setDraftSessionName(event.target.value)} placeholder="输入会话名称" /><button onClick={onRename}>保存</button><button className="ghost" onClick={() => { setDraftSessionName(getSessionDisplayName(session)); setRenaming(false) }}>取消</button></div> : <h2>{getSessionDisplayName(session)}</h2>}
                  <span>{formatDate(session.startTime)} · {formatDuration(session.startTime, session.endTime)} · {getScopeLabel(session.scope)}</span>
                </div>
                <div className="toolbar-actions">{view === 'timeline' ? <><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索操作 / 请求 / URL" /><select value={filter} onChange={(event) => setFilter(event.target.value as FilterKind)}><option value="all">全部</option><option value="actions">仅操作</option><option value="network">仅网络</option><option value="errors">错误</option></select></> : null}<button className="ghost" onClick={() => setRenaming((value) => !value)}>{renaming ? '关闭重命名' : '重命名'}</button><button onClick={onExport}>导出 JSON</button><button className="danger" onClick={onDelete}>删除会话</button></div>
              </header>

              <section className="results-content-nav">
                <div className="results-view-tabs"><ViewTabButton active={view === 'timeline'} label="时间线" onClick={() => updateView('timeline')} /><ViewTabButton active={view === 'replay'} label="回放" onClick={() => updateView('replay')} /></div>
                <div className="top-tab-nav tab-list--top"><button className={`tab-card ${tabFilter === 'all' ? 'selected' : ''}`} onClick={() => setTabFilter('all')}><strong>全部 Tab</strong><span>{bundle.tabs.length} tabs</span></button>{bundle.tabs.map((tab) => <button key={tab.id} className={`tab-card ${tabFilter === tab.tabId ? 'selected' : ''}`} onClick={() => setTabFilter(tab.tabId)}><strong>{tab.title || `Tab ${tab.tabId}`}</strong><span>{tab.url}</span></button>)}</div>
              </section>

              {view === 'timeline' ? <div className="content-grid"><section className="timeline-panel"><div className="timeline-list">{timeline.length ? timeline.map((item) => <button key={item.id} className={`timeline-item ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}><div className="timeline-meta"><span className={`kind-pill ${item.kind}`}>{item.kind}</span><small>{formatDate(item.ts)}</small></div><strong>{item.kind === 'action' ? summarizeAction(item.payload as UserActionEvent) : summarizeNetworkPair(item.payload as NetworkPair)}</strong><span>Tab {item.tabId}{item.kind === 'network' && (item.payload as NetworkPair).response?.durationMs != null ? ` · ${formatDurationMs((item.payload as NetworkPair).response?.durationMs)}` : ''}</span></button>) : <div className="empty-state">当前筛选条件下没有事件。</div>}</div></section><DetailPanel selected={selected} onOpenFullPayload={setPayloadModal} /></div> : <ReplayPanel tab={selectedTab} replayEvents={replayEvents} />}
            </>
          ) : (
            <div className="session-browser">
              <header className="toolbar session-toolbar"><div><p className="eyebrow">Sessions</p><h2>会话列表</h2><span>{filteredSessions.length} / {sessions.length} 个会话</span></div><div className="toolbar-actions"><input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="搜索会话 / 范围 / 时间" /></div></header>
              {filteredSessions.length ? <section className="session-grid">{filteredSessions.map((item) => <button key={item.id} className="session-browser-card" onClick={() => selectSession(item.id)}><div className="session-browser-head"><span className="kind-pill action">{getScopeLabel(item.scope)}</span><small>{formatDate(item.startTime)}</small></div><strong>{getSessionDisplayName(item)}</strong><p>{formatDuration(item.startTime, item.endTime)}</p><div className="session-browser-stats"><span>{item.tabCount} tabs</span><span>{item.actionCount} actions</span><span>{Math.floor(item.networkCount / 2)} exchanges</span></div></button>)}</section> : <div className="empty-state">没有匹配的会话。先开始一次录制，或调整搜索关键词。</div>}
            </div>
          )}
        </main>
      </div>
      {payloadModal ? <PayloadModal payload={payloadModal} onClose={() => setPayloadModal(null)} /> : null}
    </>
  )
}
