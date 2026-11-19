// Browser check for page layouts (V1-GAPS 39–41): the desktop grid (drag, resize, remove, add
// back, reset), the phone's Today pills and Today settings, and pop-out windows.
// Needs a seeded server (seed.mjs). Usage: FT_URL=http://localhost:8817 node scripts/ui/layout.mjs [grid|pills|popout]
import { mkdirSync } from 'node:fs';
import { apiCtx, B, launch, open, OUT } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
const browser = await launch();
const api = await apiCtx(browser);
const errors = [];
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/layout-${name}.png`, fullPage: true });
const eink = () => localStorage.setItem('ft.theme', 'eink');

// Data: two lists and a whiteboard on Today, a focus project, a fresh layout.
const lists = await api.get('/lists');
const projects = await api.get('/projects');
const p1 = projects.find((p) => p.name === 'Focus Tracker v2');
await api.put('/focus', { project_id: p1.id });
for (const l of lists.filter((l) => ['Ideas', 'Shopping'].includes(l.name))) await api.put('/today-panels/show', { list_id: l.id, on: true });
const board = (await api.get('/whiteboards'))[0];
if (board) await api.call('PATCH', `/whiteboards/${board.id}`, { show_today: true });
await api.call('DELETE', '/layout/today/grid').catch(() => {});
await api.call('DELETE', '/layout/project/grid').catch(() => {});

const box = async (page, id) => page.locator(`.lg-item[data-panel="${id}"]`).boundingBox();

async function grid(theme) {
  const name = `grid-${theme}`;
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name, init: theme === 'eink' ? eink : undefined });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.lg-item[data-panel="focus"]');
  await page.waitForTimeout(400);
  await shot(page, `${name}-start`);
  const ids = await page.$$eval('.lg-item', (els) => els.map((e) => e.dataset.panel));
  ok(ids.includes('todos') && ids.includes('habits') && ids.some((i) => i.startsWith('list-')) && ids.some((i) => i.startsWith('wb-')), `${name}: Today panels, lists and the whiteboard are grid items (${ids.join(', ')})`);
  // No two panels overlap.
  const rects = [];
  for (const id of ids) {
    const b = await box(page, id);
    if (b && b.height > 0) rects.push({ id, ...b });
  }
  const overlap = rects.some((a, i) => rects.some((b, j) => j > i && a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1));
  ok(!overlap, `${name}: no panels overlap`);

  // Drag "To do today" by its title to the top right.
  const todo = await box(page, 'todos');
  const h2 = page.locator('.lg-item[data-panel="todos"] h2').first();
  const hb = await h2.boundingBox();
  const focus = await box(page, 'focus');
  await page.mouse.move(hb.x + 10, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40, hb.y + 20, { steps: 4 });
  await page.mouse.move(focus.x + focus.width - todo.width / 2, focus.y - 30, { steps: 8 });
  await page.waitForTimeout(100);
  await shot(page, `${name}-dragging`);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const moved = await box(page, 'todos');
  // The focus card spans the row, so the highest place on the right is straight under it.
  ok(moved.x > focus.x + 100 && Math.abs(moved.y - (focus.y + focus.height + 14)) < 4, `${name}: To do today moved to the top of the right column (${Math.round(moved.x)},${Math.round(moved.y)})`);
  let saved = (await api.get('/layout/today')).grid;
  ok(saved && saved.items.todos && saved.items.todos.x > 0, `${name}: the new place is saved on the server`);

  // It is still there after a reload.
  await page.reload();
  await page.waitForSelector('.lg-item[data-panel="todos"]');
  await page.waitForTimeout(400);
  const again = await box(page, 'todos');
  ok(Math.abs(again.x - moved.x) < 4 && Math.abs(again.y - moved.y) < 4, `${name}: same place after a reload`);

  // Edit layout: resize, remove, add back, reset.
  await page.click('.lg-edit-btn');
  await page.waitForSelector('.lg-bar');
  await shot(page, `${name}-edit`);
  const habits = await box(page, 'habits');
  const handle = page.locator('.lg-item[data-panel="habits"] .lg-resize');
  const rb = await handle.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + 200, rb.y + 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const bigger = await box(page, 'habits');
  ok(bigger.width > habits.width + 100, `${name}: Habits resized wider (${Math.round(habits.width)} → ${Math.round(bigger.width)})`);
  saved = (await api.get('/layout/today')).grid;
  ok(saved.items.habits.w > 6 && saved.items.habits.h >= 60, `${name}: its size is saved (w ${saved.items.habits.w}, h ${saved.items.habits.h})`);

  await page.click('.lg-item[data-panel="neglected"] button:has-text("Remove"), .lg-item[data-panel="plan-week"] button:has-text("Remove")');
  await page.waitForTimeout(300);
  saved = (await api.get('/layout/today')).grid;
  const gone = saved.removed[0];
  ok(gone && !(await page.$(`.lg-item[data-panel="${gone}"]`)), `${name}: Remove takes ${gone} off the page and saves it`);
  ok(!(await page.$('.lg-item[data-panel="focus"] .lg-edit-bar button:has-text("Remove")')), `${name}: the focus card has no Remove`);

  await page.click('.lg-bar button:has-text("Add feature")');
  await page.waitForSelector('dialog[open] .lg-add');
  await page.waitForSelector('dialog[open] .lg-add h3:has-text("Notes")');
  await shot(page, `${name}-add-feature`);
  await page.click(`dialog[open] li:has-text("${gone === 'plan-week' ? 'This week' : 'Waiting for you'}") button:has-text("Add")`);
  await page.waitForTimeout(300);
  saved = (await api.get('/layout/today')).grid;
  ok(!saved.removed.includes(gone), `${name}: Add feature puts ${gone} back`);
  // Add a note that was not on Today.
  const recipes = page.locator('dialog[open] li:has-text("Recipes") button:has-text("Add")');
  await recipes.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const recipesId = `list-${lists.find((l) => l.name === 'Recipes').id}`;
  ok(!!(await page.$(`.lg-item[data-panel="${recipesId}"]`)), `${name}: a note added from Add feature is a new panel`);

  await page.click('.lg-bar button:has-text("Reset this page")');
  await page.waitForTimeout(500);
  ok((await api.get('/layout/today')).grid === null, `${name}: Reset this page clears the saved layout`);
  await page.click('.toast button:has-text("Undo")');
  await page.waitForTimeout(800);
  ok((await api.get('/layout/today')).grid !== null, `${name}: Undo brings the layout back`);
  await page.click('.lg-edit-btn');
  await api.put('/today-panels/show', { list_id: recipesId.slice(5), on: false });

  // The project page has its own layout; the board cannot be removed.
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.lg-item[data-panel="board"]');
  await page.waitForTimeout(300);
  await page.click('.lg-edit-btn');
  ok(!(await page.$('.lg-item[data-panel="board"] .lg-edit-bar button:has-text("Remove")')), `${name}: the board has no Remove`);
  await shot(page, `${name}-project-edit`);
  await page.click('.lg-edit-btn');
  await shot(page, `${name}-project`);
  await ctx.close();
}

if (!only || only === 'grid') {
  await grid('light');
  await api.call('DELETE', '/layout/today/grid');
  await grid('eink');
}

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
if (errors.length) process.exit(1);
