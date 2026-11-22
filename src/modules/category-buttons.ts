// Category buttons: big coloured buttons above the Projects list that filter it by category
// (browser only: web/src/features/category-buttons/). This module only declares the flag.

import type { Module } from '../core/registry';

export const categoryButtonsModule: Module = {
  id: 'category-buttons',
  description: 'Category buttons on the Projects tab (browser only; no routes or tools).',
  features: [
    {
      id: 'category-buttons',
      label: 'Category buttons',
      description:
        'On the Projects tab, a row of big coloured buttons above the list, one per category with its number of projects, plus All. Tap one to show only that category, tap it again to clear. Off: the Category drop-down.',
      default: false,
    },
  ],
};
