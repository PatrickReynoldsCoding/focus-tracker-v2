// Browser check for page layouts (V1-GAPS 39–41): the desktop grid, straight on the page (drag by
// the title, resize from the corner, the ⋯ menu's Remove, Add panels and Reset; on Today in the All
// pill), Today's pills on a computer (each pill its own grid, Edit pill, New pill, Remove from a
// pill) and on a phone (Today settings, swipes), arranging on a phone (a long press: move, height,
// remove, add back; leaving it), and pop-out windows.
// Needs a seeded server (seed.mjs). Usage: FT_URL=http://localhost:8787 node scripts/ui/layout.mjs [grid|desk-pills|pills|arrange|popout|offline]
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
/** The screen as it is (a full-page shot resizes the window, which closes an open menu). */
const view = (page, name) => page.screenshot({ path: `${OUT}/layout-${name}.png` });
const eink = () => localStorage.setItem('ft.theme', 'eink');

// Data: two lists and a whiteboard on Today, a focus project, a fresh layout.
const lists = await api.get('/lists');
const projects = await api.get('/projects');
const p1 = projects.find((p) => p.name === 'Focus Tracker v2');
await api.put('/focus', { project_id: p1.id });
for (const l of lists.filter((l) => ['Ideas', 'Shopping'].includes(l.name))) await api.put('/today-panels/show', { list_id: l.id, on: true });
for (const l of lists.filter((l) => !['Ideas', 'Shopping', 'To-dos'].includes(l.name))) await api.put('/today-panels/show', { list_id: l.id, on: false });
const board = (await api.get('/whiteboards'))[0];
if (board) await api.call('PATCH', `/whiteboards/${board.id}`, { show_today: true });
await api.call('DELETE', '/layout/today/grid').catch(() => {});
await api.call('DELETE', '/layout/project/grid').catch(() => {});
await api.call('DELETE', '/layout/today/pills').catch(() => {});
for (const id of ['today', 'notes', 'more']) await api.call('DELETE', `/layout/today/grids/${id}`).catch(() => {});
/** Show a pill of Today (by its name). */
const pill = async (page, name) => {
  await page.click(`.pl-pill:has-text("${name}")`);
  await page.waitForTimeout(400);
};

const box = async (page, id) => page.locator(`.lg-item[data-panel="${id}"]`).boundingBox();
const selected = (page) => page.$eval('.pl-pill[aria-selected="true"]', (b) => b.textContent.trim());

