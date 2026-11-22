// Browser check for the to-do screen (D41, flag unified-board): one board component for a to-do,
// a plain list and a project's board. A to-do opens in List view (groups, tick circles, Done folded
// at the bottom): tick into Done and back to its group, drag between groups and within one (a
// mouse; a finger's press and hold on a phone), the dialog's Status picker, a day on a to-do's
// item; Board view (columns side by side) remembered per board on this device, not on another;
// Hide done of a to-do kept on the device. A plain list keeps its board, with no ticks and no day
// picker, and Convert to to-do (with a confirmation) makes it a to-do. A project switches to List
// view, ticks into Done and folds Done (saved on the project). Today's panel for a to-do ticks
// and is not draggable (a long press arranges it). Old addresses (#/l/<id>, #/n/<id>, #/p/<id>,
// panel list-<id>). Light, dark and E-ink at 390 and 1280 px; the flag off.
// Needs a seeded server (seed.mjs); makes its own to-do, list and project and deletes them.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/unified-board.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/unified-board-${name}.png`, fullPage: true });
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 860 };
const sideways = async (page, w, where) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= w + 1, `${where}: no sideways scroll`);
const today = new Date().toLocaleDateString('en-CA');

await api.put('/features/unified-board', { enabled: true });
await api.put('/features/done-column', { enabled: true });
// What an earlier run that stopped half way may have left.
for (const l of await api.get('/lists')) if (l.name.startsWith('UB ')) await api.call('DELETE', `/lists/${l.id}`);
for (const p of await api.get('/projects')) if (p.name === 'UB Shed') await api.call('DELETE', `/projects/${p.id}`);

const todo = await api.post('/lists', { name: 'UB Errands', kind: 'todo', show_today: true });
const [general] = (await api.get(`/lists/${todo.id}/full`)).columns;
const weekend = await api.post('/columns', { list_id: todo.id, name: 'Weekend' });
const items = {};
for (const t of ['Post letter', 'Buy bulbs', 'Call gran']) items[t] = await api.post('/tasks', { title: t, column_id: general.id });
items['Clean bike'] = await api.post('/tasks', { title: 'Clean bike', column_id: weekend.id });
const doneCol = (await api.get(`/lists/${todo.id}/full`)).columns.find((c) => c.is_done);
const project = await api.post('/projects', { name: 'UB Shed' });
for (const t of ['Saw planks', 'Paint door']) await api.post('/tasks', { title: t, project_id: project.id });
const made = { lists: [todo.id], projects: [project.id] };

/** Put the to-do back as it started. */
async function resetTodo() {
  for (const [t, col] of [['Post letter', general.id], ['Buy bulbs', general.id], ['Call gran', general.id], ['Clean bike', weekend.id]]) {
    const c = await api.get(`/tasks/${items[t].id}`);
    if (c.done) await api.post(`/tasks/${c.id}/tick`, { done: false });
    if ((await api.get(`/tasks/${c.id}`)).column_id !== col) await api.post(`/tasks/${c.id}/move`, { column_id: col });
    await api.call('PATCH', `/tasks/${c.id}`, { day: null });
  }
  for (const [i, t] of ['Post letter', 'Buy bulbs', 'Call gran'].entries()) await api.post(`/tasks/${items[t].id}/move`, { column_id: general.id, index: i });
}
const cardOf = (title) => api.get(`/tasks/${items[title].id}`);
const groupNames = (page) => page.$$eval('.ub-list > .ub-group:not(.ub-done) .column-name', (els) => els.map((e) => e.textContent.trim()));
const rowsIn = (page, name) => page.$$eval(`.ub-list > .ub-group:not(.ub-done)`, (gs, n) => {
  const g = gs.find((x) => x.querySelector('.column-name')?.textContent.trim() === n);
  return g ? [...g.querySelectorAll('.ub-item .ub-text')].map((e) => e.textContent.trim()) : null;
}, name);
const row = (page, title) => page.locator(`.ub-item:has(.ub-text:text-is("${title}"))`);
const groupList = (page, name) => page.locator(`.ub-list > .ub-group:has(.column-name:text-is("${name}")) ul.ub-items`);

