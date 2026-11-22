// Browser check for the panel restyle (D49, flag panel-restyle; plain lists' List view behind
// unified-board): the Habits panel on Today (and its small version on a phone) is one slim row per
// habit like the Today list (circle to check in, Undo, the name opens Habits); a to-do's panel and
// a plain list's panel are the same component, a plain list's without checkboxes, items under their
// group names; items drag to reorder and to another group (a mouse; a finger's press and hold in
// the phone's small version) and a long press on the panel's head still arranges; a tap on an
// item opens its dialog; the list's title opens the list and ⚙ its settings, which say "Display";
// a plain list's page opens in List view (groups, no ticks, no Done), drags between groups and
// switches to Board. Light and E-ink at 390 and 1280 px; the flag off brings the older panels.
// Needs a seeded server (seed.mjs); makes its own to-do and list and deletes them, and puts the
// desktop-pills switch back.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/panel-restyle.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/panel-restyle-${name}.png`, fullPage: true });
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };
const sideways = async (page, w, where) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= w + 1, `${where}: no sideways scroll`);

const features = await api.get('/features');
const pillsWere = features.find((f) => f.id === 'desktop-pills')?.enabled;
await api.put('/features/desktop-pills', { enabled: false });
await api.put('/features/panel-restyle', { enabled: true });
await api.put('/features/unified-board', { enabled: true });
await api.put('/features/habits', { enabled: true });
for (const l of await api.get('/lists')) if (l.name.startsWith('PR ')) await api.call('DELETE', `/lists/${l.id}`);

// A to-do with two groups and a plain list with two groups, both on Today.
const todo = await api.post('/lists', { name: 'PR Errands', kind: 'todo' });
const [general] = (await api.get(`/lists/${todo.id}/full`)).columns;
const weekend = await api.post('/columns', { list_id: todo.id, name: 'Weekend' });
for (const t of ['Post letter', 'Buy bulbs', 'Call gran']) await api.post('/tasks', { title: t, column_id: general.id });
await api.post('/tasks', { title: 'Clean bike', column_id: weekend.id });
const books = await api.post('/lists', { name: 'PR Books', kind: 'list' });
const [shelf] = (await api.get(`/lists/${books.id}/full`)).columns;
const later = await api.post('/columns', { list_id: books.id, name: 'Later' });
for (const t of ['Dune', 'Emma']) await api.post('/tasks', { title: t, column_id: shelf.id });
await api.post('/tasks', { title: 'Ulysses', column_id: later.id });
for (const l of [todo, books]) await api.put('/today-panels/show', { list_id: l.id, on: true });

const board = async (id) => (await api.get(`/lists/${id}/full`)).columns.map((c) => [c.name, c.cards.map((k) => k.title)]);
const titlesIn = async (id, name) => (await board(id)).find(([n]) => n === name)?.[1] ?? [];
async function resetTodo() {
  const cols = (await api.get(`/lists/${todo.id}/full`)).columns;
  const all = cols.flatMap((c) => c.cards);
  for (const c of all) if (c.done) await api.post(`/tasks/${c.id}/tick`, { done: false });
  const find = (t) => all.find((c) => c.title === t);
  for (const [i, t] of ['Post letter', 'Buy bulbs', 'Call gran'].entries()) await api.post(`/tasks/${find(t).id}/move`, { column_id: general.id, index: i });
  await api.post(`/tasks/${find('Clean bike').id}/move`, { column_id: weekend.id, index: 0 });
}
async function resetBooks() {
  const all = (await api.get(`/lists/${books.id}/full`)).columns.flatMap((c) => c.cards);
  const find = (t) => all.find((c) => c.title === t);
  for (const [i, t] of ['Dune', 'Emma'].entries()) await api.post(`/tasks/${find(t).id}/move`, { column_id: shelf.id, index: i });
  await api.post(`/tasks/${find('Ulysses').id}/move`, { column_id: later.id, index: 0 });
}
async function resetHabits() {
  for (const h of (await api.get('/habits')).filter((x) => x.status === 'active')) await api.post(`/habits/${h.id}/check`, { count: 0 });
}
const doneToday = async (name) => (await api.get('/habits/progress')).find((h) => h.name === name)?.done_today ?? 0;

