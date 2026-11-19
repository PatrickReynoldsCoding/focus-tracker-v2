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

// ---------------- the phone's Today pills ----------------

async function swipe(page, cdp, { from, to, y, steps = 10 }) {
  const pt = (x) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from + ((to - from) * i) / steps) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
}
const selected = (page) => page.$eval('.pl-pill[aria-selected="true"]', (b) => b.textContent.trim());

async function pills(theme) {
  const name = `pills-${theme}`;
  await api.call('DELETE', '/layout/today/pills'); // the default: one pill per panel
  await api.put('/layout/today/view', { focusCard: 'compact', pillCounts: true, pillSwipe: true, pillLast: true });
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name, touch: true, init: theme === 'eink' ? eink : undefined });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.waitForTimeout(400);
  await shot(page, `${name}-start`);
  const names = await page.$$eval('.pl-pill', (els) => els.map((e) => e.textContent.trim()));
  ok(names.length >= 4 && names.some((n) => n.startsWith('To do today')) && names.some((n) => n.startsWith('Shopping')), `${name}: one pill per Today panel (${names.join(' | ')})`);
  ok(!!(await page.$('.pl-page .focus.compact')), `${name}: the focus card is pinned, compact`);
  ok(/To do today\s*1/.test(names[0]), `${name}: pills show counts`);

  // Tap a pill.
  await page.click('.pl-pill:has-text("Habits")');
  await page.waitForTimeout(200);
  ok((await selected(page)).startsWith('Habits') && !!(await page.$('#pl-panels .habits-panel')), `${name}: tapping Habits shows the habits`);
  // Swipe on the panels: the next pill, not the next tab.
  const area = await page.locator('#pl-panels').boundingBox();
  const before = await selected(page);
  await swipe(page, cdp, { from: 320, to: 60, y: area.y + 40 });
  const after = await selected(page);
  ok(after !== before && (await page.evaluate(() => location.hash)) === '#/today', `${name}: a swipe on the panels moves to the next pill (${before} → ${after})`);
  await swipe(page, cdp, { from: 60, to: 320, y: area.y + 40 });
  ok((await selected(page)) === before, `${name}: and back`);
  // A swipe on the focus card still changes tab.
  const fb = await page.locator('.pl-page .focus').boundingBox();
  await swipe(page, cdp, { from: 320, to: 60, y: fb.y + fb.height - 12 });
  ok((await page.evaluate(() => location.hash)) !== '#/today', `${name}: a swipe on the focus card changes tab`);
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  ok((await selected(page)) === before, `${name}: Today opens on the pill used last`);

  // Today settings: a new pill with Habits and a note that is not on Today.
  await page.click('.pl-gear');
  await page.waitForSelector('dialog[open] .pl-settings');
  await shot(page, `${name}-settings`);
  await page.click('dialog[open] button:has-text("New pill")');
  await page.waitForSelector('dialog[open] .pl-editor');
  await page.fill('dialog[open] .pl-editor input', 'Evening');
  await page.click('dialog[open] .pl-icons button[aria-label="🌙"]');
  await page.click('dialog[open] .pl-add-group .chip:has-text("Habits")');
  await page.waitForSelector('dialog[open] .pl-add-group .chip:has-text("Travel")');
  await page.click('dialog[open] .pl-add-group .chip:has-text("Travel")');
  await page.click('dialog[open] .pl-in li:has-text("Travel") button[aria-label^="Move Travel up"]');
  await shot(page, `${name}-editor`);
  await page.click('dialog[open] button:has-text("Add pill")');
  await page.waitForTimeout(500);
  let saved = (await api.get('/layout/today')).pills;
  const evening = saved?.find((p) => p.name === 'Evening');
  ok(evening && evening.icon === '🌙' && evening.panels.length === 2 && evening.panels[0].startsWith('list-'), `${name}: the new pill is saved with its icon and panels in order`);
  ok(saved.length > 4, `${name}: the first change saves every pill (${saved.length})`);
  // Switches and the focus card.
  await page.click('dialog[open] .pl-seg button:has-text("Hidden")');
  await page.click('dialog[open] .pl-switch:has-text("Show counts") input');
  await page.waitForTimeout(400);
  const view = (await api.get('/layout/today')).view;
  ok(view.focusCard === 'hidden' && view.pillCounts === false, `${name}: focus card and counts saved (${JSON.stringify(view)})`);
  // The phone's back button closes the sheet.
  await page.goBack();
  await page.waitForTimeout(300);
  ok(!(await page.$('dialog[open]')), `${name}: the back button closes Today settings`);
  ok((await page.evaluate(() => location.hash)) === '#/today', `${name}: and stays on Today`);
  ok(!(await page.$('.pl-page .focus')), `${name}: the focus card is hidden`);
  // The new pill shows its two panels, the note first.
  await page.click('.pl-pill:has-text("Evening")');
  await page.waitForTimeout(800);
  const cards = await page.$$eval('#pl-panels > *', (els) => els.map((e) => e.textContent.slice(0, 30)));
  ok(cards.length === 2 && cards[0].includes('Travel'), `${name}: the pill shows its panels in order (${cards.join(' | ')})`);
  await shot(page, `${name}-evening`);
  // Delete it with Undo.
  await page.click('.pl-gear');
  await page.click('dialog[open] .pl-card:has-text("Evening") button:has-text("Edit")');
  await page.click('dialog[open] .pl-editor button:has-text("Delete pill")');
  await page.waitForTimeout(500);
  ok(!(await api.get('/layout/today')).pills.some((p) => p.name === 'Evening'), `${name}: Delete pill`);
  await page.click('dialog[open] .pl-notice button:has-text("Undo")');
  await page.waitForTimeout(800);
  ok((await api.get('/layout/today')).pills.some((p) => p.name === 'Evening'), `${name}: Undo brings it back`);
  ok(!!(await page.$('dialog[open] .pl-card:has-text("Evening")')), `${name}: the sheet shows it again`);
  await page.keyboard.press('Escape');
  await api.put('/layout/today/view', { focusCard: 'compact', pillCounts: true, pillSwipe: true, pillLast: true });
  await ctx.close();
}

