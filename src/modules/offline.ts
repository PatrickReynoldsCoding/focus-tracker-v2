// Offline use (V1-GAPS item 45). The work is in the browser (web/src/core/offline.ts and
// web/public/sw.js); the server's part is the `base_updated_at` check on every PATCH
// (src/core/store.ts), which a change queued while offline sends. This module only declares the flag.

import type { Module } from '../core/registry';

export const offlineModule: Module = {
  id: 'offline',
  description: 'Offline use: saved copies of pages on the device, and changes queued while offline.',
  features: [
    {
      id: 'offline',
      label: 'Offline use',
      description:
        'Pages you have opened are kept on this device and shown at once, also with no signal. Changes made offline wait on the device and are sent when the connection returns. Off: every page needs a connection.',
      default: true,
    },
  ],
};