/** A mouse drag, slow enough for the list's animation to keep up. `y`: where on the target (0 top, 1 bottom). */
async function mouseDrag(page, from, to, y = 0.5) {
  const a = await from.boundingBox();
  const p0 = { x: a.x + a.width * 0.5, y: a.y + a.height / 2 };
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  const b = await to.boundingBox();
  const p1 = { x: b.x + b.width * 0.5, y: b.y + b.height * y };
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(p0.x + ((p1.x - p0.x) * i) / 15, p0.y + ((p1.y - p0.y) * i) / 15);
    await page.waitForTimeout(35);
  }
  await page.waitForTimeout(250);
  await page.mouse.move(p1.x, p1.y + 1);
  await page.waitForTimeout(250);
  await page.mouse.up();
}

/** A finger's press and hold, then a drag, with touch events (what a phone sends). */
async function touchDrag(page, from, to, y = 0.25) {
  const cdp = await page.context().newCDPSession(page);
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const p0 = { x: a.x + a.width * 0.5, y: a.y + a.height / 2 };
  const p1 = { x: b.x + b.width * 0.5, y: b.y + b.height * y };
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });
  await touch('touchStart', p0);
  await page.waitForTimeout(400); // past the hold before a drag starts
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', { x: p0.x + ((p1.x - p0.x) * i) / 12, y: p0.y + ((p1.y - p0.y) * i) / 12 });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(200);
  await touch('touchEnd', p1);
  await cdp.detach();
}
async function hold(page, x, y) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(300);
}

const panel = (page, id) => page.locator(`:is(.lg-row, .lg-item)[data-panel="${id}"]`).first();
async function today(page, phone) {
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('[data-panel="habits"], .pl-row', { timeout: 8000 }).catch(() => {});
  await settle(page, 700);
  if (phone && !(await page.locator('[data-panel="habits"]').count())) {
    await page.click('.pl-pill:has-text("All")').catch(() => {});
    await settle(page, 700);
  }
  await panel(page, 'habits').waitFor();
}
const itemsOf = (loc) => loc.locator('ul.pi-items.ub-drag li .pi-title').allTextContents();

async function habitsPanel(name, page, small) {
  const h = panel(page, 'habits');
  // (On a phone the panel's row is display: contents: its card has the box.)
  await h.locator('.habits-slim').scrollIntoViewIfNeeded();
  const active = (await api.get('/habits')).filter((x) => x.status === 'active').length;
  ok((await h.locator('.habits-slim').count()) === 1 && (await h.locator('.hr-row').count()) === active && (await h.locator('.dot, .strip').count()) === 0, `${name}: Habits${small ? ' (small)' : ''} is one slim row per habit (${active}), no dots or day strip`);
  const box = await h.locator('.habits-slim').boundingBox();
  ok(box.height < 90 + active * 56, `${name}: the Habits panel is short (${Math.round(box.height)} px for ${active} habits)`);
  const stretch = h.locator('.hr-row:has(.tl-title:text-is("Stretch"))');
  await stretch.locator('.tl-tick').click();
  await settle(page, 700);
  ok((await doneToday('Stretch')) === 1 && (await stretch.locator('.tl-meta').textContent()).includes('1/2'), `${name}: the circle checks in a session (1/2)`);
  await stretch.locator('.tl-tick').click();
  await settle(page, 700);
  ok((await stretch.locator('.tl-tick.on').count()) === 1 && (await stretch.getAttribute('class')).includes('done'), `${name}: met for today: ticked and struck through`);
  await shot(page, `${name}-habits`);
  await stretch.locator('.tl-act').click();
  await settle(page, 700);
  ok((await doneToday('Stretch')) === 1, `${name}: Undo takes one session off`);
  await resetHabits();
  await stretch.locator('.tl-name').click();
  await page.waitForFunction(() => location.hash === '#/habits');
  ok(true, `${name}: the habit's name opens the Habits tab`);
}

