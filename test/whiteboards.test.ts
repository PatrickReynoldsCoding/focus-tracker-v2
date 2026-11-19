import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { statements } from '../src/core/migrate';
import { MAX_SCENE_BYTES } from '../src/modules/whiteboards';
import { apiToken, BASE, call, mcp, tool, toolError } from './helpers';
import migration from '../migrations/0012_whiteboard_scenes.sql';

const THUMB = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

/** A scene like the ones v1 saved: a rectangle, some text, and where the view was. */
function scene(extra: Record<string, unknown> = {}) {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [
      { id: 'r1', type: 'rectangle', x: 10, y: 20, width: 200, height: 100, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', version: 3, versionNonce: 1, seed: 5, isDeleted: false, boundElements: null },
      { id: 't1', type: 'text', x: 30, y: 50, width: 80, height: 25, text: 'Hello', fontSize: 20, version: 2, versionNonce: 2, seed: 6, isDeleted: false },
      { id: 'gone', type: 'ellipse', x: 0, y: 0, width: 5, height: 5, version: 2, seed: 7, isDeleted: true },
    ],
    appState: { viewBackgroundColor: '#ffffff', scrollX: -120.5, scrollY: 44, zoom: { value: 1.5 } },
    files: {},
    ...extra,
  };
}

const flag = (on: boolean) => call('PUT', '/features/whiteboards', { enabled: on });

