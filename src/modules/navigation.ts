// Moving around the web app. The Back button and the swipe between tabs live in the browser
// (web/src/features/navigation/); this module only declares the flag the swipe reads.

import type { Module } from '../core/registry';

export const navigationModule: Module = {
  id: 'navigation',
  description: 'Back button and swiping between tabs in the web app (browser only; no routes or tools).',
  features: [
    {
      id: 'swipe-tabs',
      label: 'Swipe between tabs',
      description: 'On a phone, swipe left or right on a page to move to the next or previous tab. Ignored over boards, editors, dialogs, whiteboards, sticky notes, sliders and anything that scrolls sideways. Off: tabs change only by tapping.',
      default: true,
    },
  ],
};
