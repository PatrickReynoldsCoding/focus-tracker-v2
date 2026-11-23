// Browser check for the Desktop page (D64): #/desktop drawn bare (no side bar, header, phone bar or
// corner timer), the window title, the usual panels, + in the corner opening Add panel, a feature
// panel and a file added (the file not put on Today), a panel moved (the grid on a wide window, a
// long press and ↑ on a phone; resized from its corner in a narrow window with a mouse, the grid with
// full-width panels), still there after a reload, Remove with Undo, Today's own
// layout untouched, the flag off; light, dark and E-ink at 1280, 600 (mouse) and 390 px (touch).
// Needs a seeded server; it takes off what it added and removes its note.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/desktop.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/desktop-${name}.png` });
const eink = () => localStorage.setItem('ft.theme', 'eink');

for (const l of await api.get('/lists')) if (/^DW /.test(l.name)) await api.call('DELETE', `/lists/${l.id}`);
const note = await api.post('/lists', { name: 'DW groceries', kind: 'note' });
await api.put(`/notes/of/list/${note.id}`, { body: 'Milk, eggs' });
const noteId = `list-${note.id}`;
const todayBefore = await api.get('/layout/today');

/** The Desktop's panels in screen order. */
const drawn = (page) => page.$$eval('[data-panel]', (els) => els.map((e) => e.dataset.panel));