async function grid(theme) {
  const name = `grid-${theme}`;
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name, init: theme === 'eink' ? eink : undefined });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await pill(page, 'All');
  await page.waitForSelector('.lg-item[data-panel="today-list"]');
  await page.waitForTimeout(400);
  ok(!(await page.$('.lg-item[data-panel="focus"]')) && !!(await page.$('.pl-page > .focus, .pl-page > .po-slot .focus')), `${name}: the focus card is pinned above the pills, not in the grid`);
  await shot(page, `${name}-start`);
  const ids = await page.$$eval('.lg-item', (els) => els.map((e) => e.dataset.panel));
  ok(ids.includes('today-list') && ids.includes('habits') && ids.some((i) => i.startsWith('list-')) && ids.some((i) => i.startsWith('wb-')), `${name}: Today panels, lists and the whiteboard are grid items (${ids.join(', ')})`);
  // No two panels overlap.
  const rects = [];
  for (const id of ids) {
    const b = await box(page, id);
    if (b && b.height > 0) rects.push({ id, ...b });
  }
  const overlap = rects.some((a, i) => rects.some((b, j) => j > i && a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1));
  ok(!overlap, `${name}: no panels overlap`);

  // Drag the Today list by its title to the top right.
  const todo = await box(page, 'today-list');
  const h2 = page.locator('.lg-item[data-panel="today-list"] h2').first();
  const hb = await h2.boundingBox();
  const gb = await page.locator('.lg-grid').boundingBox();
  await page.mouse.move(hb.x + 10, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40, hb.y + 20, { steps: 4 });
  await page.mouse.move(gb.x + gb.width - todo.width / 2, gb.y - 10, { steps: 8 });
  await page.waitForTimeout(100);
  await shot(page, `${name}-dragging`);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const moved = await box(page, 'today-list');
  ok(moved.x > gb.x + 100 && Math.abs(moved.y - gb.y) < 4, `${name}: the Today list moved to the top of the right column (${Math.round(moved.x)},${Math.round(moved.y)})`);
  let saved = (await api.get('/layout/today')).grid;
  ok(saved && saved.items['today-list'] && saved.items['today-list'].x > 0, `${name}: the new place is saved on the server`);

  // It is still there after a reload.
  await page.reload();
  await page.waitForSelector('.lg-item[data-panel="today-list"]');
  await page.waitForTimeout(400);
  ok((await selected(page)) === 'All', `${name}: Today opens on the pill used last (All)`);
  const again = await box(page, 'today-list');
  ok(Math.abs(again.x - moved.x) < 4 && Math.abs(again.y - moved.y) < 4, `${name}: same place after a reload`);

  // No Edit layout: the handles show on hover only, and are hidden otherwise.
  ok(!(await page.$('.lg-edit-btn, .lg-bar')), `${name}: there is no Edit layout`);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  const hidden = await page.$eval('.lg-item[data-panel="habits"] .lg-more', (b) => getComputedStyle(b).opacity);
  ok(hidden === '0', `${name}: ⋯ and the corner are hidden until a panel is hovered`);
  // Resize from the corner, in normal view.
  const habits = await box(page, 'habits');
  await page.hover('.lg-item[data-panel="habits"]');
  await page.waitForTimeout(250);
  await shot(page, `${name}-hover`);
  const handle = page.locator('.lg-item[data-panel="habits"] .lg-resize');
  const rb = await handle.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + 200, rb.y + 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const bigger = await box(page, 'habits');
  ok(bigger.width > habits.width + 100, `${name}: Habits resized wider from its corner (${Math.round(habits.width)} → ${Math.round(bigger.width)})`);
  saved = (await api.get('/layout/today')).grid;
  ok(saved.items.habits.w > 6 && saved.items.habits.h >= 60, `${name}: its size is saved (w ${saved.items.habits.w}, h ${saved.items.habits.h})`);
  // Text in a panel can still be selected (a press there is not a drag).
  const line = await page.locator('.lg-item[data-panel="habits"] .lg-body').boundingBox();
  await page.mouse.move(line.x + 30, line.y + line.height - 30);
  await page.mouse.down();
  await page.mouse.move(line.x + 200, line.y + line.height - 28, { steps: 4 });
  await page.mouse.up();
  ok(!(await page.$('.lg-moving')) && Math.abs((await box(page, 'habits')).x - bigger.x) < 2, `${name}: a press inside a panel's content does not move it`);

  // ⋯: Auto height, Remove, Add panels, Reset.
  const menu = async (id) => {
    await page.hover(`.lg-item[data-panel="${id}"]`);
    await page.click(`.lg-item[data-panel="${id}"] .lg-more`);
    await page.waitForSelector('.files-menu[role="menu"]');
  };
  await menu('habits');
  await view(page, `${name}-menu`);
  ok((await page.textContent('.files-menu')).includes('Pop out'), `${name}: the ⋯ menu has Pop out`);
  await page.click('.files-menu button:has-text("Auto height")');
  await page.waitForTimeout(400);
  ok(!(await api.get('/layout/today')).grid.items.habits.h, `${name}: Auto height goes back to following the content`);
  const gone = (await page.$('.lg-item[data-panel="neglected"]')) ? 'neglected' : 'plan-week';
  await menu(gone);
  await page.click('.files-menu button:has-text("Remove from Today")');
  await page.waitForTimeout(300);
  saved = (await api.get('/layout/today')).grid;
  ok(saved.removed.includes(gone) && !(await page.$(`.lg-item[data-panel="${gone}"]`)), `${name}: ⋯ Remove takes ${gone} off the page and saves it`);

  await menu('habits');
  await page.click('.files-menu button:has-text("Add panels")');
  await page.waitForSelector('dialog[open] .lg-add');
  await page.waitForSelector('dialog[open] .lg-add h3:has-text("Notes")');
  await shot(page, `${name}-add-panels`);
  await page.click(`dialog[open] li:has-text("${gone === 'plan-week' ? 'This week' : 'Waiting for you'}") button:has-text("Add")`);
  await page.waitForTimeout(300);
  saved = (await api.get('/layout/today')).grid;
  ok(!saved.removed.includes(gone), `${name}: Add panels puts ${gone} back`);
  // Add a note that was not on Today.
  const recipes = page.locator('dialog[open] li:has-text("Recipes") button:has-text("Add")');
  await recipes.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const recipesId = `list-${lists.find((l) => l.name === 'Recipes').id}`;
  ok(!!(await page.$(`.lg-item[data-panel="${recipesId}"]`)), `${name}: a note added from Add panels is a new panel`);

  await menu('habits');
  await page.click('.files-menu button:has-text("Reset this page")');
  await page.waitForTimeout(500);
  ok((await api.get('/layout/today')).grid === null, `${name}: Reset this page’s layout clears the saved layout`);
  await page.click('.toast button:has-text("Undo")');
  await page.waitForTimeout(800);
  ok((await api.get('/layout/today')).grid !== null, `${name}: Undo brings the layout back`);
  await api.put('/today-panels/show', { list_id: recipesId.slice(5), on: false });

  // The project page has its own layout; the board cannot be removed.
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.lg-item[data-panel="board"]');
  await page.waitForTimeout(300);
  await menu('board');
  ok(!(await page.$('.files-menu button:has-text("Remove")')), `${name}: the board has no Remove`);
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await shot(page, `${name}-project`);
  await ctx.close();
}