/** A mouse drag, slow enough for the list's animation to keep up. `y`: where on the target (0 top, 1 bottom). */
async function mouseDrag(page, from, to, y = 0.5) {
  const a = await from.boundingBox();
  await page.mouse.move(a.x + a.width * 0.6, a.y + a.height / 2);
  await page.mouse.down();
  const b = await to.boundingBox();
  const p1 = { x: b.x + b.width * 0.6, y: b.y + b.height * y };
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(a.x + a.width * 0.6 + ((p1.x - a.x - a.width * 0.6) * i) / 15, a.y + a.height / 2 + ((p1.y - a.y - a.height / 2) * i) / 15);
    await page.waitForTimeout(35);
  }
  await page.waitForTimeout(250);
  await page.mouse.move(p1.x, p1.y + 1);
  await page.waitForTimeout(250);
  await page.mouse.up();
}

/** A finger's press and hold, then a drag, with touch events (what a phone sends). */
async function touchDrag(page, from, to) {
  const cdp = await page.context().newCDPSession(page);
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const p0 = { x: a.x + a.width * 0.6, y: a.y + a.height / 2 };
  const p1 = { x: b.x + b.width * 0.6, y: b.y + Math.min(b.height - 4, 18) };
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

async function todoPage(name, vp, ctx, page) {
  await resetTodo();
  await page.goto(`${B}/#/n/${todo.id}`);
  await page.waitForSelector('.ub-list');
  await settle(page);
  ok((await page.locator('.ub-seg button.on').textContent()).includes('List'), `${name}: a to-do opens in List view, with the switch`);
  ok((await groupNames(page)).join() === 'General,Weekend', `${name}: its groups, in order`);
  ok((await page.locator('.ub-done.folded').count()) === 1 && (await page.textContent('.ub-done .done-strip-count')).trim() === '0', `${name}: Done is folded at the bottom`);
  ok((await row(page, 'Post letter').locator('.ub-tick[aria-checked="false"]').count()) === 1, `${name}: items have a tick circle`);
  await sideways(page, vp.width, `${name} list`);
  await shot(page, `${name}-todo-list`);

  // Tick: into Done; untick: back to its group.
  await row(page, 'Post letter').locator('.ub-tick').click();
  await settle(page, 700);
  ok(!(await rowsIn(page, 'General')).includes('Post letter') && (await page.textContent('.ub-done .done-strip-count')).trim() === '1', `${name}: ticking moves the item into Done`);
  let c = await cardOf('Post letter');
  ok(c.column_id === doneCol.id && c.done === today, `${name}: server: in Done, done today`);
  await page.click('.ub-done-head');
  await settle(page);
  ok((await page.locator('.ub-done .ub-item.done .ub-tick[aria-checked="true"]').count()) === 1, `${name}: opening Done shows it ticked`);
  await shot(page, `${name}-todo-done-open`);
  await page.locator('.ub-done .ub-item .ub-tick').first().click();
  await settle(page, 700);
  c = await cardOf('Post letter');
  ok(c.column_id === general.id && !c.done && (await rowsIn(page, 'General')).includes('Post letter'), `${name}: unticking puts it back in General`);

  // Move to another group.
  if (vp === DESK) {
    await settle(page, 600);
    await mouseDrag(page, row(page, 'Buy bulbs'), groupList(page, 'Weekend'));
    await settle(page, 800);
    ok((await cardOf('Buy bulbs')).column_id === weekend.id && (await rowsIn(page, 'Weekend')).includes('Buy bulbs'), `${name}: dragging an item to another group moves it there (${await rowsIn(page, 'Weekend')})`);
    // Reorder within a group: Call gran above Post letter.
    await mouseDrag(page, row(page, 'Call gran'), row(page, (await rowsIn(page, 'General'))[0]), 0.15);
    await settle(page, 800);
    const order = (await api.get(`/lists/${todo.id}/full`)).columns[0].cards.map((k) => k.title);
    ok(order[0] === 'Call gran' && (await rowsIn(page, 'General'))[0] === 'Call gran', `${name}: dragging within a group reorders it (${order.join(', ')})`);
    // Drag into the folded Done: done.
    await page.click('.ub-done-head'); // fold it again
    await settle(page);
    await mouseDrag(page, row(page, 'Clean bike'), page.locator('.ub-done-head'), 0.9);
    await settle(page, 800);
    c = await cardOf('Clean bike');
    ok(c.column_id === doneCol.id && !!c.done, `${name}: an item dropped on the folded Done is done`);
  } else {
    // A finger: press and hold, then drag to the other group.
    await touchDrag(page, row(page, 'Buy bulbs'), groupList(page, 'Weekend'));
    await settle(page, 900);
    const moved = (await cardOf('Buy bulbs')).column_id === weekend.id;
    ok(moved && (await rowsIn(page, 'Weekend')).includes('Buy bulbs'), `${name}: press and hold, then drag, moves an item to another group`);
    // Or the dialog's Status picker ("move to").
    await row(page, 'Call gran').locator('.ub-title').click();
    await page.waitForSelector('dialog[open] label.inline:has-text("Status") select');
    await page.locator('dialog[open] label.inline:has-text("Status") select').selectOption(weekend.id);
    await settle(page);
    await page.keyboard.press('Escape');
    await settle(page, 700);
    ok((await cardOf('Call gran')).column_id === weekend.id && (await rowsIn(page, 'Weekend')).includes('Call gran'), `${name}: the dialog's Status moves an item to another group`);
  }

  // A to-do's item has a day (its due date).
  await row(page, 'Post letter').locator('.ub-title').click();
  await page.waitForSelector('dialog[open] .card-day');
  await page.click('dialog[open] .card-day button:has-text("Today")');
  await settle(page);
  await page.keyboard.press('Escape');
  await settle(page, 700);
  ok((await cardOf('Post letter')).day === today && (await row(page, 'Post letter').locator('.day-mark').count()) === 1, `${name}: a to-do's item takes a day and shows it`);

  // Board view: remembered on this device, for this board only.
  await page.click('.ub-seg button:has-text("Board")');
  await settle(page);
  const cols = await page.$$eval('.board.horizontal > .column:not(.add-column)', (els) => els.map((e) => (e.querySelector('.column-name')?.textContent ?? e.querySelector('.done-strip-name')?.textContent ?? '').trim()));
  ok(cols.join() === 'General,Weekend,Done', `${name}: Board view shows the groups side by side, Done last (${cols.join(', ')})`);
  await sideways(page, vp.width, `${name} board`);
  await shot(page, `${name}-todo-board`);
  await page.reload();
  await page.waitForSelector('.ub');
  await settle(page);
  ok((await page.locator('.board.horizontal').count()) === 1, `${name}: after a reload it is still Board view`);
  const other = await open(browser, vp, errors, { name: `${name}-other` });
  await other.page.goto(`${B}/#/n/${todo.id}`);
  await other.page.waitForSelector('.ub');
  ok((await other.page.locator('.ub-list').count()) === 1, `${name}: another device keeps its own view (List)`);
  await other.ctx.close();
  // Hide done on a to-do: kept on this device.
  const wasHidden = (await page.locator('.done-strip').count()) === 1;
  await page.click(`.board-tools button:has-text("${wasHidden ? 'Show done' : 'Hide done'}")`);
  await settle(page);
  await page.reload();
  await page.waitForSelector('.ub');
  await settle(page);
  ok((await page.locator('.done-strip').count()) === (wasHidden ? 0 : 1), `${name}: a to-do's Hide done is kept after a reload`);
  await page.click(`.board-tools button:has-text("${wasHidden ? 'Hide done' : 'Show done'}")`);
  await page.click('.ub-seg button:has-text("List")');
  await settle(page);
}

async function plainPage(name, vp, page) {
  const plain = await api.post('/lists', { name: 'UB Books', kind: 'list' });
  made.lists.push(plain.id);
  for (const t of ['Dune', 'Emma']) await api.post('/tasks', { title: t, list_id: plain.id });
  await page.goto(`${B}/#/n/${plain.id}`);
  await page.waitForSelector('.ub-list, .board');
  await settle(page);
  ok((await page.locator('.ub-seg').count()) === 0 && (await page.locator('.board .kcard').count()) === 2 && (await page.locator('.ub-tick').count()) === 0, `${name}: a plain list keeps its board look: no switch, no ticks`);
  await page.locator('.kcard:has-text("Dune")').click();
  await page.waitForSelector('dialog[open] label.inline:has(select)');
  ok((await page.locator('dialog[open] .card-day').count()) === 0 && (await page.locator('dialog[open] label.inline:has-text("Column")').count()) === 1, `${name}: a plain list's item has no day picker`);
  await page.keyboard.press('Escape');
  await sideways(page, vp.width, `${name} plain`);
  await shot(page, `${name}-plain`);
  // Convert, with a confirmation; turning it down changes nothing.
  page.once('dialog', (d) => d.dismiss());
  await page.click('button:has-text("Convert to to-do")');
  await settle(page);
  ok((await api.get(`/lists/${plain.id}`)).kind === 'list', `${name}: saying no to the confirmation keeps it a list`);
  let asked = '';
  page.once('dialog', (d) => ((asked = d.message()), d.accept()));
  await page.click('button:has-text("Convert to to-do")');
  await page.waitForSelector('.ub-seg');
  await settle(page, 700);
  ok(asked.includes('cannot go back'), `${name}: the confirmation says it is one way`);
  ok((await api.get(`/lists/${plain.id}`)).kind === 'todo' && (await page.textContent('.page-head .tag')).includes('To-do'), `${name}: Convert to to-do makes it a to-do`);
  ok((await page.locator('.ub-list .ub-tick').count()) === 2 && (await page.locator('button:has-text("Convert to to-do")').count()) === 0, `${name}: it now has tick circles and no Convert`);
  await shot(page, `${name}-converted`);
}

async function projectPage(name, vp, page) {
  await api.call('PATCH', `/projects/${project.id}`, { hide_done: false });
  await page.goto(`${B}/#/p/${project.id}`);
  await page.waitForSelector('.ub-project');
  await settle(page);
  ok((await page.locator('.ub-project .board.horizontal').count()) === 1 && (await page.locator('.ub-seg button.on').textContent()).includes('Board'), `${name}: a project's board opens in Board view, with the switch`);
  await page.click('.ub-seg button:has-text("List")');
  await settle(page);
  ok((await groupNames(page)).join() === 'To do,Doing', `${name}: List view: To do and Doing, Done at the bottom`);
  await row(page, 'Saw planks').locator('.ub-tick').click();
  await settle(page, 700);
  const full = await api.get(`/projects/${project.id}/full`);
  ok(full.columns.at(-1).cards.some((k) => k.title === 'Saw planks' && k.done), `${name}: ticking a project's card puts it in Done`);
  await page.click('.ub-done-head');
  await settle(page, 700);
  ok((await api.get(`/projects/${project.id}/full`)).hide_done === true && (await page.locator('.ub-done.folded').count()) === 1, `${name}: folding Done is the project's Hide done (saved on the project)`);
  await page.click('.ub-done-head');
  await settle(page, 600);
  await page.locator('.ub-done .ub-item:has-text("Saw planks") .ub-tick').click();
  await settle(page, 700);
  ok((await api.get(`/projects/${project.id}/full`)).columns[0].cards.some((k) => k.title === 'Saw planks' && !k.done), `${name}: unticking puts it back in To do`);
  await sideways(page, vp.width, `${name} project list`);
  await shot(page, `${name}-project-list`);
  await page.click('.ub-seg button:has-text("Board")');
  await settle(page);
}

async function todayPanel(name, page) {
  await resetTodo();
  await page.goto(`${B}/#/today`);
  const panel = page.locator(`[data-panel="list-${todo.id}"]`);
  // On a phone it may sit in another pill: All shows every panel.
  await page.waitForSelector('.pl-row, .grid, .lg-stack', { timeout: 5000 }).catch(() => {});
  await settle(page);
  if (!(await panel.count())) await page.click('.pl-pill:has-text("All")').catch(() => {});
  await panel.first().waitFor();
  await panel.first().scrollIntoViewIfNeeded();
  await settle(page);
  // A panel narrower than 420 px (a phone) shows the small version: the first few, a tick each.
  const small = (await panel.first().locator('.panel-small').count()) === 1;
  ok((await panel.first().locator('li:has(input[type=checkbox])').count()) === 4 && (await panel.first().locator('.ub-drag').count()) === 0, `${name}: the to-do on Today${small ? ' (small)' : ''} shows its items with ticks, and nothing to drag (a long press arranges the panel)`);
  await panel.first().locator('li:has-text("Post letter") input[type=checkbox]').click();
  await settle(page, 700);
  ok(!!(await cardOf('Post letter')).done, `${name}: ticking on Today marks it done`);
  if (small) {
    ok((await panel.first().locator('li:has-text("Post letter")').count()) === 0, `${name}: the small version drops it from the list`);
    await api.post(`/tasks/${items['Post letter'].id}/tick`, { done: false });
  } else {
    ok((await panel.first().locator('li.done:has-text("Post letter")').count()) === 1, `${name}: it stays, struck through, until tomorrow`);
    await panel.first().locator('li:has-text("Post letter") input[type=checkbox]').click();
    await settle(page, 700);
    ok(!(await cardOf('Post letter')).done, `${name}: and unticking brings it back`);
  }
  await shot(page, `${name}-today`);
}

async function view(theme, vname, vp, full) {
  const name = `${theme}-${vname}`;
  const { page, ctx } = await open(browser, vp, errors, { name, touch: full && vp === PHONE, colorScheme: theme === 'dark' ? 'dark' : 'light', init: `try{localStorage.setItem('ft.theme','${theme}')}catch(e){}` });
  if (full) {
    await todoPage(name, vp, ctx, page);
    await plainPage(name, vp, page);
    await projectPage(name, vp, page);
    await todayPanel(name, page);
  } else {
    await resetTodo();
    await api.post(`/tasks/${items['Clean bike'].id}/tick`, { done: true });
    await page.goto(`${B}/#/n/${todo.id}`);
    await page.waitForSelector('.ub-list');
    await page.click('.ub-done-head');
    await settle(page);
    await sideways(page, vp.width, `${name} list`);
    await shot(page, `${name}-todo-list`);
    await page.click('.ub-seg button:has-text("Board")');
    await settle(page);
    await shot(page, `${name}-todo-board`);
    await page.click('.ub-seg button:has-text("List")');
    await page.goto(`${B}/#/p/${project.id}`);
    await page.waitForSelector('.ub-project');
    await settle(page);
    await shot(page, `${name}-project`);
  }
  await ctx.close();
}

await view('light', 'desk', DESK, true);
await view('light', 'phone', PHONE, true);
for (const theme of ['dark', 'eink']) for (const [v, vp] of [['phone', PHONE], ['desk', DESK]]) await view(theme, v, vp, false);

// Old addresses still open the same screens.
{
  const { page, ctx } = await open(browser, PHONE, errors, { name: 'addresses' });
  await page.goto(`${B}/#/l/${todo.id}`);
  await page.waitForSelector('.ub-list');
  ok(page.url().endsWith(`#/n/${todo.id}`), '#/l/<id> opens the to-do at #/n/<id>');
  await page.goto(`${B}/#/p/${project.id}`);
  await page.waitForSelector('.ub-project');
  ok(true, '#/p/<id> opens the project with its board');
  await ctx.close();
}

// The flag off: no switch; a to-do as a list, a project and a plain list as a board; no Convert.
{
  await api.put('/features/unified-board', { enabled: false });
  try {
    const plain = await api.post('/lists', { name: 'UB Films', kind: 'list' });
    made.lists.push(plain.id);
    const { page, ctx } = await open(browser, DESK, errors, { name: 'flag-off' });
    await page.goto(`${B}/#/n/${todo.id}`);
    await page.waitForSelector('.ub');
    await settle(page);
    ok((await page.locator('.ub-seg').count()) === 0 && (await page.locator('.ub-list').count()) === 1, 'flag off: a to-do is a list, with no switch');
    await page.goto(`${B}/#/p/${project.id}`);
    await page.waitForSelector('.ub-project');
    await settle(page);
    ok((await page.locator('.ub-seg').count()) === 0 && (await page.locator('.ub-project .board').count()) === 1, 'flag off: a project is a board, with no switch');
    await page.goto(`${B}/#/n/${plain.id}`);
    await page.waitForSelector('.ub');
    await settle(page);
    ok((await page.locator('button:has-text("Convert to to-do")').count()) === 0, 'flag off: no Convert to to-do');
    await shot(page, 'flag-off');
    await ctx.close();
  } finally {
    await api.put('/features/unified-board', { enabled: true });
  }
}

for (const id of made.lists) await api.call('DELETE', `/lists/${id}`).catch(() => {});
for (const id of made.projects) await api.call('DELETE', `/projects/${id}`).catch(() => {});
await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
