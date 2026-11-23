// Browser check for v0.31.0: no "show on Today" switches anywhere (a list's or note's page, a
// project's notes, a whiteboard's options, the Notes tab's Project notes tickbox). What was on Today
// stays there, and ⋯ Remove on a file panel is how it comes off. Desktop 1280 and phone 390.
// Needs a seeded server (seed.mjs); it puts the data it changes back as it was.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/today-switches.mjs
import { mkdirSync } from 'node:fs';
import { apiCtx, B, launch, open, OUT } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const browser = await launch();
const api = await apiCtx(browser);
// This check is about the older grid (and what is drawn in it): free arranging (D65) is off while it runs.
await api.put('/features/free-panels', { enabled: false });
const errors = [];
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/today-switches-${name}.png` });
const settle = (page) => page.waitForTimeout(600);

await api.put('/features/add-panel', { enabled: true });
const lists = await api.get('/lists');
const ideas = lists.find((l) => l.name === 'Ideas');
const shopping = lists.find((l) => l.name === 'Shopping');
const p1 = (await api.get('/projects')).find((p) => p.name === 'Focus Tracker v2');
const board = (await api.get('/whiteboards')).find((b) => b.name === 'Plan sketch');
const before = { ideas: ideas.show_today, shopping: shopping.show_today, board: { show_today: board.show_today, project_id: board.project_id } };

// What the owner had on Today before the switches went: a note, a project's notes and a whiteboard.
await api.put('/today-panels/show', { list_id: ideas.id, on: true });
await api.put('/today-panels/show', { project_id: p1.id, on: true });
await api.call('PATCH', `/whiteboards/${board.id}`, { show_today: true, project_id: p1.id });
await api.call('DELETE', '/layout/today/grid').catch(() => {});
await api.call('DELETE', '/layout/today/pills').catch(() => {});

const noText = async (page, text, msg) => ok(!(await page.locator(`#app :text("${text}")`).count()), msg);

async function run(name, viewport, touch) {
  const { page } = await open(browser, viewport, errors, { name, touch });

  // Today still shows what was on it.
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.click('.pl-pill:has-text("Notes")');
  await settle(page);
  for (const id of [`list-${ideas.id}`, `pnote-${p1.id}`, `wb-${board.id}`]) ok(!!(await page.$(`[data-panel="${id}"]`)), `${name}: ${id} is still on Today`);
  await shot(page, 'today');

  // A note's page: no On Today tickbox.
  await page.goto(`${B}/#/n/${ideas.id}`);
  await page.waitForSelector('.page-head h1');
  await settle(page);
  ok(!(await page.locator('.page-head .meta input[type=checkbox]').count()), `${name}: a note's page has no On Today tickbox`);
  await noText(page, 'On Today', `${name}: and no "On Today" words`);
  await shot(page, `${name}-note`);

  // A to-do list's page too.
  await page.goto(`${B}/#/n/${shopping.id}`);
  await page.waitForSelector('.page-head h1');
  ok(!(await page.locator('.page-head .meta input[type=checkbox]').count()), `${name}: a to-do list's page has no On Today tickbox`);

  // A project's page: no "Show these notes on Today"; its whiteboard's options have no Show on Today.
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.wb-more');
  await settle(page);
  await noText(page, 'Show these notes on Today', `${name}: a project's notes have no Show on Today switch`);
  await shot(page, `${name}-project`);
  await page.click('.wb-more');
  await page.waitForSelector('dialog[open] input');
  await settle(page);
  await shot(page, `${name}-board-options`);
  ok(!(await page.locator('dialog[open] :text("Show on Today")').count()), `${name}: a whiteboard's options have no Show on Today`);
  ok(!(await page.locator('dialog[open] input[type=checkbox]').count()), `${name}: and no tickbox at all`);
  await page.keyboard.press('Escape');
  ok((await api.get(`/whiteboards/${board.id}`)).show_today, `${name}: closing the options leaves the board on Today`);

  // The Files tab: no switch on a file's row or menu.
  await page.goto(`${B}/#/files`);
  await page.waitForSelector('.files');
  await settle(page);
  await noText(page, 'Show on Today', `${name}: the Files tab has no Show on Today`);
}

await run('desk', { width: 1280, height: 900 }, false);
await run('phone', { width: 390, height: 844 }, true);

// ⋯ Remove takes a file panel off Today (desktop, the All pill).
{
  const { page } = await open(browser, { width: 1280, height: 900 }, errors, { name: 'remove' });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.click('.pl-pill:has-text("All")');
  for (const [id, check] of [
    [`wb-${board.id}`, async () => !(await api.get(`/whiteboards/${board.id}`)).show_today],
    [`pnote-${p1.id}`, async () => !(await api.get(`/notes?project_id=${p1.id}`))[0]?.show_today],
  ]) {
    await page.waitForSelector(`.lg-item[data-panel="${id}"]`);
    await page.hover(`.lg-item[data-panel="${id}"]`);
    await page.click(`.lg-item[data-panel="${id}"] .lg-more`);
    await page.click('.files-menu button:has-text("Remove")');
    await page.waitForTimeout(900);
    ok(await check(), `remove: ⋯ Remove takes ${id} off Today`);
    ok(!(await page.$(`.lg-item[data-panel="${id}"]`)), `remove: and off the page`);
  }
  await shot(page, 'removed');
}

// Claude's way still works: show_on_today's REST twin puts the project's notes back.
await api.put('/today-panels/show', { project_id: p1.id, on: true });
ok((await api.get(`/notes?project_id=${p1.id}`))[0]?.show_today, 'the server still puts a file on Today');

// Put things back.
await api.put('/today-panels/show', { project_id: p1.id, on: false });
await api.put('/today-panels/show', { list_id: ideas.id, on: !!before.ideas });
await api.call('PATCH', `/whiteboards/${board.id}`, before.board);
await api.call('DELETE', '/layout/today/grid').catch(() => {});
await api.call('DELETE', '/layout/today/pills').catch(() => {});
await api.put('/features/free-panels', { enabled: true });
await browser.close();
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('today-switches ok');