if (!only || only === 'grid') {
  await grid('light');
  await api.call('DELETE', '/layout/today/grid');
  await grid('eink');
}

// ---------------- Today's pills on a computer ----------------

async function deskPills(theme) {
  const name = `desk-pills-${theme}`;
  await api.call('DELETE', '/layout/today/pills');
  for (const id of ['today', 'notes', 'more']) await api.call('DELETE', `/layout/today/grids/${id}`).catch(() => {});
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name, init: theme === 'eink' ? eink : undefined });
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ft.pills.')).forEach((k) => localStorage.removeItem(k)));
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.waitForSelector('.lg-item[data-panel="today-list"]');
  await page.waitForTimeout(500);
  await shot(page, `${name}-start`);
  const names = await page.$$eval('.pl-pill', (els) => els.map((e) => e.textContent.trim()));
  ok(names.length === 3 && names[0].startsWith('🎯Today') && names[1].startsWith('📚Notes') && names[2] === 'All', `${name}: the usual pills, not one per panel (${names.join(' | ')})`);
  let ids = await page.$$eval('.lg-item', (els) => els.map((e) => e.dataset.panel));
  ok(ids.join() === 'today-list,plan-week', `${name}: the Today pill holds the Today list and this week (${ids.join(', ')})`);
  ok(!!(await page.$('.pl-page > .focus, .pl-page > .po-slot .focus')), `${name}: the focus card is pinned above the pills`);

  // Each pill has its own grid: a move in the Today pill leaves the All pill's layout alone.
  const pageGrid = JSON.stringify((await api.get('/layout/today')).grid);
  const gb = await page.locator('.lg-grid').boundingBox();
  const hb = await page.locator('.lg-item[data-panel="plan-week"] h2').first().boundingBox();
  const pw = await box(page, 'plan-week');
  await page.mouse.move(hb.x + 10, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40, hb.y + 20, { steps: 4 });
  await page.mouse.move(gb.x + 40, gb.y - 10, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const moved = await box(page, 'plan-week');
  // (It starts at the top of the right column, beside the Today list: it moves to the top left.)
  ok(Math.abs(moved.y - gb.y) < 4 && (moved.y < pw.y || moved.x < pw.x - 100), `${name}: This week moved to the top left of the Today pill`);
  let saved = await api.get('/layout/today');
  ok(saved.grids?.today?.items['plan-week'] && JSON.stringify(saved.grid) === pageGrid, `${name}: saved as the pill's own grid, not the page's`);
  await pill(page, 'All');
  ok(!(await page.$('.lg-item[data-panel="focus"]')) && (await page.$$('.lg-item')).length > 4, `${name}: All shows every panel on Today`);
  await pill(page, 'Notes');
  ids = await page.$$eval('.lg-item', (els) => els.map((e) => e.dataset.panel));
  ok(ids.length >= 2 && ids.every((i) => /^(list|wb|pnote)-/.test(i)), `${name}: Notes holds the notes, lists and whiteboards (${ids.join(', ')})`);
  await shot(page, `${name}-notes`);

  // + New pill, from the row: a name, an icon, two panels; it is shown at once.
  await page.click('.pl-bar button:has-text("New pill")');
  await page.waitForSelector('dialog[open] .pl-editor');
  await page.fill('dialog[open] .pl-editor input', 'Deep work');
  await page.click('dialog[open] .pl-icons button[aria-label="🧠"]');
  await page.click('dialog[open] .pl-add-group .chip:has-text("Habits")');
  await page.waitForSelector('dialog[open] .pl-add-group .chip:has-text("Travel")');
  await page.click('dialog[open] .pl-add-group .chip:has-text("Travel")');
  await shot(page, `${name}-new-pill`);
  await page.click('dialog[open] button:has-text("Add pill")');
  await page.waitForTimeout(800);
  saved = await api.get('/layout/today');
  const deep = saved.pills?.find((p) => p.name === 'Deep work');
  ok(deep && deep.icon === '🧠' && deep.panels[0] === 'habits' && ['today', 'notes'].every((id) => saved.pills.some((p) => p.id === id)), `${name}: the new pill is saved with the usual ones (${saved.pills?.map((p) => p.name).join(', ')})`);
  ok((await selected(page)).includes('Deep work'), `${name}: and shown`);
  ids = await page.$$eval('.lg-item', (els) => els.map((e) => e.dataset.panel));
  ok(ids.length === 2 && ids[0] === 'habits', `${name}: with its two panels, a note not on Today too (${ids.join(', ')})`);

  // ✎ Edit pill: rename, and ▲ puts the note first.
  await page.click('.pl-bar button:has-text("Edit pill")');
  await page.waitForSelector('dialog[open] .pl-editor');
  await page.fill('dialog[open] .pl-editor input', 'Thinking');
  await page.click('dialog[open] .pl-in li:has-text("Travel") button[aria-label^="Move Travel up"]');
  await page.click('dialog[open] button:has-text("Save")');
  await page.waitForTimeout(800);
  saved = await api.get('/layout/today');
  const thinking = saved.pills.find((p) => p.id === deep.id);
  ok(thinking.name === 'Thinking' && thinking.panels[0].startsWith('list-'), `${name}: Edit pill renames it and changes the order`);
  const first = await page.$eval('.lg-item', (e) => e.dataset.panel);
  ok(first.startsWith('list-'), `${name}: the note is first on screen`);

  // Inside a pill, ⋯ Remove takes the panel out of the pill (with Undo).
  await page.hover('.lg-item[data-panel="habits"]');
  await page.click('.lg-item[data-panel="habits"] .lg-more');
  await page.waitForSelector('.files-menu[role="menu"]');
  ok((await page.textContent('.files-menu')).includes('Reset this pill’s layout'), `${name}: the ⋯ menu resets the pill’s layout`);
  await view(page, `${name}-menu`);
  await page.click('.files-menu button:has-text("Remove from this pill")');
  await page.waitForTimeout(500);
  saved = await api.get('/layout/today');
  ok(!saved.pills.find((p) => p.id === deep.id).panels.includes('habits') && !saved.grid?.removed?.includes('habits'), `${name}: Remove takes Habits out of the pill only`);
  await page.click('.toast button:has-text("Undo")');
  await page.waitForTimeout(800);
  ok((await api.get('/layout/today')).pills.find((p) => p.id === deep.id).panels.includes('habits'), `${name}: Undo puts it back in the pill`);

  // Delete the pill from its sheet; Undo from the message.
  await page.click('.pl-bar button:has-text("Edit pill")');
  await page.click('dialog[open] .pl-editor button:has-text("Delete pill")');
  await page.waitForTimeout(600);
  ok(!(await api.get('/layout/today')).pills.some((p) => p.id === deep.id), `${name}: Delete pill`);
  await page.click('.toast button:has-text("Undo")');
  await page.waitForTimeout(800);
  ok((await api.get('/layout/today')).pills.some((p) => p.id === deep.id), `${name}: Undo brings it back`);

  // Today settings on a computer: the All switch hides the All pill.
  await page.click('.pl-gear');
  await page.waitForSelector('dialog[open] .pl-settings');
  await shot(page, `${name}-settings`);
  await page.click('dialog[open] .pl-switch:has-text("Show the All pill") input');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok(!(await page.$('.pl-pill:text-is("All")')) && (await api.get('/layout/today')).view.pillAll === false, `${name}: the All pill can be hidden`);
  await api.put('/layout/today/view', { pillAll: true });
  await ctx.close();
}