async function todoPanelDesk(name, page) {
  await resetTodo();
  await today(page, false);
  const p = panel(page, `list-${todo.id}`);
  await p.scrollIntoViewIfNeeded();
  ok((await p.locator('.panel-small').count()) === 0, `${name}: the to-do panel is full size`);
  ok((await p.locator('.ub-compact-name').allTextContents()).join() === 'General,Weekend' && (await p.locator('input[type=checkbox]').count()) === 4, `${name}: the to-do's panel shows its groups with a checkbox each`);
  ok((await p.locator('ul.ub-drag').count()) === 2, `${name}: its items can be dragged`);
  // Reorder within a group: Call gran to the top.
  await mouseDrag(page, p.locator('li:has-text("Call gran") .pi-title'), p.locator('li:has-text("Post letter")'), 0.15);
  await settle(page, 800);
  ok((await titlesIn(todo.id, 'General'))[0] === 'Call gran' && (await itemsOf(p))[0] === 'Call gran', `${name}: dragging in the panel reorders (${await titlesIn(todo.id, 'General')})`);
  // To another group.
  await mouseDrag(page, p.locator('li:has-text("Buy bulbs") .pi-title'), p.locator('li:has-text("Clean bike")'), 0.8);
  await settle(page, 800);
  ok((await titlesIn(todo.id, 'Weekend')).includes('Buy bulbs'), `${name}: dragging to another group moves it there (${await titlesIn(todo.id, 'Weekend')})`);
  // Tick and open.
  await p.locator('li:has-text("Post letter") input[type=checkbox]').check();
  await settle(page, 700);
  ok((await p.locator('li.done:has-text("Post letter")').count()) === 1, `${name}: ticking strikes it through in the panel`);
  await p.locator('li:has-text("Call gran") .pi-title').click();
  await page.waitForSelector('dialog[open] .card-day');
  ok(true, `${name}: tapping an item opens its dialog (with its day)`);
  await page.keyboard.press('Escape');
  await settle(page);
  await shot(page, `${name}-todo-panel`);

  // The plain list's panel: the same rows, no checkboxes.
  await resetBooks();
  await today(page, false);
  const q = panel(page, `list-${books.id}`);
  await q.scrollIntoViewIfNeeded();
  ok((await q.locator('.ub-compact-name').allTextContents()).join() === 'Items,Later' && (await q.locator('input[type=checkbox]').count()) === 0 && (await q.locator('ul.pi-items.ub-drag').count()) === 2, `${name}: the plain list's panel is the to-do panel without checkboxes`);
  await mouseDrag(page, q.locator('li:has-text("Emma") .pi-title'), q.locator('li:has-text("Ulysses")'), 0.15);
  await settle(page, 800);
  ok((await titlesIn(books.id, 'Later'))[0] === 'Emma', `${name}: a plain list's item drags to another group (${await titlesIn(books.id, 'Later')})`);
  await q.locator('li:has-text("Dune") .pi-title').click();
  await page.waitForSelector('dialog[open]');
  ok((await page.locator('dialog[open] .card-day').count()) === 0, `${name}: a plain list's item opens with no day`);
  await page.keyboard.press('Escape');
  await settle(page);
  await shot(page, `${name}-list-panel`);

  // The title opens the list; ⚙ its settings, which say Display.
  await q.locator('.list-gear').click();
  await page.waitForSelector('dialog[open] .seg-radio');
  ok((await page.locator('dialog[open] .seg-radio > strong').textContent()) === 'Display' && !(await page.locator('dialog[open]').textContent()).includes('Display on Today'), `${name}: ⚙ opens the settings, which say Display`);
  await page.keyboard.press('Escape');
  await settle(page);
  await q.locator('a.list-title').click();
  await page.waitForFunction((id) => location.hash === `#/n/${id}`, books.id);
  ok(true, `${name}: the list's title opens the list`);
}

async function plainPage(name, vp, page, phone) {
  await resetBooks();
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ft.view.')).forEach((k) => localStorage.removeItem(k)));
  await page.goto(`${B}/#/n/${books.id}`);
  await page.waitForSelector('.ub');
  await settle(page);
  ok((await page.locator('.ub-seg button.on').textContent()).includes('List') && (await page.locator('.ub-list').count()) === 1, `${name}: a plain list opens in List view, with the switch`);
  const groups = await page.$$eval('.ub-list > .ub-group:not(.ub-done) .column-name', (els) => els.map((e) => e.textContent.trim()));
  ok(groups.join() === 'Items,Later' && (await page.locator('.ub-tick').count()) === 0 && (await page.locator('.ub-done').count()) === 0, `${name}: its groups stacked, no ticks, no Done`);
  await sideways(page, vp.width, `${name} plain list`);
  await shot(page, `${name}-plain-list`);
  const row = (t) => page.locator(`.ub-item:has(.ub-text:text-is("${t}"))`);
  const laterList = page.locator('.ub-list > .ub-group:has(.column-name:text-is("Later")) ul.ub-items');
  if (phone) await touchDrag(page, row('Dune'), laterList);
  else await mouseDrag(page, row('Dune'), laterList, 0.2);
  await settle(page, 900);
  ok((await titlesIn(books.id, 'Later')).includes('Dune'), `${name}: an item drags to another group on the list's page (${await titlesIn(books.id, 'Later')})`);
  await page.click('.ub-seg button:has-text("Board")');
  await settle(page);
  ok((await page.locator('.board.horizontal').count()) === 1, `${name}: Board view shows its columns side by side`);
  await page.click('.ub-seg button:has-text("List")');
  await settle(page);
}

