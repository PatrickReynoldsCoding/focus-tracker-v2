// Browser check for "this profile or all profiles" in Settings (D46): the choice under the headings of
// Features, Notifications, Pomodoro and Link types (and in Today settings), a change made for All
// profiles reaching another profile, the question naming the profiles that had their own value (and
// No leaving everything as it was), "Own value" with "Use the global value" after a change for this
// profile only, the count of profiles with their own value in All profiles mode, a reload starting at
// "<profile> only" again; light, dark and E-ink at 1280 and 390 px, no sideways scroll, no console errors.
// Needs a seeded server; makes a profile "Scope check" and removes it, and puts the values back.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/setting-scope.mjs
import { mkdirSync } from 'node:fs';
import { apiCtx, launch, open, OUT } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const browser = await launch();
const api = await apiCtx(browser);
const errors = [];
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};
const shot = (page, name, fullPage = false) => page.screenshot({ path: `${OUT}/setting-scope-${name}.png`, fullPage });
const settle = (page) => page.waitForTimeout(700);
const noHScroll = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1);
const NAME = 'Scope check';
const FLAG = 'category-buttons';

const TOUCHED = [`features.${FLAG}`, 'notify.reminders', 'pomodoro.work', 'today-view.focusCard'];
// Personal's own values of what this check changes, put back at the end.
const kept = Object.fromEntries((await api.get('/setting-scope')).filter((s) => TOUCHED.includes(s.id)).map((s) => [s.id, s.own ? s.value : undefined]));

async function cleanUp() {
  for (const p of (await api.get('/profiles')).profiles) if (p.label === NAME) await api.post(`/profiles/${p.id}/delete`, { confirm: p.label });
  for (const p of (await api.get('/profiles')).deleted) if (p.label === NAME) await api.post(`/profiles/${p.id}/purge`, { confirm: p.label });
  // No values for all profiles of what this check changes, and Personal's own values as they were.
  for (const id of TOUCHED) {
    await api.put(`/setting-scope/${id}`, { value: null, scope: 'all' });
    if (kept[id] !== undefined && kept[id] !== null) await api.put(`/setting-scope/${id}`, { value: kept[id] });
  }
}

await cleanUp();
const other = (await api.post('/profiles', { label: NAME })).profile.id;
const flagIn = async (mode) => (await api.get(`/features?mode=${mode}`)).find((f) => f.id === FLAG).enabled;
const stateIn = async (id, mode = 'personal') => (await api.get(`/setting-scope?mode=${mode}`)).find((s) => s.id === id);

// The other profile has its own value for the switch (off, the default).
await api.put(`/features/${FLAG}?mode=${other}`, { enabled: false });
ok((await stateIn(`features.${FLAG}`, other)).own, 'the other profile has its own value for the switch');

const featureRow = (page) => page.locator('#set-features li', { hasText: 'Category buttons' });
const featureBox = (page) => featureRow(page).locator('input[type=checkbox]');

