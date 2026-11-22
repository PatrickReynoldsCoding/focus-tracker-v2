// Browser check for subtasks (D57, flag `subtasks`): List view (mockup 1B: a ▸/▾ chevron and a
// count chip, subtasks indented under the to-do, open or folded by the setting "Subtasks open by
// default", the choice made on a device remembered over it), Board view (mockup 2B: a progress bar
// and "☑ 1/3 show/hide", a checklist ticked on the card without opening it), the card dialog
// (add, rename, tick, move, delete), the rules (ticking every subtask or the parent ticks
// nothing else), Undo of a deleted to-do bringing its subtasks back, the count on the Today list,
// the setting in Settings, the flag off. Light, dark and E-ink at 390 and 1280 px.
// Needs a FRESH seeded server (seed.mjs); makes its own to-do and deletes it.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/subtasks.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/subtasks-${name}.png`, fullPage: true });
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 860 };
const today = new Date().toLocaleDateString('en-CA');
const sideways = async (page, w, where) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= w + 1, `${where}: no sideways scroll`);

await api.put('/features/subtasks', { enabled: true });
await api.put('/features/unified-board', { enabled: true });
await api.put('/settings/subtasks.open_default', { value: null });
let list, launch1, garden, g;
/** The to-do and its subtasks, made again for each run of the checks. */
async function makeData() {
  for (const l of await api.get('/lists')) if (l.name.startsWith('ST ')) await api.call('DELETE', `/lists/${l.id}`);
  list = await api.post('/lists', { name: 'ST Jobs', kind: 'todo', show_today: true });
  launch1 = await api.post('/todos', { title: 'Plan the launch', list_id: list.id, day: today });
  garden = await api.post('/todos', { title: 'Fix the garden', list_id: list.id });
  await api.post('/todos', { title: 'Buy milk', list_id: list.id });
  for (const t of ['Write announcement', 'Book the venue', 'Send invites']) await api.post('/subtasks', { task_id: launch1.id, title: t });
  g = [];
  for (const t of ['Mow lawn', 'Trim hedge', 'Paint fence']) g.push(await api.post('/subtasks', { task_id: garden.id, title: t }));
  await api.post(`/subtasks/${g[0].id}/tick`, { done: true });
  await api.post(`/subtasks/${g[1].id}/tick`, { done: true });
}
const subsOf = async (id) => (await api.get(`/subtasks?task_id=${id}`)).map((s) => [s.title, !!s.done]);

const row = (page, title) => page.locator(`.ub-item:has(.ub-text:text-is("${title}"))`).first();
const chip = (page, title) => row(page, title).locator('.sub-chip');
const cardTile = (page, title) => page.locator(`.kcard:has(.kcard-title:text-is("${title}"))`).first();

async function go(page, hash) {
  await page.goto(`${B}/#${hash}`);
  await page.reload();
  await page.waitForSelector('.shell');
  await settle(page);
}