if (!only || only === 'pills') {
  await pills('light');
  await pills('eink');
}

// ---------------- pop-out windows ----------------

async function popout(theme) {
  const name = `popout-${theme}`;
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name, init: theme === 'eink' ? eink : undefined });
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ft.popout.')).forEach((k) => localStorage.removeItem(k)));
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.lg-item[data-panel="todos"] .po-btn', { state: 'attached' });
  await page.hover('.lg-item[data-panel="todos"]');
  await page.click('.lg-item[data-panel="todos"] .po-btn');
  await page.waitForSelector('.po-win');
  ok(!!(await page.$('.lg-item[data-panel="todos"] .po-placeholder')), `${name}: the page shows a placeholder where the panel was`);
  await page.waitForSelector('.po-win :text("Reply to landlord")', { timeout: 5000 }).catch(() => {});
  ok((await page.textContent('.po-win')).includes('Reply to landlord'), `${name}: the window shows the to-dos`);
  await shot(page, `${name}-window`);
  // Drag it by its title and resize it.
  const w0 = await page.locator('.po-win').boundingBox();
  const head = await page.locator('.po-win .po-title').boundingBox();
  await page.mouse.move(head.x + 20, head.y + 8);
  await page.mouse.down();
  await page.mouse.move(head.x - 300, head.y + 200, { steps: 6 });
  await page.mouse.up();
  const w1 = await page.locator('.po-win').boundingBox();
  ok(Math.abs(w1.x - (w0.x - 320)) < 6 && Math.abs(w1.y - (w0.y + 192)) < 6, `${name}: dragged by its title (${Math.round(w0.x)},${Math.round(w0.y)} → ${Math.round(w1.x)},${Math.round(w1.y)})`);
  const sz = await page.locator('.po-win .po-size').boundingBox();
  await page.mouse.move(sz.x + 8, sz.y + 8);
  await page.mouse.down();
  await page.mouse.move(sz.x + 108, sz.y - 92, { steps: 6 });
  await page.mouse.up();
  const w2 = await page.locator('.po-win').boundingBox();
  ok(w2.width > w1.width + 90 && w2.height < w1.height - 80, `${name}: resized from its corner (${Math.round(w1.width)}×${Math.round(w1.height)} → ${Math.round(w2.width)}×${Math.round(w2.height)})`);
  // It stays on screen on another tab.
  await page.click('.side a:has-text("Habits")');
  await page.waitForTimeout(600);
  ok(!!(await page.$('.po-win')) && (await page.textContent('.po-win')).includes('Reply to landlord'), `${name}: the window stays on the Habits tab`);
  await shot(page, `${name}-other-tab`);
  // Minimise to the dock and back.
  await page.click('.po-win button[aria-label^="Minimise"]');
  ok(!(await page.$('.po-win')) && !!(await page.$('.po-dock .po-chip')), `${name}: minimised to a chip in the dock`);
  await page.click('.po-dock .po-chip');
  ok(!!(await page.$('.po-win')), `${name}: the chip brings it back`);
  // Dock it on the right: the page makes room.
  await page.click('.po-win button[aria-label^="Dock"]');
  await page.waitForTimeout(300);
  const pane = await page.locator('.po-pane').boundingBox();
  const main = await page.locator('.main').boundingBox();
  ok(pane && Math.abs(pane.x + pane.width - 1280) < 2 && main.x + main.width <= pane.x + 2, `${name}: docked as a pane on the right, the page beside it`);
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.lg-item[data-panel="notes"]');
  ok(!!(await page.$('.po-pane')), `${name}: the pane stays on a project page`);
  // One notes editor on screen: pop out the project's notes, then its notes on Today show a placeholder.
  await page.hover('.lg-item[data-panel="notes"]');
  await page.click('.lg-item[data-panel="notes"] .po-btn');
  await page.waitForSelector('.po-win');
  await shot(page, `${name}-project`);
  await api.put('/today-panels/show', { project_id: p1.id, on: true });
  await page.click('.side a:has-text("Today")');
  await page.waitForSelector(`.lg-item[data-panel="pnote-${p1.id}"]`);
  ok(!!(await page.$(`.lg-item[data-panel="pnote-${p1.id}"] .po-placeholder`)), `${name}: the same notes on Today show a placeholder while they are in a window`);
  ok((await page.$$('.po-win .ed, .po-win .md-view, .po-win textarea')).length >= 1, `${name}: the window has the editor`);
  await shot(page, `${name}-one-copy`);
  // Kept after a reload.
  await page.reload();
  await page.waitForSelector('.po-win');
  ok(!!(await page.$('.po-pane')), `${name}: windows and the pane come back after a reload`);
  // No windows on a phone; they come back on a wide screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  ok(!(await page.$('.po-win, .po-pane, .po-btn, .po-placeholder')), `${name}: no windows, buttons or placeholders on a phone`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  ok(!!(await page.$('.po-win')), `${name}: back on a wide screen`);
  // Put everything back.
  for (const b of await page.$$('.po-win button[aria-label^="Put"], .po-pane button[aria-label^="Put"]')) await b.click();
  await page.waitForTimeout(300);
  ok(!(await page.$('.po-win, .po-pane, .po-placeholder')), `${name}: ✕ puts the panels back`);
  await api.put('/today-panels/show', { project_id: p1.id, on: false });
  await ctx.close();
}

if (!only || only === 'popout') {
  await popout('light');
  await popout('eink');
}

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
if (errors.length) process.exit(1);