async function phoneToday(name, page) {
  await resetTodo();
  await today(page, true);
  const p = panel(page, `list-${todo.id}`);
  await p.locator('.card').first().evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await settle(page);
  ok((await p.locator('.panel-small ul.pi-items.ub-drag').count()) === 1 && (await p.locator('input[type=checkbox]').count()) === 4, `${name}: the small to-do shows four items with checkboxes, draggable`);
  await touchDrag(page, p.locator('li:has-text("Buy bulbs") .pi-title'), p.locator('li:has-text("Post letter")'), 0.1);
  await settle(page, 900);
  ok((await titlesIn(todo.id, 'General'))[0] === 'Buy bulbs', `${name}: a press and hold then drag reorders in the small version (${await titlesIn(todo.id, 'General')})`);
  ok(!(await page.$('.lg-arranging')) && !(await page.$('dialog[open]')), `${name}: dragging an item does not arrange the panels or open the item`);
  const q = panel(page, `list-${books.id}`);
  ok((await q.locator('input[type=checkbox]').count()) === 0 && (await q.locator('.pi-title').count()) === 3, `${name}: the small plain list has no checkboxes`);
  // A long press on the panel's head (not an item) still arranges.
  const head = await p.locator('.card-head > .muted').first().boundingBox();
  await hold(page, head.x + head.width / 2, head.y + head.height / 2);
  ok(!!(await page.$('.lg-arranging')), `${name}: a long press on the panel's head still arranges the panels`);
  await page.keyboard.press('Escape');
  await page.click('.lg-arr-bar button:has-text("Done")').catch(() => {});
  await settle(page);
  await shot(page, `${name}-today`);
}

async function view(theme, vname, vp, full) {
  const name = `${theme}-${vname}`;
  const phone = vp === PHONE;
  const { page, ctx } = await open(browser, vp, errors, { name, touch: phone, init: `try{localStorage.setItem('ft.theme','${theme}')}catch(e){}` });
  await resetHabits();
  await today(page, phone);
  if (full) {
    await habitsPanel(name, page, phone);
    if (phone) await phoneToday(name, page);
    else await todoPanelDesk(name, page);
    await plainPage(name, vp, page, phone);
  } else {
    await panel(page, 'habits').locator('.card').first().scrollIntoViewIfNeeded();
    await sideways(page, vp.width, `${name} today`);
    await shot(page, `${name}-today`);
    await page.goto(`${B}/#/n/${books.id}`);
    await page.waitForSelector('.ub');
    await settle(page);
    await sideways(page, vp.width, `${name} plain list`);
    await shot(page, `${name}-plain-list`);
  }
  await ctx.close();
}

try {
  await view('light', 'desk', DESK, true);
  await view('light', 'phone', PHONE, true);
  for (const [v, vp] of [['phone', PHONE], ['desk', DESK]]) await view('eink', v, vp, false);

  // The flag off: the older panels.
  await api.put('/features/panel-restyle', { enabled: false });
  {
    await resetTodo();
    const { page, ctx } = await open(browser, DESK, errors, { name: 'flag-off' });
    await today(page, false);
    ok((await panel(page, 'habits').locator('.habit-list').count()) === 1 && (await page.locator('.habits-slim').count()) === 0, 'flag off: the older Habits panel');
    const p = panel(page, `list-${todo.id}`);
    ok((await p.locator('.ub-drag').count()) === 0 && (await p.locator('button.list-title').count()) === 1, 'flag off: nothing drags in the to-do panel and its title opens the settings');
    const q = panel(page, `list-${books.id}`);
    ok((await q.locator('ul.tp-items li').count()) === 3 && (await q.locator('.ub-compact-name').count()) === 0, 'flag off: the plain list panel lists its items');
    await shot(page, 'flag-off');
    await ctx.close();
  }
} finally {
  await api.put('/features/panel-restyle', { enabled: true });
  if (pillsWere !== undefined) await api.put('/features/desktop-pills', { enabled: pillsWere });
  for (const l of [todo, books]) await api.call('DELETE', `/lists/${l.id}`).catch(() => {});
  await resetHabits();
}
await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
