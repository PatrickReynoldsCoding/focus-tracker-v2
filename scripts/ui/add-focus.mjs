// Browser check: the focus card hidden (Today settings → Focus card → Hidden) comes back from
// "+ Add panel" (the pill bar, and under the panels in the All pill), and is not listed while shown.
// 1280 and 390 px, no console errors. Needs a seeded server (seed.mjs); puts the view back as it was.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/add-focus.mjs
import { apiCtx, B, launch, open } from './lib.mjs';

const browser = await launch();
const api = await apiCtx(browser);
const errors = [];
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};
const before = (await api.get('/layout/today')).view ?? {};

const card = 'section.card.focus';
const rowsOf = (page) => page.$$eval('dialog[open] .ap-row strong', (els) => els.map((e) => e.textContent.trim()));
try {
  await api.put('/features/add-panel', { enabled: true });
  for (const [name, viewport, touch] of [
    ['desk', { width: 1280, height: 900 }, false],
    ['phone', { width: 390, height: 844 }, true],
  ]) {
    const addBtn = touch ? '.lg-add-panel button' : '.pl-add';
    for (const where of ['pill', 'all']) {
      const tag = `${name}/${where}`;
      await api.put('/layout/today/view', { ...before, focusCard: 'compact' });
      const { page, ctx } = await open(browser, viewport, errors, { name, touch });
      await page.goto(`${B}/#/today`);
      await page.waitForSelector('.pl-pill');
      await page.waitForSelector(card);
      await page.click(addBtn);
      await page.waitForSelector('dialog[open] .ap-list');
      ok(!(await rowsOf(page)).includes('Focus'), `${tag}: Focus is not offered while the card is shown`);
      await page.keyboard.press('Escape');
      await api.put('/layout/today/view', { ...before, focusCard: 'hidden' });
      await page.waitForTimeout(500);
      await page.goto(`${B}/#/today`);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.pl-pill');
      await page.waitForSelector(card, { state: 'detached', timeout: 8000 }).catch(() => {});
      ok(!(await page.$(card)), `${tag}: the focus card is hidden`);
      if (where === 'all') await page.click('.pl-pill:has-text("All")');
      await page.click(addBtn);
      await page.waitForSelector('dialog[open] .ap-list');
      ok((await rowsOf(page)).includes('Focus'), `${tag}: Add panel lists Focus (${(await rowsOf(page)).join(', ')})`);
      await page.click('dialog[open] .ap-row:has-text("Focus")');
      await page.waitForSelector(card);
      ok((await api.get('/layout/today')).view.focusCard === 'compact', `${tag}: the card is back (saved as compact)`);
      await page.click(addBtn);
      await page.waitForSelector('dialog[open] .ap-list');
      ok(!(await rowsOf(page)).includes('Focus'), `${tag}: Focus is no longer listed`);
      await ctx.close();
    }
  }
  ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await api.put('/layout/today/view', before).catch(() => {});
  await browser.close();
}
