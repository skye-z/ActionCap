import Dexie from 'dexie'
import { t } from './i18n'
import type {
  NetworkEvent,
  ReplayEventRecord,
  SessionBundle,
  SessionRecord,
  TrackedTabRecord,
  UserActionEvent,
} from './types'

class ActionCapDB extends Dexie {
  sessions!: Dexie.Table<SessionRecord, string>
  tabs!: Dexie.Table<TrackedTabRecord, string>
  userActions!: Dexie.Table<UserActionEvent, string>
  networkEvents!: Dexie.Table<NetworkEvent, string>
  replayEvents!: Dexie.Table<ReplayEventRecord, string>

  constructor() {
    super('actioncap-db')

    this.version(1).stores({
      sessions: 'id, status, startTime, endTime, scope',
      tabs: 'id, sessionId, tabId, windowId, [sessionId+tabId], firstSeenAt',
      userActions: 'id, sessionId, tabId, ts, type, [sessionId+ts], [sessionId+tabId]',
      networkEvents: 'id, sessionId, tabId, ts, phase, requestId, [sessionId+ts], [sessionId+tabId]',
      replayEvents: 'id, sessionId, tabId, ts, [sessionId+ts], [sessionId+tabId]',
    })

    this.version(2).stores({
      sessions: 'id, name, status, startTime, endTime, scope',
      tabs: 'id, sessionId, tabId, windowId, [sessionId+tabId], firstSeenAt',
      userActions: 'id, sessionId, tabId, ts, type, [sessionId+ts], [sessionId+tabId]',
      networkEvents: 'id, sessionId, tabId, ts, phase, requestId, [sessionId+ts], [sessionId+tabId]',
      replayEvents: 'id, sessionId, tabId, ts, [sessionId+ts], [sessionId+tabId]',
    })
  }
}

export const db = new ActionCapDB()

type SessionArchive = {
  format: 'actioncap-session-archive'
  version: 1
  exportedAt: number
  bundle: SessionBundle
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeSessionBundle(bundle: unknown): SessionBundle {
  const record = isRecord(bundle) ? bundle : {}
  return {
    session: isRecord(record.session) ? (record.session as unknown as SessionRecord) : undefined,
    tabs: Array.isArray(record.tabs) ? (record.tabs as TrackedTabRecord[]) : [],
    userActions: Array.isArray(record.userActions) ? (record.userActions as UserActionEvent[]) : [],
    networkEvents: Array.isArray(record.networkEvents) ? (record.networkEvents as NetworkEvent[]) : [],
    replayEvents: Array.isArray(record.replayEvents) ? (record.replayEvents as ReplayEventRecord[]) : [],
  }
}

function asSessionBundle(payload: unknown): SessionBundle {
  if (isRecord(payload) && 'bundle' in payload && isRecord(payload.bundle)) {
    return normalizeSessionBundle(payload.bundle)
  }
  if (isRecord(payload)) {
    return normalizeSessionBundle(payload)
  }
  throw new Error(t('import_invalid_format'))
}

function getImportedSession(bundle: SessionBundle) {
  const session = bundle.session
  if (!session || !isRecord(session)) {
    throw new Error(t('import_missing_session'))
  }
  return session as SessionRecord
}

function getLatestTimestamp(bundle: SessionBundle, session: SessionRecord) {
  return Math.max(
    session.endTime ?? session.startTime,
    ...bundle.tabs.map((item) => item.lastSeenAt ?? item.firstSeenAt ?? session.startTime),
    ...bundle.userActions.map((item) => item.ts),
    ...bundle.networkEvents.map((item) => item.ts),
    ...bundle.replayEvents.map((item) => item.ts),
  )
}

function buildImportedTabs(bundle: SessionBundle, sessionId: string) {
  const uniqueTabs = new Map<number, TrackedTabRecord>()
  for (const item of bundle.tabs) {
    uniqueTabs.set(item.tabId, {
      ...item,
      id: `${sessionId}:${item.tabId}`,
      sessionId,
    })
  }
  return [...uniqueTabs.values()]
}

export function buildSessionArchive(bundle: SessionBundle): SessionArchive {
  return {
    format: 'actioncap-session-archive',
    version: 1,
    exportedAt: Date.now(),
    bundle,
  }
}

export async function importSessionArchive(payload: unknown) {
  const bundle = asSessionBundle(payload)
  const session = getImportedSession(bundle)
  const importedSessionId = crypto.randomUUID()
  const tabs = buildImportedTabs(bundle, importedSessionId)
  const userActions: UserActionEvent[] = bundle.userActions.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    sessionId: importedSessionId,
  }))
  const networkEvents: NetworkEvent[] = bundle.networkEvents.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    sessionId: importedSessionId,
  }))
  const replayEvents: ReplayEventRecord[] = bundle.replayEvents.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    sessionId: importedSessionId,
  }))
  const latestTimestamp = getLatestTimestamp(bundle, session)
  const firstTab = tabs[0]
  const importedSession: SessionRecord = {
    ...session,
    id: importedSessionId,
    status: 'stopped',
    endTime: latestTimestamp,
    startTabId: firstTab?.tabId ?? session.startTabId,
    startWindowId: firstTab?.windowId ?? session.startWindowId,
    tabCount: tabs.length,
    actionCount: userActions.length,
    networkCount: networkEvents.length,
    replayCount: replayEvents.length,
  }

  await db.transaction('rw', [db.sessions, db.tabs, db.userActions, db.networkEvents, db.replayEvents], async () => {
    await db.sessions.put(importedSession)
    if (tabs.length) await db.tabs.bulkPut(tabs)
    if (userActions.length) await db.userActions.bulkPut(userActions)
    if (networkEvents.length) await db.networkEvents.bulkPut(networkEvents)
    if (replayEvents.length) await db.replayEvents.bulkPut(replayEvents)
  })

  return importedSessionId
}

export async function getSessionBundle(sessionId: string): Promise<SessionBundle> {
  const [session, tabs, userActions, networkEvents, replayEvents] = await Promise.all([
    db.sessions.get(sessionId),
    db.tabs.where('sessionId').equals(sessionId).toArray(),
    db.userActions.where('sessionId').equals(sessionId).sortBy('ts'),
    db.networkEvents.where('sessionId').equals(sessionId).sortBy('ts'),
    db.replayEvents.where('sessionId').equals(sessionId).sortBy('ts'),
  ])

  return { session, tabs, userActions, networkEvents, replayEvents }
}

export async function listSessions() {
  return db.sessions.orderBy('startTime').reverse().toArray()
}