if (!only || only === 'desk-pills') {
  await deskPills('light');
  await deskPills('eink');
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

async function pills(theme) {
  const name = `pills-${theme}`;
  await api.call('DELETE', '/layout/today/pills'); // the usual pills
  await api.put('/layout/today/view', { focusCard: 'compact', pillCounts: true, pillSwipe: true, pillLast: true });
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name, touch: true, init: theme === 'eink' ? eink : undefined });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.waitForTimeout(400);
  await shot(page, `${name}-start`);
  const names = await page.$$eval('.pl-pill', (els) => els.map((e) => e.textContent.trim()));
  ok(names.length === 3 && names[0].includes('Today') && names[1].includes('Notes') && names[2] === 'All', `${name}: the usual pills, the same as on a computer (${names.join(' | ')})`);
  ok(!!(await page.$('.pl-page .focus.compact')), `${name}: the focus card is pinned, compact`);
  ok(/Today\s*\d/.test(names[0]), `${name}: pills show counts`);
  ok(!!(await page.$('#pl-panels .today-list')) && !(await page.$('#pl-panels .habits-panel')) && !(await page.$('#pl-panels .tp-list')), `${name}: the Today pill stacks the Today list and this week`);

  // Tap a pill.
  await page.click('.pl-pill:has-text("Notes")');
  await page.waitForTimeout(400);
  ok((await selected(page)).includes('Notes') && !!(await page.$('#pl-panels .tp-list')) && !(await page.$('#pl-panels .today-list')), `${name}: tapping Notes shows the notes and lists`);
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
  ok(saved.length >= 3 && saved[0].id === 'today', `${name}: the first change saves every pill (${saved.map((p) => p.name).join(', ')})`);
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
  const cards = await page.$$eval('#pl-panels .lg-row', (els) => els.map((e) => e.textContent.slice(0, 30)));
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

