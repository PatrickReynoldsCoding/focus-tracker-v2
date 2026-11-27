// Browser check for a habit's weekdays (D68): in the habit dialog's settings, Mon–Sun chips with
// "Every day" when none is chosen; Tue and Thu saved; the Habits tab's level line says
// "3 a week · Tue, Thu"; the habit shows on Today (the Today list and the Today tab's count) only
// when today is one of its days (checked both ways: days with today's weekday, days without it);
// Plan my week offers + only on its days. A 390 px phone (light, touch) and E-ink at 1280 px, no
// sideways scroll, 44 px chips, no console errors. Needs a seeded server (seed.mjs); puts Run back.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/habit-days.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/habit-days-${name}.png`, fullPage: true });
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
const sideways = async (page, w, where) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= w + 1, `${where}: no sideways scroll`);

const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const idx = (day) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
const addDays = (day, k) => new Date(Date.parse(`${day}T12:00:00Z`) + k * 864e5).toISOString().slice(0, 10);

const features = await api.get('/features');
const was = (id) => features.find((f) => f.id === id)?.enabled;
const keep = ['desktop-pills', 'panel-restyle', 'habits', 'today-panel', 'plan-week'].map((id) => [id, was(id)]);
await api.put('/features/desktop-pills', { enabled: false });
for (const id of ['panel-restyle', 'habits', 'today-panel', 'plan-week']) await api.put(`/features/${id}`, { enabled: true });

const run = (await api.get('/habits')).find((h) => h.name === 'Run');
const todayDay = (await api.get('/today')).day;
const ti = idx(todayDay);
const tomorrow = (ti + 1) % 7;
const tueThuHasToday = KEYS[ti] === 'tue' || KEYS[ti] === 'thu';
console.log(`today is ${todayDay} (${LONG[ti]})`);
async function reset() {
  await api.call('PATCH', `/habits/${run.id}`, { days: null });
  await api.post(`/habits/${run.id}/check`, { count: 0 });
  await api.post(`/habits/${run.id}/not-today`, { on: false });
}

const dialog = (page) => page.locator('dialog[open]:has(.habit-dialog)');
const chip = (page, label) => dialog(page).locator(`.day-chips button[aria-label="${label}"]`);
const every = (page) => dialog(page).locator('.day-chips .day-every');
const todayRow = (page) => page.locator('.today-list .tl-row:has(.tl-title:text-is("Run"))');
async function today(page) {
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.today-list');
  await settle(page, 700);
}
/** The Today tab's count (0 when none shows). */
async function badge(page) {
  const b = page.locator('a[href="#/today"] .badge:visible').first();
  return (await b.count()) ? Number((await b.textContent()).trim()) : 0;
}
async function editRun(page) {
  await page.goto(`${B}/#/habits`);
  await page.waitForSelector('.habits-page .habit-item');
  await settle(page);
  await page.click('.habit-item button[aria-label="Edit Run"]');
  await dialog(page).waitFor();
  await dialog(page).locator('.day-picker').scrollIntoViewIfNeeded();
  await settle(page, 300);
}
/** Choose these weekdays (indexes) in the dialog and Save; waits for the server to have them. */
async function choose(page, days, phone) {
  await editRun(page);
  const tap = (loc) => (phone ? loc.tap() : loc.click());
  await tap(every(page));
  for (const i of days) await tap(chip(page, LONG[i]));
  const want = days.length ? [...days].sort((a, b) => a - b).map((i) => KEYS[i]).join(',') : null;
  await dialog(page).locator('button.primary:has-text("Save")').click();
  await dialog(page).waitFor({ state: 'detached' });
  ok(await until(async () => (await api.get(`/habits/${run.id}`)).days === want), `saved days ${want ?? 'every day'}`);
}
const levelLine = async (page) => (await page.locator('.habit-item:has(.habit-name:has-text("Run")) .habit-main > span.muted').last().textContent()).trim();