try {
  for (const [name, vp, scheme, eink] of [['phone', PHONE, 'light', false], ['desk', DESK, 'dark', false], ['eink', PHONE, 'light', true]]) {
    await makeData();
    const errs = [];
    const { page, ctx } = await open(browser, vp, errs, { name, colorScheme: scheme, touch: vp === PHONE, init: eink ? "try{localStorage.setItem('ft.theme','eink')}catch(e){}" : undefined });
    await go(page, `/n/${list.id}`);
    // ---- List view, default open
    await page.locator('.ub-seg button', { hasText: 'List' }).click();
    ok((await chip(page, 'Plan the launch').textContent()).replace(/\s/g, '') === '▾0/3', `${name}: the chip shows ▾ 0/3 (open by default)`);
    ok((await row(page, 'Plan the launch').locator('.sub-item').count()) === 3, `${name}: subtasks open by default, three shown`);
    ok((await chip(page, 'Fix the garden').textContent()).replace(/\s/g, '') === '▾2/3', `${name}: 2/3 on the garden`);
    ok((await row(page, 'Buy milk').locator('.sub-chip').count()) === 0, `${name}: a to-do with none has no chip`);
    await shot(page, `${name}-list-open`);
    await sideways(page, vp.width, `${name} list`);
    // tick a subtask: parent not ticked, count moves
    await row(page, 'Plan the launch').locator('.sub-check').first().click();
    await settle(page, 800);
    ok((await chip(page, 'Plan the launch').textContent()).replace(/\s/g, '') === '▾1/3', `${name}: ticking a subtask moves the count to 1/3`);
    ok(JSON.stringify(await subsOf(launch1.id)) === JSON.stringify([['Write announcement', true], ['Book the venue', false], ['Send invites', false]]), `${name}: saved on the server`);
    // tick all: parent stays open
    for (let i = 0; i < 2; i++) await row(page, 'Plan the launch').locator('.sub-check:not(.on)').first().click();
    await settle(page, 800);
    ok((await chip(page, 'Plan the launch').textContent()).replace(/\s/g, '') === '▾3/3', `${name}: all three ticked`);
    ok(!(await api.get(`/tasks/${launch1.id}`)).done, `${name}: ticking every subtask does not tick the to-do`);
    // fold on this device, remembered after a reload
    await chip(page, 'Plan the launch').click();
    ok((await row(page, 'Plan the launch').locator('.sub-item').count()) === 0, `${name}: the chevron folds it`);
    await page.reload();
    await settle(page);
    await page.locator('.ub-seg button', { hasText: 'List' }).click();
    ok((await row(page, 'Plan the launch').locator('.sub-item').count()) === 0, `${name}: folded state remembered on this device`);
    ok((await row(page, 'Fix the garden').locator('.sub-item').count()) === 3, `${name}: another to-do keeps the default (open)`);
    await shot(page, `${name}-list-folded`);
    // add a subtask in the list
    await row(page, 'Fix the garden').locator('.sub-in-list input').fill('Water pots');
    await page.keyboard.press('Enter');
    await settle(page, 500);
    ok((await subsOf(garden.id)).length === 4, `${name}: + Add subtask adds one`);
    // tick the parent: subtasks stay
    await row(page, 'Fix the garden').locator('.ub-tick').click();
    await settle(page, 500);
    ok(JSON.stringify(await subsOf(garden.id)) === JSON.stringify([['Mow lawn', true], ['Trim hedge', true], ['Paint fence', false], ['Water pots', false]]), `${name}: ticking the to-do leaves its subtasks alone`);
    await api.post(`/tasks/${garden.id}/tick`, { done: false });
    // ---- Board view, 2B
    await page.reload();
    await settle(page);
    await page.locator('.ub-seg button', { hasText: 'Board' }).click();
    await settle(page);
    const tile = cardTile(page, 'Fix the garden');
    ok((await tile.locator('.sub-foot').textContent()).replace(/\s/g, '').startsWith('☑2/4'), `${name}: the card says ☑ 2/4`);
    ok((await tile.locator('.sub-item').count()) === 4, `${name}: the checklist is on the card (open by default)`);
    await shot(page, `${name}-board`);
    await sideways(page, vp.width, `${name} board`);
    await tile.locator('.sub-check:not(.on)').first().click();
    await settle(page, 800);
    ok(!(await page.locator('dialog[open]').count()), `${name}: ticking on the card does not open it`);
    ok((await subsOf(garden.id)).filter((s) => s[1]).length === 3, `${name}: ticked on the card, saved`);
    await tile.locator('.sub-foot').click();
    ok((await tile.locator('.sub-item').count()) === 0, `${name}: hide folds the checklist; the bar stays`);
    ok((await tile.locator('.sub-bar').count()) === 1, `${name}: progress bar shown`);
    await shot(page, `${name}-board-folded`);
    // ---- dialog
    await tile.locator('.kcard-title').click();
    await page.waitForSelector('dialog[open] .sub-section');
    const dlg = page.locator('dialog[open]');
    ok((await dlg.locator('.sub-section .sub-item').count()) === 4, `${name}: the dialog lists the subtasks`);
    await dlg.locator('.sub-section .add-input input').fill('Rake leaves');
    await page.keyboard.press('Enter');
    await settle(page, 800);
    ok((await subsOf(garden.id)).length === 5, `${name}: the dialog adds a subtask`);
    await dlg.locator('.sub-section .sub-item').last().locator('button[aria-label^="Move"]').first().click();
    await settle(page, 800);
    ok((await subsOf(garden.id))[3][0] === 'Rake leaves', `${name}: ↑ moves a subtask up`);
    await dlg.locator('.sub-section .sub-item').nth(3).locator('.sub-title').click();
    await dlg.locator('.sub-section input.inline-input').fill('Rake the leaves');
    await page.keyboard.press('Enter');
    await settle(page, 800);
    ok((await subsOf(garden.id))[3][0] === 'Rake the leaves', `${name}: a subtask is renamed in place`);
    await shot(page, `${name}-dialog`);
    await dlg.locator('.sub-section .sub-item').nth(3).locator('button[aria-label^="Delete"]').click();
    await settle(page, 800);
    ok((await subsOf(garden.id)).length === 4, `${name}: a subtask is deleted`);
    await page.keyboard.press('Escape');
    await settle(page, 300);
    await ctx.close();
    errors.push(...errs);
  }

  // ---- the setting: closed by default, a device choice still wins
  const sg = await api.get('/setting-scope');
  ok(sg.some((s) => s.id === 'subtasks.open_default'), 'the setting can be set for a profile or all profiles');
  {
    const errs = [];
    const { page, ctx } = await open(browser, DESK, errs, { name: 'settings' });
    await page.goto(`${B}/#/settings`);
    await page.waitForSelector('text=Subtasks open by default');
    const box = page.locator('label:has-text("Subtasks open by default") input[type=checkbox]');
    ok(await box.isChecked(), 'Settings: open by default is on to start with');
    await page.locator('.scope-choice').filter({ has: page.locator('text=only') }).last().scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, 'settings');
    await box.uncheck();
    await settle(page, 600);
    ok((await api.get('/settings')).mode['subtasks.open_default'] === 'off', 'Settings: switching it off is saved');
    await go(page, `/n/${list.id}`);
    await page.locator('.ub-seg button', { hasText: 'List' }).click();
    ok((await chip(page, 'Fix the garden').textContent()).replace(/\s/g, '').startsWith('▸'), 'closed by default: the garden is folded (▸)');
    ok((await row(page, 'Fix the garden').locator('.sub-item').count()) === 0, 'closed by default: no subtasks drawn');
    await shot(page, 'list-closed-default');
    await chip(page, 'Fix the garden').click();
    ok((await row(page, 'Fix the garden').locator('.sub-item').count()) === 4, 'a tap opens it');
    // Today list shows the count
    await go(page, '/today');
    const todayRow = page.locator('.tl-row:has-text("Plan the launch")');
    ok((await todayRow.textContent()).includes('☑ 3/3'), 'Today list: the to-do carries its subtask count');
    ok((await page.locator('.tl-row:has-text("Write announcement")').count()) === 0, 'Today list: subtasks never appear on their own');
    await shot(page, 'today');
    await api.put('/settings/subtasks.open_default', { value: null });
    await ctx.close();
    errors.push(...errs);
  }

  // ---- delete the parent, Undo
  {
    const t = await api.post('/todos', { title: 'ST Temp', list_id: list.id });
    await api.post('/subtasks', { task_id: t.id, title: 'one' });
    await api.call('DELETE', `/tasks/${t.id}`);
    ok((await api.get('/subtasks')).every((s) => s.task_id !== t.id), 'deleting a to-do deletes its subtasks');
    await api.post('/undo');
    ok((await subsOf(t.id)).length === 1, 'Undo brings the subtasks back');
  }

  // ---- flag off
  await api.put('/features/subtasks', { enabled: false });
  {
    const errs = [];
    const { page, ctx } = await open(browser, DESK, errs, { name: 'flag-off' });
    await go(page, `/n/${list.id}`);
    ok((await page.locator('.sub-chip, .sub-block').count()) === 0, 'flag off: no subtasks on screen');
    await ctx.close();
    errors.push(...errs);
  }
} finally {
  await api.put('/features/subtasks', { enabled: true });
  await api.put('/settings/subtasks.open_default', { value: null });
  for (const l of await api.get('/lists')) if (l.name.startsWith('ST ')) await api.call('DELETE', `/lists/${l.id}`).catch(() => {});
}
await browser.close();
if (errors.length) {
  console.error('Console errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('subtasks: all checks passed');
