// Browser check for project labels (v0.32.0, flag project-labels): the small label with the
// project's name on file cards and rows (Files grid and list), in Add file, on notes, lists and
// whiteboards on Today and on their own pages, and on Today's to-dos and cards from a project.
// A tap opens the project; files without a project show none; none inside the project's own
// folder; a long name is cut short; one request for the names, not one per label; E-ink has an
// outline; the flag off shows none. Light and E-ink at 1280 and 390 px.
// Needs a seeded server (seed.mjs); it removes what it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/project-labels.mjs
import { mkdirSync } from 'node:fs';
import { apiCtx, B, launch, open, OUT } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const browser = await launch();
const api = await apiCtx(browser);
const errors = [];
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/project-labels-${name}.png` });
const settle = (page) => page.waitForTimeout(700);
const eink = () => localStorage.setItem('ft.theme', 'eink');

await api.put('/features/project-labels', { enabled: true });
const p1 = (await api.get('/projects')).find((p) => p.name === 'Focus Tracker v2');
const LONG = 'A project with a very long name that will not fit on a small label at all';
const long = await api.post('/projects', { name: LONG });
const day = (await api.get('/today')).day;
const note = await api.post('/lists', { name: 'PL design note', kind: 'note', project_id: p1.id });
await api.put(`/notes/of/list/${note.id}`, { body: 'Labels for every file.' });
const loose = await api.post('/lists', { name: 'PL loose note', kind: 'note' });
const todoList = await api.post('/lists', { name: 'PL jobs', kind: 'todo', project_id: long.id });
const todo = await api.post('/todos', { title: 'PL ring the plumber', list_id: todoList.id, day });
const card = await api.post('/tasks', { project_id: p1.id, title: 'PL write the labels', day });
const board = await api.post('/whiteboards', { name: 'PL label sketch', project_id: long.id });
await api.put('/today-panels/show', { list_id: note.id, on: true });
await api.call('PATCH', `/whiteboards/${board.id}`, { show_today: true });
await api.call('DELETE', '/layout/today/pills').catch(() => {});

const labelIn = (page, sel) => page.locator(`${sel} .project-label`);
const noHScroll = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1);

async function run(name, viewport, opts = {}) {
  const { page, ctx } = await open(browser, viewport, errors, { name, touch: opts.touch, init: opts.eink ? eink : undefined });
  const projectRequests = [];
  page.on('request', (r) => /\/api\/projects(\?|$)/.test(new URL(r.url()).pathname + new URL(r.url()).search) && projectRequests.push(r.url()));

  // Files, a type filter (it looks everywhere): the project's note has its label, the loose one none.
  await page.goto(`${B}/#/files?type=notes`);
  await page.waitForSelector('.file-grid, .file-list');
  await page.fill('.files-search', 'PL ');
  await settle(page);
  if (await page.$('.file-list')) await page.click('.files-view-toggle'), await settle(page);
  const card1 = page.locator('.file-card', { hasText: 'PL design note' });
  ok((await card1.locator('.project-label').textContent()) === 'Focus Tracker v2', `${name}: a file card shows its project's label`);
  ok(!(await page.locator('.file-card', { hasText: 'PL loose note' }).locator('.project-label').count()), `${name}: a file without a project shows none`);
  const lb = await card1.locator('.project-label').boundingBox();
  const cb = await card1.boundingBox();
  ok(lb.x >= cb.x && lb.x + lb.width <= cb.x + cb.width + 1, `${name}: the label sits inside the card`);
  const tb = await card1.locator('.file-thumb').boundingBox();
  const nb = await card1.locator('.files-name').boundingBox();
  ok(lb.y >= tb.y + tb.height - 1 && lb.y >= nb.y + nb.height - 1, `${name}: the label is in the card's footer, under the name, not over the preview`);
  ok(await noHScroll(page), `${name}: no sideways scroll on Files`);
  await shot(page, `${name}-files-grid`);
  // The list view too, with the long name cut short.
  await page.click('.files-view-toggle');
  await settle(page);
  await page.fill('.files-search', 'PL label sketch');
  await page.click('.chip:has-text("All")').catch(() => {});
  await settle(page);
  const row = page.locator('.file-row', { hasText: 'PL label sketch' });
  await row.waitFor();
  const cut = await row.locator('.project-label-name').evaluate((e) => e.scrollWidth > e.clientWidth + 1);
  ok(cut, `${name}: a long project name is cut short in a row`);
  ok(await noHScroll(page), `${name}: no sideways scroll in the list`);
  await shot(page, `${name}-files-list`);
  if (opts.eink) ok((await row.locator('.project-label').evaluate((e) => getComputedStyle(e).borderTopWidth)) === '2px', `${name}: E-ink draws the label with an outline`);
  await page.click('.files-view-toggle');

  // Tapping the label opens the project.
  await page.fill('.files-search', 'PL design note');
  await settle(page);
  await page.locator('.file-card', { hasText: 'PL design note' }).locator('.project-label').click();
  await settle(page);
  ok((await page.evaluate(() => location.hash)) === `#/p/${p1.id}`, `${name}: tapping the label opens the project`);

  // Inside the project's own folder there is no label.
  await page.goto(`${B}/#/files/p/${p1.id}`);
  await page.waitForSelector('.file-grid, .file-list');
  await settle(page);
  ok((await page.locator('text=PL design note').count()) > 0 && !(await page.locator('.project-label').count()), `${name}: no labels inside the project's folder`);

  // Today: the note's and the whiteboard's panel headers, the to-do and the card on the Today list.
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.click('.pl-pill:has-text("All")');
  await settle(page);
  ok((await labelIn(page, `[data-panel="list-${note.id}"] h2`).textContent()) === 'Focus Tracker v2', `${name}: a note on Today has its label in the header`);
  ok((await labelIn(page, `[data-panel="wb-${board.id}"] h2`).count()) === 1, `${name}: a whiteboard on Today too`);
  const tl = page.locator('.today-list');
  ok((await tl.locator('.tl-row', { hasText: 'PL ring the plumber' }).locator('.project-label').count()) === 1, `${name}: a to-do from a project's list has its label`);
  const cardRow = tl.locator('.tl-row', { hasText: 'PL write the labels' });
  ok((await cardRow.locator('.project-label').textContent()) === 'Focus Tracker v2' && !(await cardRow.locator('.tl-from').count()), `${name}: a card has its label in place of the plain project name`);
  ok(!(await tl.locator('.tl-row', { hasText: 'Reply to landlord' }).locator('.project-label').count()), `${name}: a to-do without a project has none`);
  ok(await noHScroll(page), `${name}: no sideways scroll on Today`);
  await tl.scrollIntoViewIfNeeded();
  await settle(page);
  await shot(page, `${name}-today`);
  await cardRow.locator('.project-label').click();
  await settle(page);
  ok((await page.evaluate(() => location.hash)) === `#/p/${p1.id}` && !(await page.$('dialog[open]')), `${name}: tapping a card's label opens the project, not the card`);

  // Add file: the label in the picker's rows.
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.click('.pl-pill:has-text("All")');
  await settle(page);
  // (On a phone the button sits under the panels, behind the tab bar until scrolled.)
  await page.locator('.lg-add-panel button').first().evaluate((b) => (b.scrollIntoView({ block: 'center' }), b.click()));
  await page.waitForSelector('dialog[open] .ap-list');
  await page.click('dialog[open] .ap-file');
  await page.waitForSelector('dialog[open] .ap-picker');
  await page.fill('dialog[open] .ap-picker .files-search', 'PL ');
  await settle(page);
  ok((await page.locator('dialog[open] .ap-row', { hasText: 'PL design note' }).locator('.project-label').count()) === 1, `${name}: Add file shows the label`);
  ok(!(await page.locator('dialog[open] .ap-row', { hasText: 'PL loose note' }).locator('.project-label').count()), `${name}: but none on a file without a project`);
  await shot(page, `${name}-picker`);
  await page.keyboard.press('Escape');

  // Their own pages: the note's and the whiteboard's.
  await page.goto(`${B}/#/n/${note.id}`);
  await page.waitForSelector('.page-head h1');
  await settle(page);
  ok((await labelIn(page, '.page-head').textContent()) === 'Focus Tracker v2', `${name}: the note's page has the label`);
  await shot(page, `${name}-note`);
  await page.goto(`${B}/#/n/${todoList.id}`);
  await page.waitForSelector('.page-head h1');
  await settle(page);
  await shot(page, `${name}-list`);
  await page.goto(`${B}/#/n/${note.id}`);
  await page.waitForSelector('.page-head h1');
  await page.goto(`${B}/#/n/${loose.id}`);
  await page.waitForSelector('.page-head h1');
  await settle(page);
  ok(!(await labelIn(page, '.page-head').count()), `${name}: a note without a project has none`);
  await page.goto(`${B}/#/w/${board.id}`);
  await page.waitForSelector('.wb-bar');
  await settle(page);
  ok((await labelIn(page, '.wb-bar').count()) === 1, `${name}: the whiteboard's bar has the label`);
  const tb2 = await page.locator('.wb-bar .wb-title').boundingBox();
  const lb2 = await page.locator('.wb-bar .project-label').boundingBox();
  const tw = await page.locator('.wb-bar .wb-title').evaluate((e) => e.scrollWidth <= e.clientWidth + 1);
  ok(tb2.width >= (viewport.width < 600 ? 150 : 100) || tw, `${name}: the whiteboard's name has room (${Math.round(tb2.width)} px)`);
  ok(viewport.width >= 600 ? lb2.x >= 0 : lb2.y >= tb2.y + tb2.height - 1, `${name}: the whiteboard's label is not squeezing the name`);
  ok(await noHScroll(page), `${name}: no sideways scroll in the whiteboard bar`);
  await shot(page, `${name}-whiteboard`);
  await page.click('.wb-discard').catch(() => {});

  // One request for the names (and one more after each change), never one per label.
  ok(projectRequests.length <= 6, `${name}: names come from the shared projects list (${projectRequests.length} loads)`);
  await ctx.close();
}