// ---------------- arranging on a phone: a long press ----------------

const touch = (cdp) => ({
  down: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }),
  move: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }),
  up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
});
/** Press and hold at a point (a finger that does not move). */
async function hold(page, cdp, x, y, ms = 700) {
  const t = touch(cdp);
  await t.down(x, y);
  await page.waitForTimeout(ms);
  await t.up();
  await page.waitForTimeout(300);
}
/** Drag with a finger from one point to another, in steps. */
async function fingerDrag(page, cdp, from, to, steps = 12) {
  const t = touch(cdp);
  await t.down(from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    await t.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(100);
  await t.up();
  await page.waitForTimeout(500);
}
const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const rowIds = (page) => page.$$eval('#pl-panels .lg-row, .project .lg-row', (els) => els.map((e) => e.dataset.panel));

async function arrange(theme) {
  const name = `arrange-${theme}`;
  await api.call('DELETE', '/layout/today/pills');
  await api.call('DELETE', '/layout/today/grid').catch(() => {});
  for (const id of ['today', 'notes', 'more']) await api.call('DELETE', `/layout/today/grids/${id}`).catch(() => {});
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name, touch: true, init: theme === 'eink' ? eink : undefined });
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ft.pills.')).forEach((k) => localStorage.removeItem(k)));
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('#pl-panels .lg-row[data-panel="today-list"]');
  await page.waitForTimeout(500);
  ok(!(await page.$('.lg-arr, .lg-grip, .lg-more')), `${name}: no handles on a phone until a long press`);
  ok((await rowIds(page)).join() === 'today-list,plan-week', `${name}: the Today pill stacks the Today list, then this week`);

  // A hold in a field does nothing; a finger that moves (a scroll) does nothing.
  const input = await page.locator('#pl-panels .lg-row[data-panel="today-list"] input').first().boundingBox();
  if (input) {
    await hold(page, cdp, input.x + 20, input.y + input.height / 2);
    ok(!(await page.$('.lg-arranging')), `${name}: a hold in a text field does not arrange`);
    await page.evaluate(() => document.activeElement?.blur());
  }
  const title = await page.locator('#pl-panels .lg-row[data-panel="plan-week"] h2').first().boundingBox();
  const t = touch(cdp);
  await t.down(title.x + 20, title.y + 8);
  await page.waitForTimeout(150);
  await t.move(title.x + 20, title.y + 60);
  await page.waitForTimeout(600);
  await t.up();
  await page.waitForTimeout(300);
  ok(!(await page.$('.lg-arranging')), `${name}: a press that scrolls does not arrange`);

  // A hold on a to-do arranges, and does not tick it.
  const todo = page.locator('#pl-panels .lg-row[data-panel="today-list"] :text("Reply to landlord")').first();
  const tb = await todo.boundingBox();
  await hold(page, cdp, tb.x + 10, tb.y + tb.height / 2);
  ok(!!(await page.$('.lg-arranging')) && (await page.$$('.lg-arr')).length === 2, `${name}: a long press on a panel shows move and size handles on every panel`);
  ok(!!(await page.$('#pl-panels .lg-row[data-panel="today-list"] :text("Reply to landlord")')), `${name}: and the to-do under the finger is not ticked`);
  ok((await page.textContent('.lg-arr-bar')).includes('Today'), `${name}: the Arrange bar says which pill`);
  await page.waitForTimeout(300);
  await shot(page, `${name}-on`);

  // Drag This week above the Today list by its bar: up to the top of the screen, which scrolls the page.
  await page.locator('.lg-row[data-panel="plan-week"] .lg-arr-head').scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, 200));
  await page.waitForTimeout(200);
  const head = await page.locator('.lg-row[data-panel="plan-week"] .lg-arr-head').boundingBox();
  {
    const f = touch(cdp);
    const x = head.x + head.width / 2;
    await f.down(x, head.y + head.height / 2);
    for (let i = 1; i <= 12; i++) {
      await f.move(x, head.y + head.height / 2 + ((60 - head.y - head.height / 2) * i) / 12);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(1500); // the page scrolls up while the finger waits near the top
    ok((await page.evaluate(() => scrollY)) === 0, `${name}: holding a panel near the top scrolls the page up`);
    await f.up();
    await page.waitForTimeout(500);
  }
  ok((await rowIds(page)).join() === 'plan-week,today-list', `${name}: This week moved to the top (${(await rowIds(page)).join(', ')})`);
  let g = (await api.get('/layout/today')).grids?.today;
  ok(g && g.items['plan-week'].y < g.items['today-list'].y, `${name}: the new order is the pill’s grid order, saved on the server`);
  ok(g.items['plan-week'].x + g.items['plan-week'].w <= 12 && g.items['today-list'].w >= 1, `${name}: with desktop columns for both panels`);
  ok(!!(await page.$('.lg-arranging')), `${name}: still arranging after a move`);

  // The height: drag the bottom handle up; Auto height puts it back.
  await page.locator('.lg-row[data-panel="today-list"] .lg-arr-size').scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, 150));
  await page.waitForTimeout(200);
  const before = (await page.locator('.lg-row[data-panel="today-list"]').boundingBox()).height;
  const size = centre(await page.locator('.lg-row[data-panel="today-list"] .lg-arr-size').boundingBox());
  await fingerDrag(page, cdp, size, { x: size.x, y: size.y - 120 });
  const after = (await page.locator('.lg-row[data-panel="today-list"]').boundingBox()).height;
  g = (await api.get('/layout/today')).grids.today;
  ok(after < before - 80 && Math.abs(after - g.items['today-list'].ph) < 2 && !g.items['today-list'].h, `${name}: the bottom handle sets the phone height (${Math.round(before)} → ${Math.round(after)}, ph ${g.items['today-list'].ph}), not the computer’s`);
  await shot(page, `${name}-height`);
  await page.click('.lg-row[data-panel="today-list"] .lg-arr-acts button:has-text("Auto height")');
  await page.waitForTimeout(500);
  ok(!(await api.get('/layout/today')).grids.today.items['today-list'].ph, `${name}: Auto height`);

  // Back leaves it, and stays on Today.
  await page.goBack();
  await page.waitForTimeout(400);
  ok(!(await page.$('.lg-arranging, .lg-arr')) && (await page.evaluate(() => location.hash)) === '#/today', `${name}: Back leaves arranging and stays on Today`);
  ok((await rowIds(page)).join() === 'plan-week,today-list', `${name}: the order stays after arranging`);

  // A tap outside leaves it; a swipe on the panels changes pill again afterwards.
  const t2 = await page.locator('.lg-row[data-panel="plan-week"] h2').first().boundingBox();
  await hold(page, cdp, t2.x + 20, t2.y + 8);
  ok(!!(await page.$('.lg-arranging')), `${name}: a long press on a title arranges`);
  await page.tap('.pl-page .focus');
  await page.waitForTimeout(300);
  ok(!(await page.$('.lg-arranging')), `${name}: a tap outside the panels leaves it`);

  // In the All pill: Remove, then + Add panels in the bar brings it back; Done.
  await pill(page, 'All');
  await page.waitForSelector('#pl-panels .lg-row[data-panel="habits"]');
  const hb = await page.locator('#pl-panels .lg-row[data-panel="habits"] h2').first().boundingBox();
  await hold(page, cdp, hb.x + 20, hb.y + 8);
  await page.click('.lg-row[data-panel="habits"] .lg-arr-acts button:has-text("Remove")');
  await page.waitForTimeout(500);
  ok((await api.get('/layout/today')).grid.removed.includes('habits') && !(await page.$('.lg-row[data-panel="habits"]')), `${name}: Remove takes Habits off Today`);
  ok(!!(await page.$('.lg-arranging')), `${name}: still arranging after Remove`);
  await page.click('.lg-arr-bar button:has-text("Add panels")');
  await page.waitForSelector('dialog[open] .lg-add');
  await page.click('dialog[open] li:has-text("Habits") button:has-text("Add")');
  await page.waitForTimeout(400);
  await page.goBack();
  await page.waitForTimeout(400);
  ok(!(await page.$('dialog[open]')) && !!(await page.$('.lg-arranging')), `${name}: Back closes Add panels, still arranging`);
  ok(!(await api.get('/layout/today')).grid.removed.includes('habits'), `${name}: Add panels brings Habits back`);
  await shot(page, `${name}-all`);
  await page.click('.lg-arr-done');
  await page.waitForTimeout(300);
  ok(!(await page.$('.lg-arranging')), `${name}: Done leaves it`);
  ok((await page.evaluate(() => history.state?.arrange)) !== true, `${name}: and leaves no step in the Back history`);

  // The project page: the same.
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.project .lg-row[data-panel="board"]');
  await page.waitForTimeout(400);
  const ids = await rowIds(page);
  // The last panel with a title.
  const last = await page.$$eval('.project .lg-row', (els) => els.filter((e) => e.querySelector('h2')).pop().dataset.panel);
  await page.locator(`.project .lg-row[data-panel="${last}"] h2`).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const lh = await page.locator(`.project .lg-row[data-panel="${last}"] h2`).first().boundingBox();
  await hold(page, cdp, lh.x + 20, lh.y + 8);
  ok(!!(await page.$('.project .lg-arranging')), `${name}: a long press arranges the project page`);
  ok(!(await page.$('.lg-row[data-panel="board"] .lg-arr-acts button:has-text("Remove")')), `${name}: the board has no Remove`);
  await shot(page, `${name}-project`);
  // Keyboard on the bar's ⠿: up one.
  await page.focus(`.lg-row[data-panel="${last}"] .lg-arr-grip`);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(500);
  const ids2 = await rowIds(page);
  ok(ids2.indexOf(last) === ids.indexOf(last) - 1, `${name}: ↑ on the ⠿ moves ${last} up one`);
  ok((await api.get('/layout/project')).grid?.items[last], `${name}: saved as every project page’s layout`);
  await page.click('.lg-arr-done');
  await ctx.close();
  await api.call('DELETE', '/layout/project/grid');
}