async function check(name, vp, opts) {
  const phone = vp === PHONE;
  await reset();
  const { page, ctx } = await open(browser, vp, errors, { name, ...opts });

  // Every day (as now): Run is on Today.
  await today(page);
  ok((await todayRow(page).count()) === 1, `${name}: every day: Run is on the Today list`);
  const b0 = await badge(page);

  // The dialog: "Every day" when none is chosen, then Tue and Thu.
  await editRun(page);
  ok((await every(page).getAttribute('aria-pressed')) === 'true', `${name}: "Every day" is on while no day is chosen`);
  ok((await dialog(page).locator('.day-chips .day-chip').count()) === 7, `${name}: seven weekday chips`);
  for (const c of await dialog(page).locator('.day-chips .chip').all()) {
    const box = await c.boundingBox();
    if (box.height < 44 - 0.5) ok(false, `${name}: chip ${await c.textContent()} is ${box.height} px tall`);
  }
  ok(true, `${name}: every chip is at least 44 px tall`);
  const tap = (loc) => (phone ? loc.tap() : loc.click());
  await tap(chip(page, 'Tuesday'));
  await tap(chip(page, 'Thursday'));
  ok((await chip(page, 'Tuesday').getAttribute('aria-pressed')) === 'true' && (await every(page).getAttribute('aria-pressed')) === 'false', `${name}: Tue on, "Every day" off`);
  ok((await dialog(page).locator('.day-picker').textContent()).includes('The weekly target stays the same'), `${name}: the hint says the weekly target stays`);
  await sideways(page, vp.width, `${name} dialog`);
  const pick = await dialog(page).locator('.day-picker').boundingBox();
  ok(pick.x >= 0 && pick.x + pick.width <= vp.width + 1, `${name}: the day picker fits the screen`);
  await shot(page, `${name}-dialog`);
  await dialog(page).locator('button.primary:has-text("Save")').click();
  await dialog(page).waitFor({ state: 'detached' });
  ok(await until(async () => (await api.get(`/habits/${run.id}`)).days === 'tue,thu'), `${name}: Save stores tue,thu`);
  await settle(page, 600);
  ok(await until(async () => (await levelLine(page)).includes('3 a week · Tue, Thu')), `${name}: the Habits tab says "3 a week · Tue, Thu"`);
  await shot(page, `${name}-habits-tab`);
  await today(page);
  ok((await todayRow(page).count()) === (tueThuHasToday ? 1 : 0), `${name}: Tue, Thu: Run ${tueThuHasToday ? 'is' : 'is not'} on Today (${LONG[ti]})`);

  // Days with today's weekday: on Today, and in the count.
  await choose(page, [ti], phone);
  await today(page);
  ok((await todayRow(page).count()) === 1, `${name}: days with today (${SHORT[ti]}): Run is on Today`);
  ok(await until(async () => (await badge(page)) === b0), `${name}: the Today count is as before (${b0})`);

  // Days without it: off Today, one fewer in the count.
  await choose(page, [tomorrow], phone);
  await today(page);
  ok((await todayRow(page).count()) === 0, `${name}: days without today (${SHORT[tomorrow]} only): Run is not on Today`);
  ok(await until(async () => (await badge(page)) === b0 - 1), `${name}: the Today count is one fewer (${b0 - 1})`);
  await sideways(page, vp.width, `${name} today`);
  await shot(page, `${name}-today-without`);

  // Plan my week: + Run only on its day.
  await page.goto(`${B}/#/plan`);
  await page.waitForSelector('.plan-page');
  await settle(page);
  await page.locator('.plan-chip', { hasText: 'Run' }).click();
  await settle(page, 300);
  ok((await page.locator('.plan-picker p').textContent()).includes(`3 a week · ${SHORT[tomorrow]}, only on those days`), `${name}: Plan my week says "3 a week · ${SHORT[tomorrow]}, only on those days"`);
  const adds = await page.locator('.plan-day:has(.plan-add:has-text("+ Run"))').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  ok(adds.every((l) => l.startsWith(LONG[tomorrow])), `${name}: + Run only on ${LONG[tomorrow]} (${adds.join('; ') || 'none this week'})`);
  const tomorrowDay = addDays(todayDay, 1);
  const tomorrowThisWeek = idx(tomorrowDay) !== 0; // tomorrow is Monday: next week
  if (tomorrowThisWeek) ok(adds.length === 1, `${name}: + Run on tomorrow's card`);
  await sideways(page, vp.width, `${name} plan`);
  await shot(page, `${name}-plan`);

  // Every day again.
  await choose(page, [], phone);
  ok(await until(async () => (await levelLine(page)) === 'Level 3 a week'), `${name}: the level line has no days again ("Level 3 a week")`);
  await today(page);
  ok((await todayRow(page).count()) === 1, `${name}: every day again: Run is back on Today`);
  await ctx.close();
}

try {
  await check('light-phone', PHONE, { touch: true });
  await check('eink-desk', DESK, { init: `try{localStorage.setItem('ft.theme','eink')}catch(e){}` });
} finally {
  await reset();
  for (const [id, on] of keep) if (on !== undefined) await api.put(`/features/${id}`, { enabled: on });
  await browser.close();
}
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`ok: screenshots in ${OUT}`);
