// The Desktop page (DECISIONS D64, flag `desktop-page`): a bare page at /desktop, meant for a window
// that sits behind the others on a computer (docs/desktop-widget-spec.md). It holds any of Today's
// panels and any note, list or whiteboard, kept apart from Today: a file on the Desktop is not put on
// Today, and taking it off one leaves the other alone. Stored per mode like the other layouts:
//   layout.desktop          the grid (as every page's, src/modules/layout.ts)
//   layout.desktop.panels   [<panel id>], in order (null = the usual ones, DESKTOP_USUAL)
// Add panel and Claude's add_panel / remove_panel change the list (src/modules/add-panel.ts).

import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { setSettingWithUndo } from '../core/store';

export const DESKTOP = 'desktop';
export const FLAG = 'desktop-page';
export const DESKTOP_PANELS_MAX = 40;
/** What the Desktop shows until something is added: the focus card and the Today list (or To do today). */
export const DESKTOP_USUAL = ['focus', 'today-list', 'todos'];

const key = `layout.${DESKTOP}.panels`;

export const readDesktopPanels = (ctx: Ctx) => ctx.jsonSetting<string[] | null>(key, null);

/** Save the Desktop's panels (null = back to the usual ones), undoable. */
export async function saveDesktopPanels(ctx: Ctx, panels: string[] | null) {
  if (panels && panels.length > DESKTOP_PANELS_MAX) throw bad(`The Desktop holds at most ${DESKTOP_PANELS_MAX} panels`);
  await setSettingWithUndo(ctx, key, panels ? JSON.stringify(panels) : null);
}

export const desktopModule: Module = {
  id: 'desktop',
  description: 'The Desktop page: a bare page of panels for a window behind the others on a computer.',
  features: [
    {
      id: FLAG,
      label: 'Desktop page',
      description:
        'A page at #/desktop with only panels on it (no side bar or header), for a window that stays behind the others on a computer. It has its own panels and layout: put any Today panel, note, list or whiteboard on it with + Add panel; a file on the Desktop is not put on Today.',
      default: true,
    },
  ],
};