async function run(page, name, mode) {
  const narrow = mode === 'touch';
  await page.goto(`${B}/#/desktop`);
  await page.waitForSelector('.desktop-page [data-panel]');
  await page.waitForTimeout(500);
  ok((await page.title()) === 'Focus Tracker Desktop', `${name}: the window title is “Focus Tracker Desktop”`);
  ok(!(await page.$('.side:visible, header.top, .tabs:visible')), `${name}: bare: no side bar, header or phone bar`);
  ok((await page.$$eval('.shell.bare', (e) => e.length)) === 1, `${name}: the shell is bare`);
  const bg = await page.evaluate(() => [getComputedStyle(document.querySelector('.shell')).backgroundColor, getComputedStyle(document.body).backgroundColor]);
  ok(bg[0] === bg[1] || bg[0] !== 'rgba(0, 0, 0, 0)', `${name}: the background follows the theme (${bg[0]})`);
  const first = await drawn(page);
  ok(first.includes('focus') && first.includes('today-list'), `${name}: the usual panels show: focus card and Today list (${first.join(', ')})`);
  ok(!first.includes('habits'), `${name}: Habits is not on the Desktop yet`);
  ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${name}: no sideways scroll`);
  if (mode === 'touch') ok(!(await page.$('.lg-grid')) && !!(await page.$('.lg-stack')), `${name}: a phone stacks the panels in one column`);
  if (mode === 'narrow') {
    const gw = (await page.locator('.lg-grid').boundingBox()).width;
    const tw = (await page.locator('.lg-item[data-panel="today-list"]').boundingBox()).width;
    ok(Math.abs(gw - tw) < 4, `${name}: a narrow window with a mouse is the grid, each panel full width (${Math.round(tw)} of ${Math.round(gw)})`);
  }
  await shot(page, `${name}-usual`);

  // + in the corner: Add panel, a feature panel.
  await page.click('.desktop-add');
  await page.waitForSelector('dialog[open] .ap-list');
  ok((await page.textContent('dialog[open]')).includes('Desktop'), `${name}: the sheet says it adds to the Desktop`);
  await shot(page, `${name}-sheet`);
  await page.click('dialog[open] .ap-row:has-text("Habits")');
  await page.waitForSelector('[data-panel="habits"]');
  ok((await api.get('/layout/desktop')).panels.includes('habits'), `${name}: Habits is saved on the Desktop`);

  // Add file: a note that is not on Today stays off Today.
  await page.click('.desktop-add');
  await page.click('dialog[open] .ap-file');
  await page.fill('dialog[open] input[type=search]', 'DW groc');
  await page.waitForSelector('dialog[open] .ap-row:has-text("DW groceries")');
  await page.click('dialog[open] .ap-row:has-text("DW groceries")');
  await page.waitForSelector(`[data-panel="${noteId}"]`);
  ok((await api.get('/layout/desktop')).panels.includes(noteId), `${name}: the note is on the Desktop`);
  ok(!(await api.get(`/lists/${note.id}`)).show_today, `${name}: and not on Today`);
  await page.waitForTimeout(600);
  await shot(page, `${name}-added`);

  // Move a panel.
  if (narrow) {
    const before = await drawn(page);
    await page.locator(`.lg-row[data-panel="${noteId}"] h2, .lg-row[data-panel="${noteId}"] .card-head`).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const h = await page.locator(`.lg-row[data-panel="${noteId}"] h2, .lg-row[data-panel="${noteId}"] .card-head`).first().boundingBox();
    await page.mouse.move(h.x + 20, h.y + 6);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(300);
    ok(!!(await page.$('.lg-arranging')), `${name}: a long press arranges the Desktop`);
    await page.focus(`.lg-row[data-panel="${noteId}"] .lg-arr-grip`);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(500);
    const after = await drawn(page);
    ok(after.indexOf(noteId) === before.indexOf(noteId) - 1, `${name}: ↑ moves the note up one`);
    await page.click('.lg-arr-done');
  } else if (mode === 'narrow') {
    // Resize the Today list from its corner, as on a computer.
    const before = await page.locator('.lg-item[data-panel="today-list"]').boundingBox();
    await page.hover('.lg-item[data-panel="today-list"]');
    await page.waitForTimeout(250);
    const rb = await page.locator('.lg-item[data-panel="today-list"] .lg-resize').boundingBox();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rb.x - 260, rb.y + 80, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await page.locator('.lg-item[data-panel="today-list"]').boundingBox();
    ok(after.width < before.width - 150, `${name}: the Today list resized narrower from its corner (${Math.round(before.width)} → ${Math.round(after.width)})`);
  } else {
    // The Today list by its title, to the right column under the focus card.
    const tl = await page.locator('.lg-item[data-panel="today-list"]').boundingBox();
    const h2 = await page.locator('.lg-item[data-panel="today-list"] h2').first().boundingBox();
    const gb = await page.locator('.lg-grid').boundingBox();
    await page.mouse.move(h2.x + 10, h2.y + h2.height / 2);
    await page.mouse.down();
    await page.mouse.move(h2.x + 40, h2.y + 20, { steps: 4 });
    await page.mouse.move(gb.x + gb.width - tl.width / 2, tl.y - 10, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const moved = await page.locator('.lg-item[data-panel="today-list"]').boundingBox();
    ok(moved.x > gb.x + 100, `${name}: the Today list moved to the right column (${Math.round(moved.x)},${Math.round(moved.y)})`);
  }
  await page.waitForTimeout(400);
  const grid = (await api.get('/layout/desktop')).grid;
  ok(grid && (mode === 'touch' ? grid.items[noteId] : mode === 'narrow' ? grid.items['today-list']?.w < 12 : grid.items['today-list']?.x > 0), `${name}: the change is saved in the Desktop’s own layout`);
  const order = await drawn(page);
  await page.reload();
  await page.waitForSelector(`[data-panel="${noteId}"]`);
  await page.waitForTimeout(500);
  ok(JSON.stringify(await drawn(page)) === JSON.stringify(order), `${name}: the same after a reload`);

  // Remove from the Desktop, then Undo.
  if (narrow) {
    await page.locator('.lg-row[data-panel="habits"] h2, .lg-row[data-panel="habits"] .card-head').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const h = await page.locator('.lg-row[data-panel="habits"] h2, .lg-row[data-panel="habits"] .card-head').first().boundingBox();
    await page.mouse.move(h.x + 20, h.y + 6);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.click('.lg-row[data-panel="habits"] .lg-arr-acts button:has-text("Remove")');
    await page.click('.lg-arr-done').catch(() => {});
  } else {
    const at = await page.locator('.lg-item[data-panel="habits"]').boundingBox();
    await page.hover('.lg-item[data-panel="habits"]', { position: { x: at.width - 30, y: 6 } });
    await page.click('.lg-item[data-panel="habits"] .lg-more');
    await page.click('[role=menuitem]:has-text("Remove from the Desktop")');
  }
  await page.waitForTimeout(500);
  ok(!(await page.$('[data-panel="habits"]')), `${name}: Remove takes Habits off the Desktop`);
  ok(!(await api.get('/layout/desktop')).panels.includes('habits'), `${name}: and saves it`);
  await page.click('.toast button:has-text("Undo")');
  await page.waitForSelector('[data-panel="habits"]');
  ok(true, `${name}: Undo brings it back`);
  ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${name}: still no sideways scroll`);
  await shot(page, `${name}-end`);

  // Today is untouched.
  const todayNow = await api.get('/layout/today');
  ok(JSON.stringify(todayNow.grid) === JSON.stringify(todayBefore.grid) && JSON.stringify(todayNow.pills) === JSON.stringify(todayBefore.pills), `${name}: Today’s layout is unchanged`);
}

