import type { ActiveRecordingState, RecordingStateSnapshot } from './types'

export const ACTIVE_RECORDING_KEY = 'activeRecording'

export function createEmptyRecordingStateSnapshot(): RecordingStateSnapshot {
  return {
    active: false,
    status: 'idle',
    stats: { tabCount: 0, actionCount: 0, networkCount: 0, replayCount: 0 },
    trackedTabIds: [],
  }
}

export function snapshotFromActiveRecording(
  activeRecording: ActiveRecordingState | null | undefined,
): RecordingStateSnapshot {
  if (!activeRecording) {
    return createEmptyRecordingStateSnapshot()
  }

  return {
    active: true,
    status: activeRecording.status,
    sessionId: activeRecording.sessionId,
    scope: activeRecording.scope,
    startTime: activeRecording.startTime,
    stats: activeRecording.stats,
    trackedTabIds: [...activeRecording.trackedTabIds],
  }
}
