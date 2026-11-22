// Sticky notes floating over a project's page (V1-GAPS 38). Same place rules as v1, so imported
// notes land where they were: x is a percentage of the page's width (so a note keeps its place
// when the window changes), y pixels from the top of the page, w and h pixels.
// Claude adds and changes them with the generic tools (create_item with kind "stickies").

import type { Entity } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { create, remove, update } from '../core/store';

/** Pastels that keep dark text readable (the web app has the shades: features/stickies/colours.ts). */
export const STICKY_COLORS = ['yellow', 'sand', 'peach', 'orange', 'red', 'pink', 'lavender', 'purple', 'blue', 'sky', 'teal', 'mint', 'green', 'lime', 'grey'] as const;
export const STICKY_LIMITS = { opacity: [0.4, 1], x: [0, 100], y: [0, 20000], w: [120, 900], h: [80, 900] } as const;
const MAX_TEXT = 5000;

function check(row: Record<string, unknown>) {
  for (const [k, [lo, hi]] of Object.entries(STICKY_LIMITS)) {
    const v = row[k];
    if (v == null) continue;
    if (typeof v !== 'number' || v < lo || v > hi) throw bad(`${k} must be from ${lo} to ${hi}`);
    row[k] = Math.round(v * 100) / 100;
  }
  if (typeof row.text === 'string' && row.text.length > MAX_TEXT) throw bad(`text can be at most ${MAX_TEXT} characters`);
}

export const stickiesEntity: Entity = {
  name: 'stickies',
  table: 'stickies',
  singular: 'sticky note',
  desc: 'Sticky notes floating on a project’s page, or on Today when project_id is empty (list them with filters {"project_id": null}; mode takes a profile name or id). Only text is needed; a new note goes near the top right.',
  modeScoped: true,
  filters: ['project_id'],
  fields: {
    project_id: { type: 'text', ref: 'projects', cascade: true, desc: 'The project whose page the note floats on; leave empty for a note on Today (the profile’s own)' },
    text: { type: 'text', default: '' },
    color: { type: 'text', enum: STICKY_COLORS, default: 'yellow', desc: `One of ${STICKY_COLORS.join(', ')}` },
    opacity: { type: 'real', default: 1, desc: 'How solid the paper is, 0.4 to 1 (the text stays solid)' },
    x: { type: 'real', default: 62, desc: 'Left edge as a percentage of the page width, 0 to 100' },
    y: { type: 'real', default: 16, desc: 'Top edge in pixels from the top of the page' },
    w: { type: 'real', default: 220, desc: 'Width in pixels, 120 to 900' },
    h: { type: 'real', default: 180, desc: 'Height in pixels, 80 to 900' },
  },
  beforeCreate(_ctx, row) {
    check(row);
  },
  beforeUpdate(_ctx, _before, patch) {
    check(patch);
  },
};

export const stickiesModule: Module = {
  id: 'stickies',
  description: 'Sticky notes on project pages and on Today.',
  entities: [stickiesEntity],
  routes(api) {
    // The generic routes, with readable undo labels.
    api.post('/stickies', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'new sticky note';
      return c.json(await create(ctx, stickiesEntity, await c.req.json()), 201);
    });
    api.patch('/stickies/:id', async (c) => {
      const ctx = c.get('ctx');
      const body = await c.req.json<Record<string, unknown>>();
      ctx.label = 'text' in body ? 'sticky note text' : 'x' in body || 'w' in body ? 'move sticky note' : 'sticky note colour';
      return c.json(await update(ctx, stickiesEntity, c.req.param('id'), body));
    });
    api.delete('/stickies/:id', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'delete sticky note';
      await remove(ctx, stickiesEntity, c.req.param('id'));
      return c.json({ deleted: c.req.param('id') });
    });
  },
  features: [{ id: 'stickies', label: 'Sticky notes', description: 'Floating sticky notes on project pages and on Today (“+ Note” / “＋ Sticky” buttons).', default: true }],
};
