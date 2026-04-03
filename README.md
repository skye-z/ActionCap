# ActionCap

[中文文档](README_zh.md)

A browser activity recording tool for Edge / Chrome. Captures page network requests and user actions during browsing, with built-in session replay powered by rrweb.

## Features

**Three Recording Scopes**
- **Current Tab** — Record activity in a single tab.
- **Across Tabs** — Record all tabs in the current window.
- **All Windows** — Record all tabs across every browser window.

**Full Network Capture**
- Captures request/response headers and bodies via DevTools Protocol.
- Supports JSON, HTML, XML, form data, and other text-based content types.
- Large payloads are automatically truncated; binary content is filtered.

**User Action Tracking**
- Records clicks, double-clicks, right-clicks, keyboard input, form submissions, scrolling, focus changes, and page navigations.
- Generates stable selectors for each element (`data-testid` > `id` > `name` > `aria-label` > CSS path).

**Session Replay**
- Visual playback of recorded sessions using rrweb.
- Full DOM snapshots with incremental change tracking.

**Timeline & Analysis**
- Unified timeline with network events and user actions displayed chronologically.
- Filter by type: All / Actions / Network / Errors.
- Search across actions, requests, and URLs.
- Detail panel with formatted payload viewer for request and response bodies.

**Session Management**
- Rename, delete, import, and export sessions.
- Sessions are exported as `.bxdac` files (JSON format).
- All data is stored locally in IndexedDB — nothing is uploaded to any server.

**Sensitive Data Handling**
- Fields containing `password`, `token`, `authorization`, `cookie`, `secret`, `phone`, `idcard` are automatically masked.
- Headers with sensitive keys are replaced with `***`.

## Install

### Edge Add-ons (Recommended)

Install directly from the [Microsoft Edge Add-ons Store](https://microsoftedge.microsoft.com/addons/detail/actioncap/dckc1jp4j3).

### Manual Install

1. Download the latest `.zip` from [Releases](https://github.com/skye-z/ActionCap/releases).
2. Unzip the file.
3. Open `edge://extensions` or `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the unzipped folder.

## Usage

1. Click the ActionCap icon in the browser toolbar.
2. Select a recording scope (Current Tab / Across Tabs / All Windows).
3. Click **Start Recording** — the browser will show a debugging notice bar, this is expected.
4. Browse normally. All network requests and user actions are being captured.
5. Click the ActionCap icon again and press **Stop Recording**.
6. Click **View Sessions** to open the results page, review the timeline, inspect request details, or replay the session.

## FAQ

**Why does a "debugging" banner appear when I start recording?**
ActionCap uses the `debugger` permission to capture network traffic via the Chrome DevTools Protocol. The browser displays this banner as a security measure whenever any extension activates the debugger. This is normal and the banner disappears when recording stops.

**Can I record `chrome://` or `edge://` pages?**
No. Browser internal pages do not allow extension script injection. ActionCap can only record regular web pages.

**Where is my data stored?**
All recorded data is stored locally in the browser's IndexedDB. ActionCap does not upload any data to remote servers. Data only leaves your device if you manually export a session.

**Can exported session files contain sensitive information?**
Yes. Exported files may contain passwords, tokens, cookies, and other sensitive data captured during the recording. Do not share exported files with untrusted parties. See the [Privacy Policy](https://github.com/skye-z/ActionCap/blob/main/docs/PRIVACY_POLICY.md) for details.

**Why are some response bodies missing or truncated?**
Response bodies larger than 1 MB are automatically truncated to save storage. Binary content (images, fonts, etc.) is not captured.

**Does ActionCap affect page performance?**
ActionCap has minimal impact during normal recording. However, pages with extremely high request volumes may experience slightly increased memory usage.

## License

[MIT](LICENSE)
