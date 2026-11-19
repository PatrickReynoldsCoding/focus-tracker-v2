import { launch, open, B, OUT } from './lib.mjs';
const browser = await launch();
const errors = [];
for (const th of ['light', 'dark', 'eink']) {
  const { page } = await open(browser, { width: 390, height: 844 }, errors, { init: `try{localStorage.setItem('ft.theme','${th}')}catch(e){}` });
  await page.goto(`${B}/#/settings`);
  await page.waitForSelector('.appearance');
  await page.waitForTimeout(500);
  await page.locator('.appearance').screenshot({ path: `${OUT}/p2-appearance-${th}.png` });
  await page.goto(`${B}/#/notes`);
  await page.waitForSelector('.note-card');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/p2-notes-fixed-${th}.png` });
  await page.close();
}
await browser.close();
console.log(errors.join('\n') || 'ok');
