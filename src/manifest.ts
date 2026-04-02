import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'ActionCap',
  version: '0.1.0',
  description: 'Record browser actions, requests, responses, and replay sessions across tabs.',
  action: {
    default_title: 'ActionCap',
    default_popup: 'popup.html',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  permissions: ['storage', 'tabs', 'scripting', 'debugger', 'webNavigation'],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/recorder.ts'],
      run_at: 'document_start',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['results.html'],
      matches: ['<all_urls>'],
    },
  ],
})
