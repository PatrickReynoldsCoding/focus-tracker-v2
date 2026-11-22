import { apiCtx, launch, open, B, OUT } from './lib.mjs';
const browser = await launch();
// The Notes tab's cards: shown while the Files tab is off (flag files-tab); switched back on at the end.
const api = await apiCtx(browser);
await api.put('/features/files-tab', { enabled: false });
const errors = [];
for (const th of ['light', 'dark', 'eink']) {
  const { page } = await open(browser, { width: 390, height: 844 }, errors, { init: `try{localStorage.setItem('ft.theme','${th}')}catch(e){}` });
  await page.goto(`${B}/#/settings/all`);
  await page.waitForSelector('.appearance');
  await page.waitForTimeout(500);
  await page.locator('.appearance').screenshot({ path: `${OUT}/p2-appearance-${th}.png` });
  await page.goto(`${B}/#/notes`);
  await page.waitForSelector('.note-card');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/p2-notes-fixed-${th}.png` });
  await page.close();
}
await api.put('/features/files-tab', { enabled: true });
await browser.close();
console.log(errors.join('\n') || 'ok');