// 1. Computer, light: Features for All profiles, with the question.
{
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name: 'desk-light' });
  await page.goto(`${new URL(page.url()).origin}/#/settings`);
  await page.waitForSelector('#set-features .scope-choice');
  await settle(page);
  const choice = page.locator('#set-features .scope-choice');
  ok((await choice.locator('[role=radio][aria-checked=true]').innerText()).includes('only'), 'Features start at “Personal only”');
  ok((await page.locator('.scope-choice').count()) >= 3, 'Features, Notifications and Pomodoro each have the choice');
  await choice.locator('[role=radio]', { hasText: 'All profiles' }).click();
  ok((await choice.innerText()).includes('Each change goes to every profile'), 'All profiles says where changes go');
  const owners = (await stateIn(`features.${FLAG}`)).profiles.length;
  ok((await featureRow(page).locator('.scope-others').innerText()).includes(`${owners} with own value`), `All profiles mode counts the profiles with their own value (${owners})`);
  await shot(page, 'desk-light-features-all');

  // No: nothing changes.
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    d.dismiss();
  });
  const before = await featureBox(page).isChecked();
  ok(before === (await flagIn('personal')), 'the switch shows Personal’s value');
  await featureBox(page).click();
  await settle(page);
  ok(asked.includes(NAME) && asked.includes(`${owners} of them`), `the question names the profile with its own value (“${asked.split('\n')[0]}”)`);
  ok((await featureBox(page).isChecked()) === before, 'No puts the switch back');
  ok((await flagIn(other)) === false && (await flagIn('personal')) === before, 'No changes nothing');

  // Yes: every profile.
  page.once('dialog', (d) => d.accept());
  await featureBox(page).click();
  await settle(page);
  ok((await flagIn(other)) === !before && (await flagIn('personal')) === !before, 'All profiles changes the switch in every profile');
  ok(!(await stateIn(`features.${FLAG}`, other)).own, 'the other profile no longer has its own value');

  // This profile only: an own value with its badge, then Use the global value.
  await choice.locator('[role=radio]', { hasText: 'only' }).click();
  await featureBox(page).click();
  await settle(page);
  ok((await flagIn('personal')) === before && (await flagIn(other)) === !before, 'Personal only changes Personal');
  await page.waitForSelector('#set-features .scope-own');
  ok((await featureRow(page).locator('.scope-own').innerText()) === 'Own value', 'the switch is marked “Own value”');
  await shot(page, 'desk-light-features-own');
  await featureRow(page).locator('.scope-use-global').click();
  await settle(page);
  ok((await flagIn('personal')) === !before, 'Use the global value brings the global value back');
  ok((await featureRow(page).locator('.scope-own').count()) === 0, 'the mark is gone');

  // From here on, say yes to the question when it comes.
  page.on('dialog', (d) => d.accept());

  // Notifications for all.
  const ns = page.locator('#set-notifications');
  await ns.locator('.scope-choice [role=radio]', { hasText: 'All profiles' }).click();
  const reminders = ns.locator('label', { hasText: 'Reminders' }).locator('input[type=checkbox]');
  await reminders.click();
  await settle(page);
  ok((await api.get(`/notification-settings?mode=${other}`)).reminders === false, 'Notifications for All profiles reach the other profile');

  // Pomodoro: a global value, then this profile's own.
  const po = page.locator('#set-pomodoro');
  await po.locator('.scope-choice [role=radio]', { hasText: 'All profiles' }).click();
  const work = po.locator('label', { hasText: 'Work (min)' }).locator('input');
  await work.fill('30');
  await work.blur();
  await settle(page);
  ok((await api.get(`/pomodoro?mode=${other}`)).config.work === 30, 'a Pomodoro length for All profiles');
  await po.locator('.scope-choice [role=radio]', { hasText: 'only' }).click();
  await po.locator('label', { hasText: 'Work (min)' }).locator('input').fill('40');
  await po.locator('label', { hasText: 'Work (min)' }).locator('input').blur();
  await settle(page);
  ok((await api.get('/pomodoro')).config.work === 40 && (await api.get(`/pomodoro?mode=${other}`)).config.work === 30, 'and one for Personal only');
  ok((await po.locator('.scope-own').count()) === 1, 'the Pomodoro length is marked “Own value”');
  await shot(page, 'desk-light-pomodoro', false);

  // A reload starts at "Personal only" again.
  await page.reload();
  await page.waitForSelector('#set-features .scope-choice');
  ok((await page.locator('#set-pomodoro .scope-choice [role=radio][aria-checked=true]').innerText()).includes('only'), 'after a reload every section is back to “Personal only”');
  ok(await noHScroll(page), 'no sideways scroll at 1280 px');
  await ctx.close();
}

// 2. Today settings: the choice for the view switches.
{
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name: 'phone-today', touch: true });
  await settle(page);
  const gear = page.locator('button.pl-gear');
  if (await gear.count()) {
    await gear.first().click();
    await page.waitForSelector('.pl-settings .scope-choice');
    const ch = page.locator('.pl-settings .scope-choice');
    await ch.locator('[role=radio]', { hasText: 'All profiles' }).click();
    await page.locator('.pl-settings [role=radiogroup][aria-label="Focus card"] [role=radio]', { hasText: 'Full' }).click();
    await settle(page);
    ok((await api.get(`/layout/today?mode=${other}`)).view.focusCard === 'full', 'Today settings: the focus card for All profiles reaches the other profile');
    await shot(page, 'phone-today-settings');
    await page.locator('.pl-settings [role=radiogroup][aria-label="Focus card"] [role=radio]', { hasText: 'Compact' }).click();
    await settle(page);
  } else console.log('skip - no pill row on this server (today-pills off)');
  await ctx.close();
}

// 3. Looks: light, dark and E-ink at 1280 and 390 px, with a mark and a count on screen.
await api.put(`/setting-scope/features.${FLAG}`, { value: true, scope: 'all' });
await api.put(`/setting-scope/features.${FLAG}`, { value: false });
await api.put(`/features/${FLAG}?mode=${other}`, { enabled: false });
for (const [vname, viewport] of [
  ['desk', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
]) {
  for (const theme of ['light', 'dark', 'eink']) {
    const name = `${vname}-${theme}`;
    const { page, ctx } = await open(browser, viewport, errors, {
      name,
      touch: vname === 'phone',
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      init: theme === 'eink' ? () => localStorage.setItem('ft.theme', 'eink') : theme === 'dark' ? () => localStorage.setItem('ft.theme', 'dark') : undefined,
    });
    await page.goto(`${new URL(page.url()).origin}/#/settings`);
    await page.waitForSelector('#set-features .scope-choice');
    await settle(page);
    await featureRow(page).scrollIntoViewIfNeeded();
    await settle(page);
    ok((await featureRow(page).locator('.scope-own').count()) === 1, `${name}: the mark shows`);
    await shot(page, `${name}-features`);
    await page.locator('#set-notifications .scope-choice [role=radio]', { hasText: 'All profiles' }).click();
    await page.locator('#set-notifications').scrollIntoViewIfNeeded();
    await settle(page);
    await shot(page, `${name}-notifications-all`);
    ok(await noHScroll(page), `${name}: no sideways scroll`);
    // The choice fits: its buttons are inside the card.
    const fits = await page.$$eval('.scope-choice', (els) => els.every((e) => e.getBoundingClientRect().right <= (e.closest('.card')?.getBoundingClientRect().right ?? innerWidth) + 1));
    ok(fits, `${name}: the choice stays inside its card`);
    await ctx.close();
  }
}

await cleanUp();
await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