describe('whiteboards', () => {
  it('lists boards without their drawings and serves the drawing on its own', async () => {
    const p = await call('POST', '/projects', { name: 'Boards project' });
    const w = await call('POST', '/whiteboards', { name: 'Plan', project_id: p.id });
    expect(w.scene).toBeUndefined();
    const saved = await call('PUT', `/whiteboards/${w.id}/scene`, { scene: scene(), thumbnail: THUMB });
    expect(saved.size).toBeGreaterThan(100);
    const list = await call('GET', `/whiteboards?project_id=${p.id}`);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: w.id, name: 'Plan', thumbnail: THUMB });
    expect('scene' in list[0]).toBe(false);
    expect('scene' in (await call('GET', `/whiteboards/${w.id}`))).toBe(false);
    const full = await call('GET', `/projects/${p.id}/full`);
    expect(full.whiteboards[0].thumbnail).toBe(THUMB);
    expect(JSON.stringify(full)).not.toContain('Hello');
    const got = await call('GET', `/whiteboards/${w.id}/scene`);
    expect(got.scene.elements).toHaveLength(3);
    expect(got.scene.appState).toMatchObject({ scrollX: -120.5, scrollY: 44, zoom: { value: 1.5 } });
    // A board with no drawing yet.
    const empty = await call('POST', '/whiteboards', { name: 'Empty' });
    expect((await call('GET', `/whiteboards/${empty.id}/scene`)).scene).toBeNull();
  });

  it('puts the newest saved board first', async () => {
    const a = await call('POST', '/whiteboards', { name: 'Older' });
    await call('POST', '/whiteboards', { name: 'Newer' });
    await new Promise((r) => setTimeout(r, 5));
    await call('PUT', `/whiteboards/${a.id}/scene`, { scene: scene() });
    const list = await call('GET', '/whiteboards?project_id=');
    expect(list[0].id).toBe(a.id);
  });

  it('refuses drawings that are too big, with a clear message, and keeps the old one', async () => {
    const w = await call('POST', '/whiteboards', { name: 'Big' });
    await call('PUT', `/whiteboards/${w.id}/scene`, { scene: scene() });
    const huge = 'x'.repeat(MAX_SCENE_BYTES);
    const res = await SELF.fetch(`${BASE}/api/whiteboards/${w.id}/scene`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${await apiToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: scene({ files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: `data:image/png;base64,${huge}` } } }) }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error).toMatch(/too big to save .*limit is 1\.5 MB/);
    expect((await call('GET', `/whiteboards/${w.id}/scene`)).scene.elements).toHaveLength(3);
    await call('PUT', `/whiteboards/${w.id}/scene`, { scene: { elements: 'no' } }, { expect: 400 });
    await call('PUT', `/whiteboards/${w.id}/scene`, { scene: null }, { expect: 400 });
  });

  it('only takes small image previews', async () => {
    const w = await call('POST', '/whiteboards', { name: 'Thumbs' });
    await call('PATCH', `/whiteboards/${w.id}`, { thumbnail: 'data:image/svg+xml;base64,PHN2Zz4=' }, { expect: 400 });
    await call('PATCH', `/whiteboards/${w.id}`, { thumbnail: '<img src=x onerror=alert(1)>' }, { expect: 400 });
    await call('PUT', `/whiteboards/${w.id}/scene`, { scene: scene(), thumbnail: `data:image/webp;base64,${'A'.repeat(70_000)}` }, { expect: 400 });
    await call('PATCH', `/whiteboards/${w.id}`, { thumbnail: THUMB });
  });

  it('deletes a board with its drawing, and undo brings both back', async () => {
    const p = await call('POST', '/projects', { name: 'Undo boards' });
    const w = await call('POST', '/whiteboards', { name: 'Keep me', project_id: p.id });
    await call('PUT', `/whiteboards/${w.id}/scene`, { scene: scene() });
    await call('DELETE', `/whiteboards/${w.id}`);
    await call('GET', `/whiteboards/${w.id}/scene`, undefined, { expect: 404 });
    expect(await env.DB.prepare('SELECT 1 FROM whiteboard_scenes WHERE id = ?').bind(w.id).first()).toBeNull();
    await call('POST', '/undo');
    expect((await call('GET', `/whiteboards/${w.id}/scene`)).scene.elements).toHaveLength(3);
    // Deleting the project deletes its boards and their drawings too.
    await call('DELETE', `/projects/${p.id}`);
    expect(await env.DB.prepare('SELECT 1 FROM whiteboard_scenes WHERE id = ?').bind(w.id).first()).toBeNull();
    await call('POST', '/undo');
    expect((await call('GET', `/whiteboards/${w.id}/scene`)).scene.elements).toHaveLength(3);
  });

  it('keeps drawings out of the undo history when a board is renamed or moved', async () => {
    const w = await call('POST', '/whiteboards', { name: 'Rename me' });
    await call('PUT', `/whiteboards/${w.id}/scene`, { scene: scene() });
    const p = await call('POST', '/projects', { name: 'Move target' });
    await call('PATCH', `/whiteboards/${w.id}`, { name: 'Renamed', project_id: p.id });
    const row = await env.DB.prepare("SELECT before, after FROM undo WHERE entity = 'whiteboards' AND row_id = ? ORDER BY id DESC LIMIT 1").bind(w.id).first<{ before: string; after: string }>();
    expect(row!.after).toContain('Renamed');
    expect(row!.before + row!.after).not.toContain('Hello');
  });

  it('moves drawings stored in the old column into their own table (migration 0012)', async () => {
    await env.DB.prepare("INSERT INTO whiteboards (id, mode, name, scene, created, updated_at) VALUES ('oldboard1', 'personal', 'Imported', ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')")
      .bind(JSON.stringify(scene()))
      .run();
    await env.DB.prepare("INSERT INTO whiteboards (id, mode, name, created, updated_at) VALUES ('oldboard2', 'personal', 'No drawing', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')").run();
    const [, ...copy] = statements(migration); // the table exists already
    await env.DB.batch(copy.map((s) => env.DB.prepare(s)));
    expect(await env.DB.prepare("SELECT scene FROM whiteboards WHERE id = 'oldboard1'").first('scene')).toBeNull();
    const got = await call('GET', '/whiteboards/oldboard1/scene');
    expect(got.scene.appState.zoom.value).toBe(1.5);
    expect((await call('GET', '/whiteboards/oldboard2/scene')).scene).toBeNull();
  });

  it('gives Claude list_whiteboards, create_whiteboard and get_whiteboard', async () => {
    const p = await call('POST', '/projects', { name: 'Claude draws' });
    const made = await tool('create_whiteboard', {
      name: 'Flow',
      project_id: p.id,
      elements: [
        { type: 'rectangle', id: 'a', x: 0, y: 0, width: 180, height: 80, label: { text: 'Idea' } },
        { type: 'rectangle', id: 'b', x: 300, y: 0, width: 180, height: 80, label: { text: 'Build' } },
        { type: 'arrow', x: 180, y: 40, width: 120, height: 0, start: { id: 'a' }, end: { id: 'b' } },
      ],
    });
    expect(made).toMatchObject({ name: 'Flow', project_id: p.id, elements: 3 });
    const listed = await tool('list_whiteboards', { project_id: p.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: made.id, project: 'Claude draws', has_preview: false });
    expect(listed[0].drawing_size).toBeGreaterThan(50);
    const got = await tool('get_whiteboard', { id: made.id });
    expect(got.elements.map((e: any) => e.type)).toEqual(['rectangle', 'rectangle', 'arrow']);
    expect(got.elements[0]).toEqual({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 180, height: 80, label: { text: 'Idea' } });
    // The web app opens it.
    expect((await call('GET', `/whiteboards/${made.id}/scene`)).scene.elements).toHaveLength(3);
    // Deleted elements are left out; full gives everything else.
    const w = await call('POST', '/whiteboards', { name: 'Imported style' });
    await call('PUT', `/whiteboards/${w.id}/scene`, { scene: scene() });
    const compact = await tool('get_whiteboard', { id: w.id });
    expect(compact.elements.map((e: any) => e.id)).toEqual(['r1', 't1']);
    expect(compact.elements[0].seed).toBeUndefined();
    expect((await tool('get_whiteboard', { id: w.id, full: true })).elements[0].seed).toBe(5);
    expect(await toolError('create_whiteboard', { name: 'Bad', elements: [{ type: 'teapot' }] })).toMatch(/type/);
    // Undo removes a board Claude made, with its drawing.
    const undone = await tool('create_whiteboard', { name: 'Oops', elements: [{ type: 'text', x: 0, y: 0, text: 'x' }] });
    await tool('undo');
    expect(await env.DB.prepare('SELECT 1 FROM whiteboard_scenes WHERE id = ?').bind(undone.id).first()).toBeNull();
    await call('GET', `/whiteboards/${undone.id}`, undefined, { expect: 404 });
  });

  it('hides the tools and the drawing routes while the flag is off', async () => {
    const w = await call('POST', '/whiteboards', { name: 'Flagged' });
    await flag(false);
    try {
      const names = (await mcp<any>('tools/list')).tools.map((t: any) => t.name);
      expect(names).not.toContain('create_whiteboard');
      await call('GET', `/whiteboards/${w.id}/scene`, undefined, { expect: 404 });
    } finally {
      await flag(true);
    }
    expect((await mcp<any>('tools/list')).tools.map((t: any) => t.name)).toContain('get_whiteboard');
  });
});

