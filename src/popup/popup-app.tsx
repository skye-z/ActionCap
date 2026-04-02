import { useEffect, useState } from 'react'
import { ACTIVE_RECORDING_KEY, createEmptyRecordingStateSnapshot, snapshotFromActiveRecording } from '../common/recording-state'
import type { ActiveRecordingState, RecordingScope, RecordingStateSnapshot, RuntimeResponse } from '../common/types'

const scopes: Array<{ value: RecordingScope; title: string }> = [
  { value: 'current-tab', title: '当前 Tab' },
  { value: 'cross-tab', title: '跨 Tab' },
  { value: 'all-windows', title: '所有窗口' },
]

const emptyState = createEmptyRecordingStateSnapshot()

export function PopupApp() {
  const [scope, setScope] = useState<RecordingScope>('current-tab')
  const [state, setState] = useState<RecordingStateSnapshot>(emptyState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const stored = await chrome.storage.local.get(ACTIVE_RECORDING_KEY)
      const nextState = snapshotFromActiveRecording(stored[ACTIVE_RECORDING_KEY] as ActiveRecordingState | undefined)

      if (!cancelled) {
        setState(nextState)
        if (nextState.scope) {
          setScope(nextState.scope)
        }
      }
    }

    void load()

    const onStorageChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
      if (areaName !== 'local' || !(ACTIVE_RECORDING_KEY in changes)) {
        return
      }

      const nextValue = changes[ACTIVE_RECORDING_KEY]?.newValue as ActiveRecordingState | undefined
      const nextState = snapshotFromActiveRecording(nextValue)
      setState(nextState)
      if (nextState.scope) {
        setScope(nextState.scope)
      }
    }

    chrome.storage.onChanged.addListener(onStorageChange)

    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(onStorageChange)
    }
  }, [])

  useEffect(() => {
    if (!state.active) {
      return
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state.active])

  const durationLabel = (() => {
    if (!state.startTime) {
      return '00:00'
    }

    const diff = Math.max(0, now - state.startTime)
    const minutes = Math.floor(diff / 60_000)
    const seconds = Math.floor((diff % 60_000) / 1_000)
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  })()

  const onStart = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        scope,
      })) as RuntimeResponse

      if (!response.ok) {
        setError(response.error)
        return
      }

      if (response.state) {
        setState(response.state)
        setNow(Date.now())
      }
    } finally {
      setBusy(false)
    }
  }

  const onStop = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'STOP_RECORDING',
      })) as RuntimeResponse

      if (!response.ok) {
        setError(response.error)
        return
      }

      setState(response.state ?? emptyState)
      setNow(Date.now())
    } finally {
      setBusy(false)
    }
  }

  const onOpenSessions = async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') })
    window.close()
  }

  return (
    <div className="popup-shell">
      <div className="noise" />
      <header className="hero">
        <div>
          <p className="eyebrow">ActionCap</p>
          <h1>Browser Forensics</h1>
        </div>
        <div className={`status-chip status-${state.status}`}>{state.active ? 'Recording' : 'Idle'}</div>
      </header>

      <section className="stats-panel">
        <div className="stat">
          <span>时长</span>
          <strong>{durationLabel}</strong>
        </div>
        <div className="stat">
          <span>Tab</span>
          <strong>{state.stats.tabCount}</strong>
        </div>
        <div className="stat">
          <span>操作</span>
          <strong>{state.stats.actionCount}</strong>
        </div>
        <div className="stat">
          <span>网络</span>
          <strong>{state.stats.networkCount}</strong>
        </div>
      </section>

      <section className="scope-panel">
        <div className="section-head">
          <span>录制范围</span>
          <small>{state.active ? '录制中已锁定' : '点击切换'}</small>
        </div>
        <div className="scope-grid">
          {scopes.map((item) => (
            <button
              key={item.value}
              className={`scope-card ${scope === item.value ? 'selected' : ''} ${item.value === 'all-windows' ? 'wide' : ''}`}
              onClick={() => setScope(item.value)}
              disabled={state.active}
            >
              <strong>{item.title}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="action-panel">
        <div className="action-row">
          <button className={`primary ${state.active ? 'danger' : ''}`} onClick={state.active ? onStop : onStart} disabled={busy}>
            {busy ? '处理中...' : state.active ? '结束录制' : '开始录制'}
          </button>
          <button className="secondary" onClick={onOpenSessions} disabled={busy}>
            查看会话
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </div>
  )
}
