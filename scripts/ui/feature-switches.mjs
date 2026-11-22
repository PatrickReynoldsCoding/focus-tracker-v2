// Browser check for the switches `habits` and `insights` (v0.39.0, Settings → Features, per profile,
// on by default). Each off, then both off: no tab (side bar, phone bar, More), no panel in Add panel,
// pills or Today, no habit prompts in Notification settings, no Habits sub-tab or habit tile in
// Insights, no Insights way in from Settings (the Log tab is back); a layout and pill saved with the
// habit panel are skipped quietly; the address of a hidden tab does not crash; data comes back when
// switched on. Light and E-ink at 390 and 1280 px. Needs a seeded server (seed.mjs: habits Stretch and Run).
// Usage: FT_URL=http://localhost:8787 node scripts/ui/feature-switches.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/feature-switches-${name}.png` });
const settle = (page) => page.waitForTimeout(700);
const noHScroll = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1);
const text = (page) => page.evaluate(() => document.querySelector('#app')?.innerText ?? document.body.innerText);

const habits = await api.get('/habits');
ok(habits.length >= 1, 'the seed has habits');
await api.put('/features/habits', { enabled: true });
await api.put('/features/insights', { enabled: true });
await api.put('/features/today-pills', { enabled: true });
await api.put('/features/add-panel', { enabled: true });
// A pill that names the habit panel, saved before it goes off.
await api.put('/layout/today/pills', { pills: [
  { id: 'fs-a', name: 'FS Habits', icon: null, panels: ['habits', 'plan-week'] },
  { id: 'fs-b', name: 'FS Mix', icon: null, panels: ['habits', 'todos'] },
] });

const links = (page, href) => page.locator(`nav a[href="#/${href}"]`).count();
const tabsHave = async (page, phone, href) => {
  if (!phone) return (await links(page, href)) > 0;
  if ((await links(page, href)) > 0) return true;
  const more = page.locator('nav[aria-label=Main] button:has-text("More")');
  if (await more.count()) {
    await more.click();
    const n = await page.locator(`nav[aria-label=More] a[href="#/${href}"]`).count();
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5).catch(() => {});
    return n > 0;
  }
  return false;
};

async function run(name, viewport, opts, off) {
  const phone = viewport.width < 600;
  const { page, ctx } = await open(browser, viewport, errors, { name, touch: phone, init: opts.eink ? () => localStorage.setItem('ft.theme', 'eink') : undefined });
  await settle(page);
  const hOff = off.includes('habits');
  const iOff = off.includes('insights');
  ok((await tabsHave(page, phone, 'habits')) === !hOff, `${name}: Habits tab ${hOff ? 'gone' : 'shown'}`);
  ok((await tabsHave(page, phone, 'insights')) === !iOff, `${name}: Insights tab ${iOff ? 'gone' : 'shown'}`);
  ok((await tabsHave(page, phone, 'log')) === iOff, `${name}: the Log tab ${iOff ? 'is back' : 'stays replaced'}`);

  // Today: the habit panel, the pills and Add panel.
  await page.goto(`${B}/#/today`);
  await settle(page);
  const t = await text(page);
  if (hOff) ok(!/Stretch|Run \(|Habit/.test(t) || !/Stretch/.test(t), `${name}: no habit on Today`);
  else ok(/Stretch/.test(t), `${name}: the habit shows on Today`);
  ok(await noHScroll(page), `${name}: Today has no sideways scroll`);
  await shot(page, `${name}-today`);
  if (hOff) {
    const st = await api.get('/status');
    ok(st.habits_left.length === 0 && !(st.today_list?.items ?? []).some((x) => x.kind === 'habit'), `${name}: status has no habits`);
    ok((await api.get('/today')).habits.length === 0, `${name}: GET /today has no habits`);
  }
  // The saved pills that name the habit panel still open, with the other panels.
  for (const pill of ['FS Habits', 'FS Mix']) {
    const b = page.locator('.pl-pill, [role=tab]', { hasText: pill }).first();
    if (await b.count()) {
      await b.click();
      await settle(page);
      ok(!(await text(page)).includes('Something went wrong'), `${name}: pill ${pill} opens`);
    }
  }
  // Add panel lists no habits panel while it is off.
  const add = page.locator('.pl-add, .lg-add-panel button').first();
  if (await add.count()) {
    await add.click();
    await page.waitForSelector('dialog[open] .ap-list');
    const list = await page.locator('dialog[open] .ap-list').innerText();
    if (hOff) ok(!/Habits/.test(list), `${name}: Add panel has no Habits`);
    await page.keyboard.press('Escape');
    await settle(page);
  }

  // The hidden tab's address does not crash.
  for (const [route, off1] of [['habits', hOff], ['insights', iOff], ['plan', false]]) {
    await page.goto(`${B}/#/${route}`);
    await settle(page);
    ok((await page.locator('.shell').count()) === 1 && !(await text(page)).includes('Something went wrong'), `${name}: #/${route} opens${off1 ? ' (another page)' : ''}`);
    if (route === 'habits' && !hOff) ok(/Stretch/.test(await text(page)), `${name}: Habits tab lists habits`);
    if (route === 'plan') ok(!hOff || !/Habit sessions/.test(await text(page)), `${name}: Plan my week ${hOff ? 'has no habit sessions' : 'ok'}`);
    if (route === 'insights' && !iOff) {
      const sub = await page.locator('.subtabs button').allInnerTexts();
      ok(hOff ? !sub.includes('Habits') : sub.includes('Habits'), `${name}: Insights ${hOff ? 'has no' : 'has a'} Habits sub-tab`);
      await page.click('.subtabs button:has-text("Week")');
      await settle(page);
      const w = await text(page);
      ok(hOff ? !/Habit sessions|Habits against target/.test(w) : /Habit sessions/.test(w), `${name}: Insights week ${hOff ? 'has no' : 'has'} habit parts`);
      await shot(page, `${name}-insights`);
    }
  }
  // Settings.
  await page.goto(`${B}/#/settings`);
  await settle(page);
  const s = await text(page);
  ok(iOff ? !/Open Insights/.test(s) : /Open Insights/.test(s), `${name}: Settings ${iOff ? 'does not mention' : 'links to'} Insights`);
  ok(hOff ? !/Habit prompts/.test(s) : /Habit prompts/.test(s), `${name}: notification settings ${hOff ? 'have no' : 'have'} Habit prompts`);
  ok(/Habits/.test(s) && /Insights/.test(s), `${name}: Features lists both switches`);
  ok(await noHScroll(page), `${name}: Settings has no sideways scroll`);
  await shot(page, `${name}-settings`);
  await ctx.close();
}

for (const [label, off] of [['both-on', []], ['habits-off', ['habits']], ['insights-off', ['insights']], ['both-off', ['habits', 'insights']]]) {
  await api.put('/features/habits', { enabled: !off.includes('habits') });
  await api.put('/features/insights', { enabled: !off.includes('insights') });
  for (const [vname, viewport] of [['390', { width: 390, height: 800 }], ['1280', { width: 1280, height: 900 }]]) {
    for (const [tname, opts] of [['light', {}], ['eink', { eink: true }]]) await run(`${label}-${vname}-${tname}`, viewport, opts, off);
  }
}

// Data stays while off and comes back.
await api.put('/features/habits', { enabled: true });
await api.put('/features/insights', { enabled: true });
ok((await api.get('/habits')).length === habits.length, 'habits are all back when switched on');
await api.call('DELETE', '/layout/today/pills').catch(() => {});
ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
