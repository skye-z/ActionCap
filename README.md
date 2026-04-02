# ActionCap

Chrome / Edge MV3 extension for recording browser actions, requests, responses, and replay sessions.

## Development

```bash
npm install
npm run build
```

Load the unpacked extension from `dist/` in Chrome or Edge developer mode.

## Current MVP

1. Popup can start and stop recording.
2. Recording scope supports current tab, cross-tab, and all windows.
3. User actions are captured from content scripts.
4. Requests and responses are captured through `chrome.debugger` + CDP `Network`.
5. Results page shows timeline, details, search/filter, JSON export, and rrweb replay.

## Notes

1. Internal browser pages like `chrome://` and `edge://` cannot be recorded.
2. The extension uses the `debugger` permission, so the browser will show a debugging notice while recording.
3. Response bodies are truncated for large payloads and binary payloads are omitted.
