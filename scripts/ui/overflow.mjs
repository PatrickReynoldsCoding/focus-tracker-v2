import { launch, open, B } from './lib.mjs';
const browser = await launch();
const errors = [];
const { page } = await open(browser, { width: 1280, height: 860 }, errors, {});
for (const r of ['/today', '/settings']) {
  await page.goto(`${B}/#${r}`);
  await page.waitForTimeout(800);
  const out = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const res = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.right > W + 1 && b.width) res.push(`${el.tagName}.${String(el.className).slice(0, 40)} right=${Math.round(b.right)}`);
    }
    return { sw: document.documentElement.scrollWidth, W, res: res.slice(0, 8) };
  });
  console.log(r, JSON.stringify(out));
}
await browser.close();
