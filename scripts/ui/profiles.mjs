// Browser check for profiles (D35): the profile dropdown in the header (every profile, New profile…,
// Manage profiles…), switching (the default follows), the New profile dialog (name, colour, default
// settings or a copy of another profile's), feature switches per profile, Settings' scope tags,
// Manage profiles (rename, reorder, colour, default, follow the open profile, delete only after typing
// the name, Undo, Recently deleted with Restore and Delete now), and a device left in a deleted
// profile. Light, dark and E-ink at 390 and 1280 px.
// Needs a seeded server (seed.mjs or ui-smoke's seed); removes the profiles it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/profiles.mjs
import { mkdirSync } from 'node:fs';
import { apiCtx, B, launch, open as openPage, OUT } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const browser = await launch();
const api = await apiCtx(browser);
const errors = [];
// Say which address answered 404 (the console only says that one did).
async function open(...args) {
  const r = await openPage(...args);
  r.page.on('response', (res) => res.status() === 404 && console.log(`404 ${res.request().method()} ${res.url()}`));
  return r;
}
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};
const shot = (page, name, fullPage = false) => page.screenshot({ path: `${OUT}/profiles-${name}.png`, fullPage });
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 860 };
const NAMES = ['Side projects', 'Fresh start', 'Renamed side'];
const theme = (t) => `try{localStorage.setItem('ft.theme','${t}');if(!sessionStorage.getItem('m')){sessionStorage.setItem('m','1');localStorage.setItem('ft.mode','personal')}}catch(e){}`;
const flagIn = async (id, mode) => (await api.call('GET', `/features?mode=${mode}`)).find((f) => f.id === id).enabled;
const shown = (page) => page.$eval('.profile-switch', (s) => s.options[s.selectedIndex].text);
const choose = (page, label) => page.selectOption('.profile-switch', { label });
const menu = (page, which) => page.selectOption('.profile-switch', which === 'new' ? '__new__' : '__manage__');

async function cleanUp() {
  const all = await api.get('/profiles');
  for (const p of all.profiles) if (NAMES.some((n) => p.label.startsWith(n))) await api.post(`/profiles/${p.id}/delete`, { confirm: p.label });
  for (const p of (await api.get('/profiles')).deleted) if (NAMES.some((n) => p.label.startsWith(n))) await api.post(`/profiles/${p.id}/purge`, { confirm: p.label });
  await api.put('/profiles/default', { id: 'personal' });
  await api.put('/profiles/follow-open', { on: true });
  for (const m of ['personal', 'work']) await api.call('PUT', `/features/plan-week?mode=${m}`, { enabled: true });
}
await cleanUp();

