# ActionCap Privacy Policy

Last updated: 2026-04-03

## Overview

ActionCap is a browser extension for Chrome / Edge, used for recording browser actions, network requests, responses, and page replay data for debugging and session analysis.

**Please read this privacy policy carefully before using ActionCap. Understanding what data is recorded and its potential risks is critical to protecting your personal information.**

## Important Warning

> **ActionCap will record ALL data generated during the recording session, including but not limited to: passwords, bank account numbers, credit card information, personal identification numbers, private messages, authentication tokens, cookies, and any other sensitive information that appears in the page content or network traffic.**
>
> **DO NOT export or share recorded session data with anyone unless you fully understand what is contained in the data and completely trust the recipient. Leaking session data may lead to account theft, financial loss, or privacy breaches.**

## What Data Is Collected

When you click "Start Recording", ActionCap will capture the following types of data until you stop the recording:

### User Interaction Data

- Clicks, keyboard inputs, scrolling, text selections
- Form inputs, **including passwords and other sensitive form fields**
- Page navigations, tab switches, window focus changes

### Network Traffic Data

- Full request URLs, methods, and headers (including authentication headers and cookies)
- Request bodies (**including login credentials, payment information, API keys submitted through forms or API calls**)
- Response headers and response bodies
- WebSocket and other network protocol data

### Page Content Data

- Full DOM snapshots and incremental DOM changes (captured via rrweb)
- Page URLs, titles, and visible text content
- **Any sensitive information displayed on the page, such as account balances, transaction records, personal profiles, and private messages**

### Session Metadata

- Recording start and end times, session name
- Tab count, action count, network request count

## How Data Is Stored

1. All recorded data is stored **locally** in the browser using IndexedDB.
2. Data remains on your device until you manually delete it or uninstall the extension.
3. ActionCap **does not** upload any recorded data to remote servers.
4. ActionCap **does not** collect analytics, telemetry, or usage statistics.

## Data Sharing

1. ActionCap **does not** transmit recorded data to the developer or any third party.
2. ActionCap **does not** sell any user data.
3. Data will only leave your device if **you manually export** a session file.

## Regarding Data Export

ActionCap provides the ability to export session data as files. Please be aware:

> **Exported session files may contain all sensitive information recorded during the session, including plaintext passwords, financial data, and authentication credentials.**
>
> - **DO NOT** send exported files to untrusted individuals or organizations.
> - **DO NOT** upload exported files to public file-sharing services, forums, or social media.
> - **DO NOT** attach exported files to emails or messages without knowing exactly what they contain.
> - If you need to share debugging data with others, first review the exported content and remove any sensitive information.

## Permissions Used

ActionCap requires the following browser permissions:

| Permission | Purpose |
|---|---|
| `storage` | Store recording state and session data locally |
| `tabs` | Identify tabs within the recording scope and open the results page |
| `scripting` | Inject the recorder script into pages being recorded |
| `debugger` | Capture network requests and responses via the Chrome DevTools Protocol |
| `webNavigation` | Detect page navigation events during recording |
| `<all_urls>` | Allow recording on any site the user chooses to inspect |

## User Controls

- Choose the recording scope (current tab, cross-tab, or all windows) before starting.
- Stop recording at any time via the popup or the browser debugging banner.
- Delete any recorded session from the results page.
- Export or import session data at your discretion.

## Limitations

1. Internal browser pages (`chrome://`, `edge://`) cannot be recorded.
2. The browser will display a debugging notice bar while recording is active.
3. Very large response bodies may be truncated; binary content may be omitted.

## Children's Privacy

ActionCap is not designed for or marketed to children under 13 years of age.

## Changes to This Policy

This privacy policy may be updated when the extension's data handling practices change. Significant changes will be noted in the extension's update log.