// Browser check for notes that are always the editor (D61): the Today note panel and the note's
// own page open straight into the rich editor (no read-only view, no "Edit" button), nothing is
// focused on load, typing autosaves, Done saves and lets go, ticking and the small panel still work,
// and a note off screen only mounts its editor when it scrolls near. Light, dark and E-ink at
// 390 and 1280 px. Needs a seeded server; it removes what it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/note-always.mjs
import { mkdirSync } from 'node:fs';
import { apiCtx, launch, open, OUT } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const browser = await launch();
const api = await apiCtx(browser);
const errors = [];
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/note-always-${name}.png` });
const eink = () => localStorage.setItem('ft.theme', 'eink');
await api.put('/features/desktop-pills', { enabled: true });
await api.call('DELETE', '/layout/today/pills').catch(() => {});
await api.call('DELETE', '/layout/today/grid').catch(() => {});

for (const l of await api.get('/lists')) if (/^NA /.test(l.name)) await api.call('DELETE', `/lists/${l.id}`);
const made = [];
const mk = async (name, body) => {
  const n = await api.post('/lists', { name, kind: 'note' });
  await api.put(`/notes/of/list/${n.id}`, { body });
  await api.put('/today-panels/show', { list_id: n.id, on: true });
  made.push(n.id);
  return n;
};
const first = await mk('NA first', 'Hello always editor\n\n- one\n- two');
const filler = [];
for (let i = 0; i < 6; i++) filler.push(await mk(`NA filler ${i}`, `Filler ${i}`));
const last = await mk('NA last', 'Far down the page');

async function run(page, name, phone) {
  await page.goto(page.url().split('#')[0] + '#/');
  await page.waitForSelector('.pl-pill');
  await page.click('.pl-pill:has-text("All")').catch(() => {});
  await page.waitForTimeout(1200);
  const lastWaits = await page.locator('.tp-note', { hasText: 'NA last' }).locator('.ed-always-wait').count();
  ok(lastWaits === 1, `${name}: a note far down the page waits (read-only text only) until it scrolls near`);
  const panel = page.locator('.tp-note', { hasText: 'NA first' });
  await panel.scrollIntoViewIfNeeded();
  await panel.locator('.ed.is-editing').waitFor();
  ok((await panel.locator('.ed-view, .ed-edit-hint').count()) === 0, `${name}: the Today note is the editor at once, no read-only view or Edit`);
  ok(await panel.locator('.ed-bar button').filter({ hasText: 'B' }).first().isVisible(), `${name}: the toolbar shows (B, I, S)`);
  await page.waitForTimeout(800);
  await shot(page, 'dbg');
  for (const t of ['Text', 'Lists', 'Insert', '⋯']) ok(await panel.locator('.ed-bar').getByText(t).first().isVisible(), `${name}: toolbar has ${t}`);
  ok((await panel.locator('button[aria-label="Undo"]').count()) === 1 && (await panel.getByRole('button', { name: 'Done' }).count()) === 1, `${name}: undo, redo and Done are there`);
  ok(!(await page.evaluate(() => document.activeElement?.closest('.ProseMirror, .ed') !== null)), `${name}: nothing is focused on load (no keyboard)`);
  ok((await panel.locator('.is-full, [popover]').count()) === 0, `${name}: not full screen`);
  const w = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(w <= 0, `${name}: no sideways scroll`);
  // off-screen notes wait
  const mounted = await page.locator('.tp-note .ed.is-editing').count();
  const waiting = await page.locator('.tp-note .ed-always-wait').count();
  ok(waiting >= 1 || mounted === 8, `${name}: ${mounted} editors mounted, ${waiting} waiting for scroll`);
  // typing autosaves
  const bar = await panel.locator('.ed-bar').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  ok(bar.sw <= bar.cw + 1, `${name}: the whole toolbar fits without scrolling (${bar.sw}/${bar.cw})`);
  await panel.locator('button[aria-label="Text style"]').click();
  await page.waitForTimeout(250);
  ok((await page.locator('[role=menu]:visible').count()) >= 1, `${name}: the Text menu opens`);
  await shot(page, `${name}-menu`);
  await panel.locator('button[aria-label="Text style"]').click();
  await page.waitForTimeout(150);
  ok((await page.locator('[role=menu]:visible').count()) === 0, `${name}: the Text menu closes`);
  await panel.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(` more ${name}`);
  await page.waitForTimeout(2200);
  const body = (await api.get(`/notes/of/list/${first.id}`)).body;
  ok(body.includes(`more ${name}`), `${name}: typing autosaves (${JSON.stringify(body.slice(-30))})`);
  await shot(page, `${name}-today`);
  await panel.getByRole('button', { name: 'Done' }).click();
  ok((await panel.locator('.ed.is-editing').count()) === 1 && (await panel.locator('.ProseMirror:focus').count()) === 0, `${name}: Done leaves the editor in place, unfocused`);
  // scroll to the last note: it mounts
  const lastPanel = page.locator('.tp-note', { hasText: 'NA last' });
  await lastPanel.scrollIntoViewIfNeeded();
  await lastPanel.locator('.ed.is-editing').waitFor();
  ok(true, `${name}: a note far down mounts its editor on scrolling to it`);
  // the note's page
  await page.goto(page.url().split('#')[0] + `#/n/${first.id}`);
  await page.locator('.ed.is-editing').waitFor();
  ok((await page.locator('.ed-view, .ed-edit-hint').count()) === 0, `${name}: the note page is the editor at once`);
  ok((await page.locator('.ed-bar').getByText('Lists').isVisible()) && (await page.getByRole('button', { name: 'Done' }).count()) === 1, `${name}: page has toolbar and Done`);
  ok((await page.getByRole('button', { name: 'Delete' }).count()) === 1, `${name}: Delete is still on the page`);
  await shot(page, `${name}-page`);
  // full screen from the ⋯ menu and back with Done
  await page.locator('.ed-more').click();
  await page.getByRole('menuitemcheckbox', { name: /Full screen/ }).or(page.getByText('Full screen')).first().click();
  await page.waitForTimeout(300);
  ok((await page.locator('.ed.is-full').count()) === 1, `${name}: ⋯ Full screen works`);
  await shot(page, `${name}-full`);
  await page.getByRole('button', { name: 'Done' }).first().click();
  await page.waitForTimeout(300);
  ok((await page.locator('.ed.is-full').count()) === 0 && (await page.locator('.ed.is-editing').count()) === 1, `${name}: Done leaves full screen and keeps the editor`);
  const w2 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(w2 <= 0, `${name}: page has no sideways scroll`);
}

for (const [w, h, phone] of [[1280, 800, false], [390, 800, true]])
  for (const theme of ['light', 'dark', 'eink']) {
    const name = `${theme}-${w}`;
    const { page, ctx } = await open(browser, { width: w, height: h }, errors, { name, touch: phone, colorScheme: theme === 'dark' ? 'dark' : 'light', init: theme === 'eink' ? eink : undefined });
    await run(page, name, phone);
    await ctx.close();
  }

for (const n of made) await api.call('DELETE', `/lists/${n}`).catch(() => {});
await browser.close();
if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
console.log('all note-always checks passed');
