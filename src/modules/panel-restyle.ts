// Panel restyle (D49): the Habits panels (Today, a project's page) drawn as the Today list's slim
// rows, a plain list's panel drawn as the to-do panel without ticks, list titles that open the
// list (settings behind a small ⚙), and dragging items in a to-do's or list's panel. Browser only
// (web/src/features/habits/HabitRows.tsx, board/Compact.tsx, today-panels/ListDialog.tsx); this
// module only declares the flag, so the old panels can come back without a deploy.

import type { Module } from '../core/registry';

export const PANEL_RESTYLE_FLAG = 'panel-restyle';

export const panelRestyleModule: Module = {
  id: 'panel-restyle',
  description: 'Slim Habits panels, a plain list’s panel like a to-do’s, list titles that open the list, and dragging in list panels (browser only; no routes or tools).',
  features: [
    {
      id: PANEL_RESTYLE_FLAG,
      label: 'Slim panels',
      description:
        'The Habits panel shows one slim line per habit, as in the Today list (tap the circle to check in). A plain list’s panel looks like a to-do’s, without ticks. A list’s title on a panel opens the list (⚙ for its settings), and its items can be dragged to reorder or into another group. Off: the older panels.',
      default: true,
    },
  ],
};
