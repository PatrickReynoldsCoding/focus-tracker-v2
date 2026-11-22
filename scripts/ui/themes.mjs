// Colour themes (D61): every theme at 390 and 1280 px (Today, a project page with its card dialog, Files, Insights, Settings → Appearance),
// the page background matching the theme, no console errors, tapping a swatch, follow my phone (light by day, dark by night, own pair),
// the E-ink switch, a profile's own theme in Manage profiles with an instant switch and no flash on reload. Needs a seeded server;
// makes and removes the profile "Theme check".
import { apiCtx, launch, open, B, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });
const IDS = { midnight: '#151514', paper: '#f6f5f1', forest: '#121a16', ocean: '#0f1a22', sunset: '#1c1514', berry: '#1a1420', sand: '#f3eee4', slate: '#181a1f' };
const toRgb = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
const fails = [];
const check = (ok, what) => (ok ? console.log('ok  ', what) : (fails.push(what), console.log('FAIL', what)));
const browser = await launch();
const api = await apiCtx(browser);
const errors = [];
const projects = await api.get('/projects');
const proj = projects.find((p) => p.name === 'Focus Tracker v2') ?? projects[0];
const bgOf = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const attr = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

for (const [w, h] of [[390, 844], [1280, 800]]) {
  for (const [id, bg] of Object.entries(IDS)) {
    const { page, ctx } = await open(browser, { width: w, height: h }, errors, { name: `${id}@${w}`, init: `try{localStorage.setItem('ft.theme','${id}');localStorage.setItem('ft.follow','0')}catch(e){}` });
    check((await attr(page)) === id && (await bgOf(page)) === toRgb(bg), `${id} at ${w}: data-theme and page background`);
    await page.goto(`${B}/#/today`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/th-${id}-${w}-today.png` });
    await page.goto(`${B}/#/p/${proj.id}`);
    await page.waitForTimeout(800);
    const card = page.locator('.task, .card-tile, [data-card-id], .board-card').first();
    if (await card.count()) {
      await card.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: `${OUT}/th-${id}-${w}-project.png` });
    await page.keyboard.press('Escape');
    await page.goto(`${B}/#/files`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/th-${id}-${w}-files.png` });
    await page.goto(`${B}/#/insights`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/th-${id}-${w}-insights.png` });
    await page.goto(`${B}/#/settings/all`);
    await page.waitForSelector('.appearance');
    await page.locator('.appearance').screenshot({ path: `${OUT}/th-${id}-${w}-appearance.png` });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${id} at ${w}: no sideways scroll`);
    await ctx.close();
  }
}

// The picker, follow my phone and E-ink, at 390 px.
{
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name: 'picker', colorScheme: 'light' });
  await page.goto(`${B}/#/settings/all`);
  await page.waitForSelector('.theme-swatch-btn');
  check((await page.locator('.theme-swatch-btn').count()) === 8, 'eight swatches');
  check((await page.locator('.theme-follow input').isChecked()) === true, 'follow my phone is on by default');
  check((await attr(page)) === 'paper', 'light phone shows Paper');
  await page.locator('.theme-follow input').uncheck();
  await page.click('[data-theme-id=forest]');
  check((await attr(page)) === 'forest' && (await bgOf(page)) === toRgb(IDS.forest), 'tapping Forest applies it at once');
  check((await page.evaluate(() => localStorage.getItem('ft.follow'))) === '0', 'a swatch turns follow off');
  await page.reload();
  await page.waitForSelector('.theme-swatch-btn');
  check((await attr(page)) === 'forest', 'Forest kept after a reload');
  await page.locator('.theme-follow input').check();
  await page.selectOption('.theme-follow-pick select >> nth=0', 'sand');
  await page.selectOption('.theme-follow-pick select >> nth=1', 'ocean');
  check((await attr(page)) === 'sand', 'follow on a light phone shows the chosen light theme (Sand)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  check((await attr(page)) === 'ocean', 'phone goes dark: the chosen dark theme (Ocean) shows at once');
  await page.screenshot({ path: `${OUT}/th-follow-dark.png` });
  await page.locator('.theme-eink input').check();
  check((await attr(page)) === 'eink', 'E-ink switch wins');
  await page.screenshot({ path: `${OUT}/th-eink-switch.png` });
  await page.locator('.theme-eink input').uncheck();
  check((await attr(page)) === 'ocean', 'E-ink off: back to the theme');
  await page.goto(`${B}/#/settings`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/th-settings-list.png` });
  check(/Ocean · follows phone on/.test(await page.locator('body').innerText()), 'Appearance summary reads "Ocean · follows phone on"');
  await ctx.close();
}

// A profile's own theme.
{
  const made = await api.post('/profiles', { label: 'Theme check', color: '#aa3377' });
  const id = made.profile.id;
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name: 'profile', colorScheme: 'light', init: `try{localStorage.setItem('ft.theme','paper');localStorage.setItem('ft.follow','0');new MutationObserver(function(r){if(window.__first===undefined)window.__first=document.documentElement.getAttribute('data-theme')}).observe(document,{attributes:true,subtree:true,attributeFilter:['data-theme']})}catch(e){}` });
  await page.goto(`${B}/#/settings/all`);
  await page.waitForSelector('.profile-list');
  const row = page.locator('.profile-row', { hasText: 'Theme check' });
  await row.locator('select.profile-theme').selectOption('berry');
  await page.waitForTimeout(500);
  check((await attr(page)) === 'paper', 'a profile theme does not change the app while another profile is open');
  await row.getByRole('button', { name: 'Open' }).click();
  await page.waitForTimeout(800);
  check((await attr(page)) === 'berry', 'opening the profile applies its theme at once');
  await page.screenshot({ path: `${OUT}/th-profile-berry.png` });
  await page.reload();
  await page.waitForSelector('.shell');
  check((await page.evaluate(() => window.__first)) === 'berry', 'no flash on reload: first paint already Berry');
  await page.locator('.profile-switch, [aria-label*="rofile"]').first().click().catch(() => {});
  await api.put('/profiles/default', { id: 'personal' });
  await page.evaluate(() => { localStorage.setItem('ft.mode', 'personal'); });
  await page.reload();
  await page.waitForSelector('.shell');
  check((await attr(page)) === 'paper', 'back in the first profile: the app theme (Paper)');
  // clearing it
  await page.goto(`${B}/#/settings/all`);
  await page.waitForSelector('.profile-list');
  await page.locator('.profile-row', { hasText: 'Theme check' }).locator('select.profile-theme').selectOption('');
  await page.waitForTimeout(400);
  const list = await api.get('/profiles');
  check(list.profiles.find((p) => p.id === id).theme === null, 'Same as app clears the profile theme');
  await ctx.close();
  await api.post(`/profiles/${id}/delete`, { confirm: 'Theme check' });
  await api.post(`/profiles/${id}/purge`, { confirm: 'Theme check' });
}
await browser.close();
console.log(errors.join('\n') || 'console clean');
if (fails.length || errors.length) process.exit(1);
