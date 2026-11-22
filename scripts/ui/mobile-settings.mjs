// Settings on a phone (D60, mockup B): a list of sections with a one-line summary each, a search box,
// a section opening with a ‹ in the header, an address per section (back button and reload work),
// search across sections, and the sidebar unchanged on a computer. Light, dark and E-ink at 390 and 1280 px.
// Needs a seeded server; changes nothing it does not put back.
import { launch, open, B, OUT } from './lib.mjs';
const browser = await launch();
const errors = [];
let bad = 0;
const ok = (c, m) => (c ? console.log('ok  ', m) : (bad++, console.log('FAIL', m)));
for (const th of ['light', 'dark', 'eink']) {
  const name = `phone ${th}`;
  const { page } = await open(browser, { width: 390, height: 844 }, errors, { name, init: `try{localStorage.setItem('ft.theme','${th}')}catch(e){}` });
  await page.goto(`${B}/#/settings`);
  await page.waitForSelector('.settings-rows .settings-row');
  await page.waitForTimeout(800);
  const rows = await page.locator('.settings-row').count();
  ok(rows >= 8, `${name}: the list shows ${rows} sections`);
  ok((await page.locator('input[type=search]').count()) === 1, `${name}: search box on the list`);
  ok((await page.locator('.settings-section:visible').count()) === 0, `${name}: no section content on the list`);
  const profiles = await page.locator('.settings-row', { hasText: 'Profiles' }).locator('.sm').innerText();
  ok(/Personal/.test(profiles), `${name}: Profiles summary "${profiles}"`);
  const feat = await page.locator('.settings-row', { hasText: 'Features' }).locator('.sm').innerText();
  ok(/^\d+ of \d+ on$/.test(feat), `${name}: Features summary "${feat}"`);
  ok((await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), `${name}: no sideways scroll on the list`);
  await page.screenshot({ path: `${OUT}/ms-list-${th}.png` });

  // Open a section.
  await page.locator('.settings-row', { hasText: 'Appearance' }).click();
  await page.waitForSelector('.settings-back');
  ok(/#\/settings\/appearance$/.test(page.url()), `${name}: the address is #/settings/appearance`);
  await page.waitForFunction(() => document.querySelectorAll('.settings-section:not([hidden])').length === 1);
  ok((await page.locator('h1').innerText()) === 'Appearance', `${name}: header names the section`);
  ok((await page.locator('.settings-section:visible').count()) === 1, `${name}: only that section shows`);
  ok((await page.locator('.settings-row').count()) === 0 && (await page.locator('input[type=search]').count()) === 0, `${name}: no list or search inside a section`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/ms-appearance-${th}.png` });
  // The summary follows the setting.
  await page.locator('.theme-option strong', { hasText: /^Dark$/ }).click();
  await page.waitForTimeout(300);
  await page.locator('.settings-back').click();
  await page.waitForSelector('.settings-rows');
  ok(/Dark/.test(await page.locator('.settings-row', { hasText: 'Appearance' }).locator('.sm').innerText()), `${name}: Appearance summary follows the theme`);
  ok(/#\/settings$/.test(page.url()), `${name}: ‹ went back to the list`);
  await page.evaluate((t) => localStorage.setItem('ft.theme', t), th);
  await page.reload();
  await page.waitForSelector('.settings-rows .settings-row');
  // Browser back and a reload on a section.
  await page.locator('.settings-row', { hasText: 'Features' }).click();
  await page.waitForSelector('.settings-back');
  await page.goBack();
  await page.waitForSelector('.settings-rows');
  ok(true, `${name}: the browser's Back returns to the list`);
  await page.goto(`${B}/#/settings/features`);
  await page.reload();
  await page.waitForSelector('.settings-back');
  ok((await page.locator('h1').innerText()) === 'Features', `${name}: a reload keeps the section`);
  ok((await page.locator('.scope-choice').count()) >= 1, `${name}: Applies to / This profile | All profiles choice in Features`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/ms-features-${th}.png` });
  // An unknown section shows the list.
  await page.goto(`${B}/#/settings/nope`);
  await page.waitForSelector('.settings-rows');
  ok(true, `${name}: an unknown section shows the list`);

  // Every section opens, shows content and does not scroll sideways.
  const ids = await page.locator('.settings-row').evaluateAll((rs) => rs.map((r) => r.querySelector('.nm').textContent));
  for (const nm of ids) {
    await page.goto(`${B}/#/settings`);
    await page.waitForSelector('.settings-rows');
    await page.locator('.settings-row', { has: page.locator('.nm', { hasText: new RegExp(`^${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).click();
    await page.waitForSelector('.settings-back');
    await page.waitForTimeout(250);
    const n = await page.locator('.settings-section:visible').count();
    const flat = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    ok(n === 1 && flat, `${name}: section "${nm}" opens${flat ? '' : ' (sideways scroll!)'}`);
  }

  // Search across sections.
  await page.goto(`${B}/#/settings`);
  await page.waitForSelector('.settings-rows');
  await page.fill('input[type=search]', 'pomodoro');
  await page.waitForTimeout(300);
  ok((await page.locator('.settings-row').count()) === 0 && (await page.locator('.settings-section:visible').count()) >= 1, `${name}: search shows matching sections`);
  await page.screenshot({ path: `${OUT}/ms-search-${th}.png` });
  await page.fill('input[type=search]', 'zzzzqq');
  await page.waitForTimeout(300);
  ok((await page.locator('.settings-section:visible').count()) === 0 && (await page.locator('text=Nothing matches').count()) === 1, `${name}: search with no match says so`);
  await page.fill('input[type=search]', '');
  await page.waitForTimeout(300);
  ok((await page.locator('.settings-row').count()) === rows, `${name}: clearing search brings the list back`);
  await page.close();
}

// A computer keeps its sidebar.
for (const th of ['light', 'eink']) {
  const name = `desktop ${th}`;
  const { page } = await open(browser, { width: 1280, height: 900 }, errors, { name, init: `try{localStorage.setItem('ft.theme','${th}')}catch(e){}` });
  await page.goto(`${B}/#/settings`);
  await page.waitForSelector('.settings-nav li button');
  await page.waitForTimeout(800);
  ok((await page.locator('.settings-row').count()) === 0, `${name}: no phone list`);
  ok((await page.locator('.settings-section:visible').count()) >= 8, `${name}: every section on the page`);
  ok((await page.locator('.settings-back').count()) === 0, `${name}: no ‹`);
  await page.screenshot({ path: `${OUT}/ms-desktop-${th}.png` });
  await page.goto(`${B}/#/settings/features`);
  await page.waitForTimeout(800);
  ok((await page.locator('.settings-section:visible').count()) >= 8, `${name}: an address for a section keeps the whole page`);
  await page.close();
}
await browser.close();
console.log(errors.join('\n') || 'no console errors');
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad || errors.length ? 1 : 0);
