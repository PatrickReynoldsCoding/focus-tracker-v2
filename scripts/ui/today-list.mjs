// Browser check for the Today list (D30, flag today-panel): it is the first panel of the Today pill
// in place of To do today and Habits; it lists habits, then to-dos and cards for today or from
// earlier; tick, Not today, Show and Undo, add, opening a card and a to-do's list; a card's day in
// the card dialog and on its tile; all done; a change made elsewhere showing when the app comes
// back; a tick made offline; an old saved pill that names "todos"; the flag off. Light, dark and
// E-ink at 390 and 1280 px.
// Needs a seeded server (seed.mjs). Usage: FT_URL=http://localhost:8787 node scripts/ui/today-list.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/today-list-${name}.png`, fullPage: true });
const settle = (page) => page.waitForTimeout(350);

// ---------- data: a to-do from two days ago, a card for today, a list item from yesterday, a weekly habit ----------
const { day } = await api.get('/today');
const back = (n) => new Date(Date.parse(`${day}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const p1 = (await api.get('/projects')).find((p) => p.name === 'Focus Tracker v2');
if (!p1) throw new Error('Run seed.mjs first');
const lists = await api.get('/lists');
const readList = lists.find((l) => l.name === 'Read and watch');
await api.call('DELETE', '/layout/today/pills').catch(() => {});
await api.put('/features/today-panel', { enabled: true });

async function reset() {
  const t = await api.get('/today');
  const extra = (x) => ['Buy stamps', 'Ring the vet'].includes(x.title);
  for (const x of t.todos) if (extra(x)) await api.call('DELETE', `/todos/${x.id}`);
  for (const x of t.todos) if (x.done && !extra(x)) await api.post(`/todos/${x.id}/tick`, { done: false });
  if (!t.todos.some((x) => x.title === 'Post the parcel')) await api.post('/todos', { title: 'Post the parcel', day: back(2) });
  const full = await api.get(`/projects/${p1.id}/full`);
  const card = full.columns.flatMap((c) => c.cards).find((c) => c.title === 'MCP tools');
  if (card.column_id !== full.columns[0].id) await api.post(`/tasks/${card.id}/move`, { column_id: full.columns[0].id });
  await api.call('PATCH', `/tasks/${card.id}`, { day, done: null });
  const rl = await api.get(`/lists/${readList.id}/full`);
  const dune = rl.columns[0].cards.find((c) => c.title === 'Dune');
  await api.call('PATCH', `/tasks/${dune.id}`, { day: back(1), done: null });
  let habits = await api.get('/habits');
  if (!habits.some((h) => h.name === 'Guitar')) await api.post('/habits', { name: 'Guitar', sessions: 2, per: 'week', size: '15 min' });
  habits = await api.get('/habits');
  for (const h of habits.filter((x) => x.status === 'active')) {
    await api.post(`/habits/${h.id}/check`, { count: 0 });
    await api.post(`/habits/${h.id}/not-today`, { on: false });
  }
  return { card, dune };
}

const openRows = (page) => page.$$eval('.today-list .tl-sec .tl-row .tl-title', (els) => els.map((e) => e.textContent.trim()));
const row = (page, title) => page.locator(`.today-list .tl-sec .tl-row:has(.tl-title:text-is("${title}"))`);
const sideways = async (page, w, where) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= w + 1, `${where}: no sideways scroll`);

async function view(theme, vname, vp, act) {
  const name = `${theme}-${vname}`;
  const { card } = await reset();
  const { page, ctx } = await open(browser, vp, errors, { name, colorScheme: theme === 'dark' ? 'dark' : 'light', init: `try{localStorage.setItem('ft.theme','${theme === 'eink' ? 'eink' : theme}')}catch(e){}` });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.today-list');
  await settle(page);
  const pillText = await page.$eval('.pl-pill[aria-selected="true"]', (b) => b.textContent.trim());
  ok(/Today/.test(pillText) && /\d+ left/.test(pillText), `${name}: the Today pill is open and counts what is left (${pillText})`);
  ok(!(await page.$('#pl-panels .habits-panel')) && !(await page.$('#pl-panels h2:text-is("To do today")')), `${name}: no separate To do today or Habits panel in the Today pill`);
  const titles = await openRows(page);
  ok(titles.slice(0, 3).join() === 'Stretch,Run,Guitar' && titles.indexOf('Post the parcel') < titles.indexOf('Dune') && titles.indexOf('Dune') < titles.indexOf('Reply to landlord') && titles.includes('MCP tools'), `${name}: habits first, then the oldest to-dos and cards (${titles.join(', ')})`);
  ok((await row(page, 'Post the parcel').locator('.tag.late').count()) === 1 && (await row(page, 'Dune').textContent()).includes('Read and watch'), `${name}: late items are marked, a card says where it lives`);
  await sideways(page, vp.width, name);
  await shot(page, `${name}-start`);
  if (act) await act(page, name, card, ctx);
  await ctx.close();
}

async function interact(page, name, card, ctx) {
  // Tick a to-do: it leaves the list at once and is saved.
  await row(page, 'Reply to landlord').locator('.tl-tick').click();
  await settle(page);
  ok(!(await openRows(page)).includes('Reply to landlord') && (await page.textContent('.tl-foot')).includes('1 done'), `${name}: a ticked to-do leaves the list and is counted as done`);
  // A daily habit with two sessions stays until both are done.
  await row(page, 'Stretch').locator('.tl-tick').click();
  await settle(page);
  ok((await row(page, 'Stretch').textContent()).includes('1/2'), `${name}: one session of Stretch: still there, 1/2`);
  // Not today on a weekly habit.
  await row(page, 'Guitar').locator('.tl-act').click();
  await settle(page);
  ok(!(await openRows(page)).includes('Guitar'), `${name}: Not today takes Guitar off`);
  // Tick a card: it goes to the board's Done column.
  await row(page, 'MCP tools').locator('.tl-tick').click();
  await page.waitForTimeout(800);
  const full = await api.get(`/projects/${p1.id}/full`);
  ok(full.columns[2].cards.some((c) => c.id === card.id), `${name}: the ticked card is in Done on its board`);
  const t = await api.get('/today');
  ok(t.todos.find((x) => x.title === 'Reply to landlord').done === day && t.habits.find((h) => h.name === 'Stretch').done_today === 1 && t.habits.find((h) => h.name === 'Guitar').skipped_today, `${name}: the to-do, the session and Not today are saved`);
  // Show what was done; take the card back.
  await page.click('.tl-show');
  await settle(page);
  const done = await page.$$eval('#tl-done .tl-title', (els) => els.map((e) => e.textContent.trim()));
  ok(['Reply to landlord', 'MCP tools', 'Guitar'].every((x) => done.includes(x)), `${name}: Show lists what was done or put off (${done.join(', ')})`);
  await shot(page, `${name}-done`);
  await page.click('#tl-done .tl-row:has(.tl-title:text-is("MCP tools")) .tl-act');
  await page.waitForTimeout(800);
  ok((await openRows(page)).includes('MCP tools') && (await api.get(`/projects/${p1.id}/full`)).columns[0].cards.some((c) => c.id === card.id), `${name}: Undo puts the card back on the list and in its first column`);
  await page.click('#tl-done .tl-row:has(.tl-title:text-is("Guitar")) .tl-act');
  await settle(page);
  ok((await openRows(page)).includes('Guitar'), `${name}: Back puts Guitar back`);
  // Add a to-do for today.
  await page.fill('.today-list .add-input input', 'Buy stamps');
  await page.press('.today-list .add-input input', 'Enter');
  await page.waitForTimeout(800);
  ok((await openRows(page)).includes('Buy stamps') && (await api.get('/today')).todos.some((x) => x.title === 'Buy stamps' && x.day === day), `${name}: a to-do added here is for today`);
  // Open a card: its dialog, with its day; "No day" takes it off the list.
  await row(page, 'MCP tools').locator('.tl-name').click();
  await page.waitForSelector('dialog[open] .card-day');
  ok((await page.$eval('dialog[open] .card-day input[type=date]', (i) => i.value)) === day, `${name}: the card opens in its dialog with its day`);
  await shot(page, `${name}-card`);
  await page.click('dialog[open] .card-day button:has-text("No day")');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  ok(!(await openRows(page)).includes('MCP tools'), `${name}: a card with no day leaves the list`);
  // A change made elsewhere shows when the app comes back to the front after a minute.
  await api.post('/todos', { title: 'Ring the vet', day });
  await page.evaluate(() => {
    const real = Date.now;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Date.now = () => real() + 61_000;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1200);
  ok((await openRows(page)).includes('Ring the vet'), `${name}: a to-do added elsewhere shows when the app comes back`);
  // Open a to-do: its list.
  await row(page, 'Post the parcel').locator('.tl-name').click();
  await page.waitForTimeout(500);
  ok(/^#\/n\//.test(await page.evaluate(() => location.hash)), `${name}: a to-do opens its list`);
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.today-list');
  // Offline: a tick waits and is sent when the connection is back.
  await ctx.setOffline(true);
  await row(page, 'Post the parcel').locator('.tl-tick').click();
  await settle(page);
  ok(!(await openRows(page)).includes('Post the parcel'), `${name}: a tick made offline shows at once`);
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  let sent = false;
  for (let i = 0; i < 20 && !sent; i++) {
    await page.waitForTimeout(500);
    sent = !!(await api.get('/today')).todos.find((x) => x.title === 'Post the parcel')?.done;
  }
  ok(sent, `${name}: the offline tick is sent when back online`);
  // Everything done: one line, and the pill says ✓.
  for (let i = 0; i < 12; i++) {
    const tick = page.locator('.today-list .tl-sec .tl-tick').first();
    if (!(await tick.count())) break;
    await tick.click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(600);
  ok((await page.textContent('.today-list')).includes('All done for today') && (await page.textContent('.pl-pill[aria-selected="true"]')).includes('✓'), `${name}: all done is one line and the pill shows ✓`);
  await shot(page, `${name}-all-done`);
}

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };
await view('light', 'phone', PHONE, interact);
await view('light', 'desk', DESK, interact);
for (const theme of ['dark', 'eink']) for (const [v, vp] of [['phone', PHONE], ['desk', DESK]]) await view(theme, v, vp);

// The card's day on its board tile.
{
  await reset();
  const { page, ctx } = await open(browser, DESK, errors, { name: 'board' });
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.board');
  await settle(page);
  ok((await page.locator('.board li:has-text("MCP tools") .day-mark').textContent()).trim() === 'Today', 'board: a card for today has a "Today" mark');
  await shot(page, 'board');
  await ctx.close();
}

// An old saved pill that names "todos" and "habits" shows the Today list there (and Habits, as chosen).
{
  await reset();
  await api.put('/layout/today/pills', { pills: [{ id: 'old', name: 'Mine', icon: null, panels: ['todos', 'plan-week'] }] });
  const { page, ctx } = await open(browser, PHONE, errors, { name: 'old-pill' });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.click('.pl-pill:has-text("Mine")');
  await settle(page);
  ok(!!(await page.$('#pl-panels .today-list')) && !(await page.$('#pl-panels h2:text-is("To do today")')), 'old pill: a saved "todos" shows the Today list');
  await ctx.close();
  await api.call('DELETE', '/layout/today/pills');
}

// The flag off: the separate panels again.
{
  await api.put('/features/today-panel', { enabled: false });
  try {
    const { page, ctx } = await open(browser, PHONE, errors, { name: 'flag-off' });
    await page.goto(`${B}/#/today`);
    await page.waitForSelector('#pl-panels .habits-panel');
    await settle(page);
    ok(!(await page.$('.today-list')) && !!(await page.$('#pl-panels h2:text-is("To do today")')), 'flag off: To do today and Habits are back in the Today pill');
    await shot(page, 'flag-off');
    await ctx.close();
  } finally {
    await api.put('/features/today-panel', { enabled: true });
  }
}

// Leave the seeded data as it was for the other checks: no Guitar, no card days, no extra to-dos.
{
  const { card, dune } = await reset();
  for (const c of [card, dune]) await api.call('PATCH', `/tasks/${c.id}`, { day: null, done: null });
  const guitar = (await api.get('/habits')).find((h) => h.name === 'Guitar');
  if (guitar) await api.call('DELETE', `/habits/${guitar.id}`);
  const parcel = (await api.get('/today')).todos.find((x) => x.title === 'Post the parcel');
  if (parcel) await api.call('DELETE', `/todos/${parcel.id}`);
}
await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