describe('sticky notes', () => {
  it('can be made by Claude with create_item and only a project and text', async () => {
    const p = await call('POST', '/projects', { name: 'Sticky project' });
    const s = await tool('create_item', { kind: 'stickies', fields: { project_id: p.id, text: 'Call the plumber' } });
    expect(s).toMatchObject({ text: 'Call the plumber', color: 'yellow', opacity: 1, x: 62, y: 16, w: 220, h: 180 });
    const listed = await tool('list_items', { kind: 'stickies', filters: { project_id: p.id } });
    expect(listed).toHaveLength(1);
    await tool('update_item', { kind: 'stickies', id: s.id, fields: { color: 'mint', x: 10.123 } });
    expect(await call('GET', `/stickies/${s.id}`)).toMatchObject({ color: 'mint', x: 10.12 });
  });

  it('refuses unknown colours and places out of range', async () => {
    const p = await call('POST', '/projects', { name: 'Sticky limits' });
    await call('POST', '/stickies', { project_id: p.id, color: 'neon' }, { expect: 400 });
    await call('POST', '/stickies', { project_id: p.id, opacity: 0.1 }, { expect: 400 });
    await call('POST', '/stickies', { project_id: p.id, w: 2000 }, { expect: 400 });
    const s = await call('POST', '/stickies', { project_id: p.id, x: 100, y: 0, w: 120, h: 80, opacity: 0.4, color: 'lavender' });
    await call('PATCH', `/stickies/${s.id}`, { x: 101 }, { expect: 400 });
    await call('DELETE', `/stickies/${s.id}`);
    await call('POST', '/undo');
    expect((await call('GET', `/stickies/${s.id}`)).color).toBe('lavender');
  });
});