if (!only || only === 'arrange') {
  await arrange('light');
  await arrange('eink');
}

// ---------------- pop-out windows ----------------

async function popout(theme) {
  const name = `popout-${theme}`;
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name, init: theme === 'eink' ? eink : undefined });
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ft.popout.')).forEach((k) => localStorage.removeItem(k)));
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.lg-item[data-panel="today-list"] .lg-more', { state: 'attached' });
  await page.hover('.lg-item[data-panel="today-list"]');
  await page.click('.lg-item[data-panel="today-list"] .lg-more');
  await page.click('.files-menu button:has-text("Pop out")');
  await page.waitForSelector('.po-win');
  ok(!!(await page.$('.lg-item[data-panel="today-list"] .po-placeholder')), `${name}: the page shows a placeholder where the panel was`);
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
  await page.click('.lg-item[data-panel="notes"] .lg-more');
  await page.click('.files-menu button:has-text("Pop out")');
  await page.waitForSelector('.po-win');
  await shot(page, `${name}-project`);
  await api.put('/today-panels/show', { project_id: p1.id, on: true });
  await page.click('.side a:has-text("Today")');
  await page.waitForSelector('.pl-pill');
  // Saved pills keep their panels; something new on Today is in All.
  await pill(page, 'All');
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

// ---------------- offline, and the flags off ----------------