try {
  await run('desk', { width: 1280, height: 900 });
  await run('phone', { width: 390, height: 844 }, { touch: true });
  await run('desk-eink', { width: 1280, height: 900 }, { eink: true });
  await run('phone-eink', { width: 390, height: 844 }, { touch: true, eink: true });

  // The flag off: no labels anywhere, the card shows its project's name as before.
  await api.put('/features/project-labels', { enabled: false });
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name: 'off' });
  await page.goto(`${B}/#/files?type=notes`);
  await page.waitForSelector('.file-grid, .file-list');
  await page.fill('.files-search', 'PL ');
  await settle(page);
  ok(!(await page.locator('.project-label').count()), 'off: no labels on Files');
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.click('.pl-pill:has-text("All")');
  await settle(page);
  ok(!(await page.locator('.project-label').count()) && (await page.locator('.tl-row', { hasText: 'PL write the labels' }).locator('.tl-from').textContent()) === 'Focus Tracker v2', 'off: no labels on Today; the card names its project as before');
  await ctx.close();
} finally {
  await api.put('/features/project-labels', { enabled: true });
  await api.call('DELETE', `/tasks/${card.id}`).catch(() => {});
  await api.call('DELETE', `/todos/${todo.id}`).catch(() => {});
  for (const l of [note, loose, todoList]) await api.call('DELETE', `/lists/${l.id}`).catch(() => {});
  await api.call('DELETE', `/whiteboards/${board.id}`).catch(() => {});
  await api.call('DELETE', `/projects/${long.id}`).catch(() => {});
  console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
  await browser.close();
}
if (errors.length) process.exit(1);
