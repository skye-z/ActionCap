import Dexie from 'dexie'
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
