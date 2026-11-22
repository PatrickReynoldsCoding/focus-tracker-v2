// Browser check for the "Keep in mind" rotation panel (D59, a list shown "one at a time"): Lora
// italic on a frosted-glass card, the text sized to fill the panel (long quotes smaller than short
// ones, nothing cut off), centred; no big arrows: swipe, tap the left or right half, the arrow keys
// and small dots move on; the small "2 / 12" counter, the title, ⚙ and ✕ stay. Light, dark and
// E-ink at 390 and 1280 px, with the panel-restyle flag on and off. Needs a seeded server (seed.mjs);
// makes its own list and deletes it, and puts desktop-pills back.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/keep-in-mind.mjs
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
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };

const features = await api.get('/features');
const pillsWere = features.find((f) => f.id === 'desktop-pills')?.enabled;
await api.put('/features/desktop-pills', { enabled: false });
await api.put('/features/list-one-at-a-time', { enabled: true });
for (const l of await api.get('/lists')) if (l.name.startsWith('KM ')) await api.call('DELETE', `/lists/${l.id}`);

const SHORT = 'Keep going';
const LONG = 'The only way to do great work is to love what you do, and if you have not found it yet, keep looking, and do not settle, because as with all matters of the heart you will know when you find it.';
const list = await api.post('/lists', { name: 'KM Keep in mind', kind: 'list' });
const [col] = (await api.get(`/lists/${list.id}/full`)).columns;
const titles = [SHORT, LONG, ...Array.from({ length: 12 }, (_, i) => `Quote number ${i + 3}`)];
for (const t of titles) await api.post('/tasks', { title: t, column_id: col.id });
await api.call('PATCH', `/lists/${list.id}`, { display: 'one', seconds: 3600 });
await api.put('/today-panels/show', { list_id: list.id, on: true });

async function run(theme, vname, vp, restyle) {
  await api.put('/features/panel-restyle', { enabled: restyle });
  const name = `${theme}-${vname}${restyle ? '' : '-old'}`;
  const phone = vp.width < 700;
  const { page, ctx } = await open(browser, vp, errors, { name, touch: phone, init: `try{localStorage.setItem('ft.theme','${theme}')}catch(e){}` });
  if (phone) await page.click('.pl-pill:has-text("All")').catch(() => {});
  const q = page.locator('.tp-quote');
  await q.first().waitFor({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: `${OUT}/keep-in-mind-fail.png` }); throw e; });
  await page.waitForTimeout(600);
  const text = () => q.locator('blockquote').innerText();
  const size = () => q.locator('.tp-quote-fit').evaluate((e) => parseFloat(e.style.getPropertyValue('--q')));
  const fits = () => q.locator('.tp-quote-body').evaluate((b) => b.scrollHeight <= b.clientHeight + 1 && b.scrollWidth <= b.clientWidth + 1);
  ok((await q.locator('blockquote').evaluate((e) => getComputedStyle(e).fontStyle)) === 'italic', `${name}: italic`);
  if (theme !== 'eink') ok(/Lora/.test(await q.locator('blockquote').evaluate((e) => getComputedStyle(e).fontFamily)), `${name}: Lora first in the font stack`);
  if (theme !== 'eink') ok(await page.evaluate(() => document.fonts.check("italic 500 20px Lora")), `${name}: Lora loaded`);
  ok((await q.locator('.tp-quote-nav, button[aria-label="Next item"]:not(.sr-nav)').count()) === 0, `${name}: no big arrow buttons`);
  ok(/^\d+ \/ 14$/.test(await q.locator('.pos').innerText()), `${name}: small counter`);
  ok((await q.locator('.tp-dots i').count()) === 9, `${name}: nine dots for 14 items`);
  ok((await q.locator('[aria-label^="Settings of"]').count()) === (restyle ? 1 : 0) || !restyle, `${name}: settings control`);

  // Go through every quote with the keyboard: each fits, a short one is bigger than a long one.
  const sizes = new Map();
  await q.locator('.tp-quote-body').focus();
  for (let i = 0; i < 14; i++) {
    ok(await fits(), `${name}: quote ${i + 1} fits the panel`);
    sizes.set(await text(), await size());
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(80);
  }
  ok(sizes.get(SHORT) > sizes.get(LONG) + 6, `${name}: short quote ${sizes.get(SHORT)}px bigger than long ${sizes.get(LONG)}px`);
  ok(sizes.get(LONG) >= 13, `${name}: long quote still readable`);
  const pos = async () => parseInt((await q.locator('.pos').innerText()).split(' / ')[0], 10);

  // Tap the right half then the left half; swipe both ways.
  const box = await q.locator('.tp-quote-body').boundingBox();
  const y = box.y + box.height / 2;
  const before = await pos();
  await page.mouse.click(box.x + box.width * 0.85, y);
  ok((await pos()) === (before % 14) + 1, `${name}: tap on the right side goes on`);
  await page.mouse.click(box.x + box.width * 0.15, y);
  ok((await pos()) === before, `${name}: tap on the left side goes back`);
  const swipe = async (from, to) => {
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * ((from + to) / 2), y + 4, { steps: 4 });
    await page.mouse.move(box.x + box.width * to, y + 6, { steps: 4 });
    await page.mouse.up();
  };
  await swipe(0.8, 0.2);
  ok((await pos()) === (before % 14) + 1, `${name}: swipe left goes on`);
  await swipe(0.2, 0.8);
  ok((await pos()) === before, `${name}: swipe right goes back`);
  await page.locator('button[aria-label="Next item"]').focus();
  await page.keyboard.press('Enter');
  ok((await pos()) === (before % 14) + 1, `${name}: the hidden Next button works from the keyboard`);
  if (theme !== 'eink') {
    const bg = await q.evaluate((e) => getComputedStyle(e).backgroundImage);
    ok(/gradient/.test(bg), `${name}: glass gradient`);
  } else {
    ok((await q.evaluate((e) => getComputedStyle(e).backgroundImage)) === 'none', `${name}: E-ink has no glass`);
  }
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur());
  await q.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await q.screenshot({ path: `${OUT}/keep-in-mind-${name}.png` });
  await ctx.close();
}

try {
  for (const [v, vp] of [['phone', PHONE], ['desk', DESK]]) {
    for (const theme of ['light', 'dark', 'eink']) await run(theme, v, vp, true);
    await run('light', v, vp, false);
  }
  ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await api.put('/features/panel-restyle', { enabled: true });
  await api.put('/features/desktop-pills', { enabled: pillsWere ?? true });
  await api.call('DELETE', `/lists/${list.id}`);
  await browser.close();
}