async function offlineAndFlags() {
  const name = 'offline';
  await api.call('DELETE', '/layout/today/grid');
  await api.call('DELETE', '/layout/today/grids/today');
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.lg-item[data-panel="today-list"]');
  await page.waitForTimeout(400);
  // A move made offline waits, and is sent when the connection is back.
  await ctx.setOffline(true);
  const h2 = await page.locator('.lg-item[data-panel="today-list"] h2').first().boundingBox();
  const week = await box(page, 'plan-week');
  await page.mouse.move(h2.x + 10, h2.y + 8);
  await page.mouse.down();
  await page.mouse.move(h2.x + 40, h2.y + 30, { steps: 4 });
  await page.mouse.move(week.x + 40, week.y + week.height + 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  ok(!(await api.get('/layout/today')).grids.today, `${name}: nothing reaches the server while offline`);
  const placed = await box(page, 'today-list');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2500);
  const g = (await api.get('/layout/today')).grids.today;
  ok(g && g.items['today-list'], `${name}: the move in the Today pill is sent when back online`);
  const after = await box(page, 'today-list');
  ok(Math.abs(after.y - placed.y) < 4 && Math.abs(after.x - placed.x) < 4, `${name}: and the panel stays where it was put`);
  await ctx.close();

  // Only the pills off: the desktop's Today is one grid again, the focus card in it.
  await api.put('/features/today-pills', { enabled: false });
  try {
    const { page: p1, ctx: c1 } = await open(browser, { width: 1280, height: 900 }, errors, { name: 'pills-off' });
    await p1.goto(`${B}/#/today`);
    await p1.waitForSelector('.lg-item[data-panel="focus"]');
    await p1.waitForSelector('.lg-item[data-panel^="list-"]');
    ok(!(await p1.$('.pl-pill')) && (await p1.$$('.lg-item')).length > 4, 'pills off: Today is one grid with the focus card in it');
    await c1.close();
  } finally {
    await api.put('/features/today-pills', { enabled: true });
  }
  // Only the grid off: pills still work, their panels one under the other.
  await api.put('/features/movable-panels', { enabled: false });
  try {
    const { page: p1, ctx: c1 } = await open(browser, { width: 1280, height: 900 }, errors, { name: 'grid-off' });
    await p1.goto(`${B}/#/today`);
    await p1.waitForSelector('.pl-pill');
    await p1.waitForSelector('#pl-panels .today-list');
    ok(!(await p1.$('.lg-item')), 'grid off: pills show their panels without the grid');
    await shot(p1, 'grid-off');
    await c1.close();
  } finally {
    await api.put('/features/movable-panels', { enabled: true });
  }

  // The three flags off: the usual pages.
  for (const f of ['movable-panels', 'today-pills', 'popout-windows']) await api.put(`/features/${f}`, { enabled: false });
  try {
    for (const [w, label] of [[1280, 'desktop'], [390, 'phone']]) {
      const { page: p2, ctx: c2 } = await open(browser, { width: w, height: 900 }, errors, { name: `flags-off-${label}`, touch: w < 700 });
      await p2.goto(`${B}/#/today`);
      await p2.waitForSelector('.focus');
      await p2.waitForTimeout(500);
      ok(!(await p2.$('.lg-item, .lg-more, .pl-pill, .po-btn')), `flags off, ${label}: Today is the plain page`);
      ok(!!(await p2.$('.habits-panel')) && (await p2.$$('.tp-list, .tp-note')).length >= 2, `flags off, ${label}: every panel is there, lists too`);
      await shot(p2, `flags-off-${label}`);
      await c2.close();
    }
  } finally {
    for (const f of ['movable-panels', 'today-pills', 'popout-windows']) await api.put(`/features/${f}`, { enabled: true });
  }
}

if (!only || only === 'offline') await offlineAndFlags();

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
if (errors.length) process.exit(1);
