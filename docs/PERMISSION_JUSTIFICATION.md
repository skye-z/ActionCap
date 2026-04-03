# Permission Justification For Edge Add-ons Review

## Summary

ActionCap is a browser debugging and session replay extension. It records user-initiated browser sessions, then displays actions, network traffic, and rrweb replay in a local results page. The permissions below are required for those core capabilities.

## Permissions

| Permission | Why It Is Needed | Scope Limitation |
| --- | --- | --- |
| `storage` | Stores recording state and recorded sessions locally in the browser. | Used only for local persistence. |
| `tabs` | Detects the current tab, tracks tab scope, and opens the local results page after recording stops. | Only used for the tabs included in the selected recording scope. |
| `scripting` | Injects the recorder content script into pages that the user chooses to record. | Injection is used only to capture on-page actions and replay events. |
| `debugger` | Captures request and response details through the browser debugging protocol so the extension can show network metadata and payloads. | Attached only to tabs in the active recording session. |
| `webNavigation` | Detects page navigation during recording. | Used only to keep the session timeline accurate. |
| `<all_urls>` | Allows the extension to work on arbitrary sites because the user can choose any site to inspect. | Internal browser pages and some restricted pages still cannot be recorded. |

## Additional Review Notes

1. Recording is user initiated. ActionCap does not automatically start recording in the background.
2. Data is stored locally and is not uploaded to a remote server.
3. Edge displays the standard debugging banner while recording because the extension uses the `debugger` permission.
4. Users can stop recording immediately and delete local sessions.