for (const [w, h, mode] of [[1280, 900, 'wide'], [600, 1100, 'narrow'], [390, 844, 'touch']])
  for (const theme of ['light', 'dark', 'eink']) {
    await api.call('POST', '/layout/desktop/remove', { panel: 'habits' }).catch(() => {});
    await api.call('POST', '/layout/desktop/remove', { panel: noteId }).catch(() => {});
    await api.call('DELETE', '/layout/desktop/grid').catch(() => {});
    const name = `${theme}-${w}`;
    const { page, ctx } = await open(browser, { width: w, height: h }, errors, { name, touch: mode === 'touch', colorScheme: theme === 'dark' ? 'dark' : 'light', init: theme === 'eink' ? eink : undefined });
    await run(page, name, mode);
    await ctx.close();
  }

// Inside the GNOME app (clients/gnome/app): no + in the corner (its ⚙ menu has Add panel), the
// controls its menu calls, and another page asked for goes to the full app instead.
{
  const messages = [];
  const init = () => {
    window.__sent = [];
    window.webkit = { messageHandlers: { ft: { postMessage: (m) => window.__sent.push(m) } } };
  };
  const { page, ctx } = await open(browser, { width: 600, height: 1000 }, errors, { name: 'app', init });
  await page.close();
  const app = await ctx.browser().newContext({ viewport: { width: 600, height: 1000 }, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 FocusTrackerDesktop/1", storageState: await ctx.storageState() });
  await app.addInitScript(init);
  const p2 = await app.newPage();
  p2.on('pageerror', (e) => errors.push(`app: ${e.message}`));
  await p2.goto(`${B}/#/desktop`);
  await p2.waitForSelector('.desktop-page [data-panel]');
  await p2.waitForTimeout(400);
  ok(!(await p2.$('.desktop-add')), 'app: no + in the corner (the ⚙ menu has Add panel)');
  const listed = await p2.evaluate(() => window.ftDesktop.panels());
  ok(listed.some((x) => x.id === 'focus' && x.title === 'Focus'), `app: the menu can list the panels by name (${listed.map((x) => x.title).join(', ')})`);
  await p2.evaluate(() => window.ftDesktop.add());
  await p2.waitForSelector('dialog[open] .ap-list');
  ok(true, 'app: the menu’s Add panel opens the sheet');
  await p2.keyboard.press('Escape');
  await p2.evaluate(() => (location.hash = '#/p/abc'));
  await p2.waitForTimeout(500);
  messages.push(...(await p2.evaluate(() => window.__sent)));
  ok(messages.some((m) => m.open === '/p/abc'), 'app: a link to another page asks the app to open it in the full app');
  ok((await p2.evaluate(() => location.hash)) === '#/desktop', 'app: the window stays on the Desktop');
  await app.close();
  await ctx.close();
}

// The flag off: the address shows nothing of the Desktop.
await api.put('/features/desktop-page', { enabled: false });
{
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name: 'off' });
  await page.goto(`${B}/#/desktop`);
  await page.waitForTimeout(800);
  ok(!(await page.$('.desktop-page')) && !(await page.$('.shell.bare')), 'flag off: no Desktop page');
  await ctx.close();
}
await api.put('/features/desktop-page', { enabled: true });

await api.call('POST', '/layout/desktop/remove', { panel: 'habits' }).catch(() => {});
await api.call('POST', '/layout/desktop/remove', { panel: noteId }).catch(() => {});
await api.call('DELETE', '/layout/desktop/grid').catch(() => {});
await api.call('DELETE', `/lists/${note.id}`).catch(() => {});
await browser.close();
if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
console.log('all desktop checks passed');
