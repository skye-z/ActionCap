import type { RecordingScope, SessionRecord } from './types'

export function getScopeLabel(scope: RecordingScope) {
  switch (scope) {
    case 'current-tab':
      return '?? Tab'
    case 'cross-tab':
      return '? Tab'
    case 'all-windows':
      return '????'
    default:
      return scope
  }
}

function formatForName(ts: number) {
  const date = new Date(ts)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

export function buildSessionName(startTime: number, scope: RecordingScope) {
  return `${getScopeLabel(scope)} ${formatForName(startTime)}`
}

export function getSessionDisplayName(session: Pick<SessionRecord, 'name' | 'startTime' | 'scope'>) {
  const trimmed = session.name?.trim()
  if (trimmed) {
    return trimmed
  }

  return buildSessionName(session.startTime, session.scope)
}