// 1. The dropdown, switching, and new profiles (phone, light).
{
  await api.call('PUT', '/features/plan-week?mode=personal', { enabled: false }); // to see it copied
  const { page, ctx } = await open(browser, PHONE, errors, { name: 'phone-light', init: theme('light') });
  await page.goto(`${B}/#/today`);
  await settle(page);
  ok((await shown(page)) === 'Personal', 'the header shows the open profile');
  const opts = await page.$$eval('.profile-switch option', (els) => els.map((e) => e.textContent.trim()));
  ok(opts[0] === 'Personal' && opts[1] === 'Work' && opts.includes('＋ New profile…') && opts.includes('⚙ Manage profiles…'), `the dropdown lists every profile, then New and Manage (${opts.join(' | ')})`);
  await choose(page, 'Work');
  await settle(page, 700);
  ok((await shown(page)) === 'Work', 'choosing Work opens it');
  ok((await page.evaluate(() => localStorage.getItem('ft.mode'))) === 'work', 'the choice is kept on the device');
  ok((await api.get('/profiles')).default === 'work', 'the default follows the open profile (menu bar, widgets)');
  await choose(page, 'Personal');
  await settle(page, 700);

  await menu(page, 'new');
  await page.waitForSelector('dialog[open] .profile-form');
  ok((await shown(page)) === 'Personal', 'the dropdown goes back to the open profile');
  ok(await page.isDisabled('dialog[open] button.primary'), 'Make profile waits for a name');
  ok(await page.isChecked('dialog[open] input[name=start] >> nth=0'), 'Default settings is chosen first');
  await page.fill('dialog[open] input[placeholder="Side projects"]', 'Side projects');
  await page.click('dialog[open] .profile-swatches button[aria-label=Purple]');
  await page.selectOption('dialog[open] select[aria-label="Profile to copy settings from"]', 'personal');
  ok(await page.isChecked('dialog[open] input[name=start] >> nth=1'), 'choosing a profile to copy from picks Copy settings');
  await settle(page, 300);
  await shot(page, 'phone-light-new');
  await page.click('dialog[open] button.primary');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  await settle(page, 800);
  ok((await shown(page)) === 'Side projects', 'the new profile opens');
  const side = (await api.get('/profiles')).profiles.find((p) => p.label === 'Side projects');
  ok(side && side.color === '#7a4bb5', 'it has the colour picked');
  ok((await flagIn('plan-week', side.id)) === false, 'Personal’s switches were copied (plan-week off)');
  ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === '#7a4bb5', 'the app takes its colour');
  ok((await api.call('GET', `/projects?mode=${side.id}`)).length === 0, 'no data came with it');
  await shot(page, 'phone-light-new-today');

  // Settings: tags say whom each section is for; Features switches this profile only.
  await page.goto(`${B}/#/settings/all`);
  await page.waitForSelector('.scope-tag');
  await settle(page);
  const tags = await page.$$eval('.scope-tag', (els) => els.map((e) => e.textContent));
  ok(tags.includes('This profile') && tags.includes('Every profile') && tags.includes('This device'), `Settings marks each section (${[...new Set(tags)].join(', ')})`);
  const scopeOf = async (id) => page.$eval(`#set-${id}`, (e) => e.dataset.scope ?? null);
  ok((await scopeOf('notifications')) === 'profile' && (await scopeOf('features')) === 'profile' && (await scopeOf('pomodoro')) === 'profile', 'notifications, features and the Pomodoro are this profile’s');
  ok((await scopeOf('general')) === 'all' && (await scopeOf('profiles')) === 'all' && (await scopeOf('appearance')) === 'device', 'the time zone and profiles are every profile’s, the theme this device’s');
  ok((await page.textContent('.page-head .tag')) === 'Side projects', 'the page says which profile is open');
  const box = page.getByRole('checkbox', { name: /^Plan my week/ });
  await box.check();
  await settle(page, 600);
  ok((await flagIn('plan-week', side.id)) === true && (await flagIn('plan-week', 'personal')) === false, 'a switch in Features changes this profile only');
  await shot(page, 'phone-light-settings', true);

  // A new profile with the default settings.
  await menu(page, 'new');
  await page.waitForSelector('dialog[open] .profile-form');
  await page.fill('dialog[open] input[placeholder="Side projects"]', 'Fresh start');
  await page.click('dialog[open] button.primary');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  await settle(page, 600);
  const fresh = (await api.get('/profiles')).profiles.find((p) => p.label === 'Fresh start');
  ok(fresh && (await flagIn('plan-week', fresh.id)) === true, 'default settings: plan-week on, as by default');
  ok(!/^\/(p|n|w|pn)\//.test(await page.evaluate(() => location.hash.slice(1))), 'switching leaves no page of the other profile open');
  await ctx.close();
}

