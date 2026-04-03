import { useEffect, useState } from 'react'
import { applyDocumentLocale, t } from '../common/i18n'
import { ACTIVE_RECORDING_KEY, createEmptyRecordingStateSnapshot, snapshotFromActiveRecording } from '../common/recording-state'
import type { ActiveRecordingState, RecordingScope, RecordingStateSnapshot, RuntimeResponse } from '../common/types'

const scopes: Array<{ value: RecordingScope; titleKey: Parameters<typeof t>[0]; descriptionKey?: Parameters<typeof t>[0]; fullWidth?: boolean }> = [
  { value: 'current-tab', titleKey: 'scope_current_tab', fullWidth: true },
  { value: 'cross-tab', titleKey: 'scope_cross_tab', descriptionKey: 'scope_cross_tab_desc' },
  { value: 'all-windows', titleKey: 'scope_all_windows', descriptionKey: 'scope_all_windows_desc' },
]

const emptyState = createEmptyRecordingStateSnapshot()

export function PopupApp() {
  const [scope, setScope] = useState<RecordingScope>('current-tab')
  const [state, setState] = useState<RecordingStateSnapshot>(emptyState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    applyDocumentLocale()
    document.title = t('popup_title')
  }, [])

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
          <h1>{t('popup_hero_title')}</h1>
        </div>
        <div className={`status-chip status-${state.status}`}>{state.active ? t('status_recording') : t('status_idle')}</div>
      </header>

      <section className="stats-panel">
        <div className="stat">
          <span>{t('stat_duration')}</span>
          <strong>{durationLabel}</strong>
        </div>
        <div className="stat">
          <span>{t('stat_sessions')}</span>
          <strong>{state.stats.tabCount}</strong>
        </div>
        <div className="stat">
          <span>{t('stat_actions')}</span>
          <strong>{state.stats.actionCount}</strong>
        </div>
        <div className="stat">
          <span>{t('stat_network')}</span>
          <strong>{state.stats.networkCount}</strong>
        </div>
      </section>

      <section className="scope-panel">
        <div className="section-head">
          <span>{t('recording_scope')}</span>
          <small>{state.active ? t('recording_locked') : t('click_to_switch')}</small>
        </div>
        <div className="scope-grid">
          {scopes.map((item) => (
            <button
              key={item.value}
              className={`scope-card ${scope === item.value ? 'selected' : ''} ${item.fullWidth ? 'full' : ''}`}
              onClick={() => setScope(item.value)}
              disabled={state.active}
            >
              <strong>{t(item.titleKey)}</strong>
              {item.descriptionKey ? <small>{t(item.descriptionKey)}</small> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="action-panel">
        <div className="action-row">
          <button className={`primary ${state.active ? 'danger' : ''}`} onClick={state.active ? onStop : onStart} disabled={busy}>
            {busy ? t('action_processing') : state.active ? t('action_stop_recording') : t('action_start_recording')}
          </button>
          <button className="secondary" onClick={onOpenSessions} disabled={busy}>
            {t('action_view_sessions')}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </div>
  )
}
