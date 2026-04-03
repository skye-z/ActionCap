import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extensionName__',
  short_name: '__MSG_extensionShortName__',
  version: '0.1.0',
  description: '__MSG_extensionDescription__',
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_title: '__MSG_actionDefaultTitle__',
    default_popup: 'popup.html',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
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