// 2. Manage profiles on a computer: rename, reorder, colour, default, follow, delete with Undo, Recently deleted.
{
  const { page, ctx } = await open(browser, DESK, errors, { name: 'desk-light', init: theme('light') });
  await page.goto(`${B}/#/today`);
  await settle(page);
  ok((await shown(page)) === 'Personal', 'a new device opens Personal');
  await menu(page, 'manage');
  await page.waitForSelector('dialog[open] .profile-list');
  await settle(page);
  await shot(page, 'desk-light-manage');
  const row = page.locator('dialog[open] .profile-row', { hasText: 'Side projects' });
  await row.locator('.inline-edit').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Renamed side');
  await page.keyboard.press('Enter');
  await settle(page, 700);
  const renamed = page.locator('dialog[open] .profile-row', { hasText: 'Renamed side' });
  ok((await renamed.count()) === 1, 'renamed in place');
  ok((await page.$$eval('.profile-switch option', (els) => els.map((e) => e.textContent))).includes('Renamed side'), 'the dropdown shows the new name');
  await renamed.locator('button[aria-label="Move Renamed side up"]').click();
  await settle(page, 700);
  const order = (await api.get('/profiles')).profiles.map((p) => p.label);
  ok(order.indexOf('Renamed side') === 1, `▲ moves it up (${order.join(', ')})`);
  await renamed.locator('.profile-colour-btn').click();
  await renamed.locator('.profile-swatches button[aria-label=Orange]').click();
  await settle(page, 700);
  ok((await api.get('/profiles')).profiles.find((p) => p.label === 'Renamed side').color === '#c0562b', 'recoloured');
  // Make default, with "the profile I open becomes the default" off so it stays.
  await page.uncheck('dialog[open] .profile-follow input');
  await settle(page, 500);
  await renamed.locator('button:has-text("Make default")').click();
  await settle(page, 700);
  let now = await api.get('/profiles');
  ok(now.profiles.find((p) => p.id === now.default).label === 'Renamed side' && now.follow_open === false, 'made the default, and it stays the default');
  ok((await renamed.locator('.tag:has-text("Default")').count()) === 1, 'the list shows the default');
  await shot(page, 'desk-light-manage-edited');
  const sideId = now.default;

  // Delete: a clear warning and the name typed first; Undo brings it back.
  await api.post(`/projects?mode=${sideId}`, { name: 'Will go' });
  await renamed.locator('button:has-text("Delete…")').click();
  await page.waitForSelector('dialog[open] .profile-warning');
  await settle(page);
  const warn = await page.textContent('dialog[open] .profile-warning');
  ok(/Everything in Renamed side goes/.test(warn) && /1 project/.test(warn), `the warning says what goes (“${warn.trim()}”)`);
  const del = page.locator('dialog[open] button.danger:has-text("Delete Renamed side")');
  ok(await del.isDisabled(), 'Delete waits for the name');
  await page.fill('dialog[open] label:has-text("to confirm") input', 'Renamed');
  ok(await del.isDisabled(), 'part of the name is not enough');
  await page.fill('dialog[open] label:has-text("to confirm") input', 'renamed side');
  await shot(page, 'desk-light-delete');
  await del.click();
  await settle(page, 900);
  now = await api.get('/profiles');
  ok(!now.profiles.some((p) => p.label === 'Renamed side') && now.default === 'personal', 'deleted, and the default went back to Personal');
  ok(now.deleted.some((p) => p.id === sideId), 'it waits in Recently deleted');
  ok((await page.textContent('dialog[open] .profile-undo')).includes('Renamed side deleted'), 'Manage profiles offers Undo (the toast is under the dialog)');
  await page.click('dialog[open] .profile-undo button:has-text("Undo")');
  await settle(page, 900);
  now = await api.get('/profiles');
  ok(now.profiles.some((p) => p.id === sideId) && now.default === sideId, 'Undo brings it back, as the default again');
  ok((await api.call('GET', `/projects?mode=${sideId}`)).some((p) => p.name === 'Will go'), 'with its data');
  // Delete again, then Restore and Delete now from Recently deleted.
  await renamed.locator('button:has-text("Delete…")').click();
  await page.fill('dialog[open] label:has-text("to confirm") input', 'Renamed side');
  await page.click('dialog[open] button.danger:has-text("Delete Renamed side")');
  await settle(page, 900);
  await page.waitForSelector('dialog[open] .profile-deleted');
  await shot(page, 'desk-light-deleted');
  await page.click('dialog[open] .profile-deleted button:has-text("Delete now…")');
  await page.waitForSelector('dialog[open] >> text=This cannot be undone');
  await page.fill('dialog[open] label:has-text("to confirm") >> nth=-1', 'Renamed side');
  await page.click('dialog[open] button.danger:has-text("Delete for good")');
  await settle(page, 900);
  now = await api.get('/profiles');
  ok(!now.deleted.some((p) => p.id === sideId) && !now.profiles.some((p) => p.id === sideId), 'Delete now removes it for good');
  await page.check('dialog[open] .profile-follow input');
  await settle(page, 400);
  await page.keyboard.press('Escape');
  await settle(page);
  await ctx.close();
}

// 3. A device still in a profile deleted elsewhere opens the default one.
{
  const fresh = (await api.get('/profiles')).profiles.find((p) => p.label === 'Fresh start');
  const { page, ctx } = await open(browser, PHONE, errors, { name: 'gone', init: `try{if(!sessionStorage.getItem('x')){sessionStorage.setItem('x','1');localStorage.setItem('ft.mode','${fresh.id}')}}catch(e){}` });
  await page.goto(`${B}/#/today`);
  await settle(page);
  ok((await shown(page)) === 'Fresh start', 'the device is in Fresh start');
  await api.post(`/profiles/${fresh.id}/delete`, { confirm: 'Fresh start' });
  // The page's next request learns it is gone.
  page.removeAllListeners('console');
  page.on('console', (m) => m.type() === 'error' && !/400 \(Bad Request\)/.test(m.text()) && errors.push(`gone: ${m.text()}`));
  await page.goto(`${B}/#/projects`);
  await page.waitForFunction(() => localStorage.getItem('ft.mode') === 'personal', null, { timeout: 5000 });
  await settle(page, 800);
  ok((await shown(page)) === 'Personal', 'it opens the default profile instead, with a message');
  await ctx.close();
}

// 4. Every theme at both widths: the header, New profile, Manage profiles and Settings.
for (const t of ['light', 'dark', 'eink'])
  for (const [v, vp] of [
    ['phone', PHONE],
    ['desk', DESK],
  ]) {
    const { page, ctx } = await open(browser, vp, errors, { name: `${t}-${v}`, init: theme(t) });
    await page.goto(`${B}/#/today`);
    await settle(page, 600);
    const b = await page.locator('.profile-switch').boundingBox();
    const undo = await page.locator('.top .undo').boundingBox();
    ok(b && undo && b.x + b.width <= undo.x, `${t} ${v}: the profile dropdown fits before Undo`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${t} ${v}: no sideways scroll`);
    await shot(page, `${t}-${v}-header`);
    await menu(page, 'new');
    await page.waitForSelector('dialog[open] .profile-form');
    await settle(page);
    await shot(page, `${t}-${v}-new`);
    await page.keyboard.press('Escape');
    await settle(page, 300);
    await menu(page, 'manage');
    await page.waitForSelector('dialog[open] .profile-list');
    await settle(page);
    ok(await page.evaluate(() => { const d = document.querySelector('dialog[open]'); return d.scrollWidth <= d.clientWidth + 1; }), `${t} ${v}: Manage profiles fits its dialog`);
    await shot(page, `${t}-${v}-manage`);
    await page.keyboard.press('Escape');
    await settle(page, 500); // closing a dialog steps Back in the history: let it, then go
    await page.goto(`${B}/#/settings/all`);
    await page.waitForSelector('.scope-tag');
    await settle(page);
    ok(await page.evaluate(() => location.hash === '#/settings/all'), `${t} ${v}: on Settings`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${t} ${v}: Settings has no sideways scroll`);
    const overlap = await page.$$eval('.settings-section[data-scope]', (secs) =>
      secs.some((s) => {
        const tag = s.querySelector('.scope-tag')?.getBoundingClientRect();
        const h = s.querySelector('h2')?.getBoundingClientRect();
        if (!tag || !h) return false;
        const range = document.createRange();
        range.selectNodeContents(s.querySelector('h2'));
        const text = range.getBoundingClientRect();
        return text.right > tag.left && text.top < tag.bottom && text.bottom > tag.top;
      }),
    );
    ok(!overlap, `${t} ${v}: no scope tag covers a heading`);
    await shot(page, `${t}-${v}-settings`);
    await ctx.close();
  }

await cleanUp();
await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
