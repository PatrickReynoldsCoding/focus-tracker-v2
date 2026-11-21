import { mkdirSync } from 'node:fs';
import { launch, open, apiCtx, OUT, B } from './lib.mjs';
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const errors = [];
const api = await apiCtx(browser);
// The Notes tab's cards: shown while the Files tab is off (flag files-tab); switched back on at the end.
await api.put('/features/files-tab', { enabled: false });
const order = async () => (await api.get('/lists/overview')).map((l) => l.name);
const fail = (m) => { errors.push('ASSERT: ' + m); console.log('FAIL', m); };

// ---- desktop 1280
{
  const { page } = await open(browser, { width: 1280, height: 860 }, errors, { name: 'desk' });
  await page.goto(`${B}/#/notes`);
  await page.waitForSelector('.note-card');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/p1-desk-notes.png`, fullPage: true });
  // The Project notes tickbox is gone (v0.31.0): project notes live in their project's folder on Files.
  if (await page.locator('.project-switch, .project-note').count()) fail('Project notes tickbox or cards still on the Notes tab');
  // tick a to-do on the card
  const card = page.locator('.note-card.kind-todo');
  const before = await card.locator('li').count();
  await card.locator('input[type=checkbox]').first().check();
  await page.waitForTimeout(500);
  if (!(await card.locator('li.done').count())) fail('tick not struck');
  const tod = (await api.get('/lists/overview')).find((l) => l.kind === 'todo');
  if (tod.done_today !== 1) fail('server did not tick: ' + JSON.stringify(tod.done_today));
  await page.screenshot({ path: `${OUT}/p1-desk-ticked.png` });
  await card.locator('input[type=checkbox]').first().uncheck();
  await page.waitForTimeout(400);
  // drag: move the first card to the 3rd place with the mouse
  const names0 = await order();
  const cards = page.locator('#app .note-grid >> nth=0 >> .note-card');
  const a = await cards.nth(0).boundingBox();
  const c = await cards.nth(2).boundingBox();
  await page.mouse.move(a.x + 30, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + 30, { steps: 3 });
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const names1 = await order();
  console.log('desktop order', names0.join(','), '->', names1.join(','));
  if (names0.join() === names1.join()) fail('desktop drag did not change order');
  const shownNames = await page.locator('#app .note-grid >> nth=0 >> .note-card h3').allInnerTexts();
  if (shownNames.map((s) => s.replace(/^\S+\s/, '').trim()).join() !== names1.join()) fail('screen order differs from server: ' + shownNames.join('|'));
  await page.reload(); await page.waitForSelector('.note-card');
  await page.screenshot({ path: `${OUT}/p1-desk-after-drag.png`, fullPage: true });
  // filtering turns drag off
  await page.click('.chip >> text=Note');
  await page.waitForTimeout(200);
  // click opens the note
  await page.click('.chip >> text=All');
  await page.locator('.note-card.kind-note').first().click({ position: { x: 20, y: 60 } });
  await page.waitForSelector('.page-head h1');
  if (!page.url().includes('#/n/')) fail('click did not open note');
  // A list's page has no On Today tickbox (+ Add panel → Add file puts it on Today).
  if (await page.locator('.page-head .meta input[type=checkbox]').count()) fail('list page still has an On Today tickbox');
}

// ---- phone 390 with touch
{
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name: 'phone', touch: true });
  await page.goto(`${B}/#/notes`);
  await page.waitForSelector('.note-card');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/p1-phone-notes.png`, fullPage: true });
  if ((await page.evaluate(() => document.documentElement.scrollWidth)) > 391) fail('phone horizontal scroll');
  // tap tick
  const card = page.locator('.note-card.kind-todo');
  const box = await card.locator('input[type=checkbox]').nth(1).boundingBox();
  await page.touchscreen.tap(box.x + 8, box.y + 8);
  await page.waitForTimeout(500);
  if (!(await card.locator('li.done').count())) fail('phone tick');
  // long press and drag with CDP touch
  const cdp = await ctx.newCDPSession(page);
  const names0 = await order();
  const cards = page.locator('#app .note-grid >> nth=0 >> .note-card');
  const a = await cards.nth(0).boundingBox();
  const c = await cards.nth(3).boundingBox();
  const pt = (x, y) => [{ x, y, id: 1 }];
  const sx = a.x + a.width / 2, sy = a.y + 24;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(sx, sy) });
  await page.waitForTimeout(450);
  const tx = c.x + c.width / 2, ty = c.y + c.height / 2;
  for (let i = 1; i <= 15; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(sx + ((tx - sx) * i) / 15, sy + ((ty - sy) * i) / 15) });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  const names1 = await order();
  console.log('phone order', names0.join(','), '->', names1.join(','));
  if (names0.join() === names1.join()) fail('phone long-press drag did not change order');
  await page.screenshot({ path: `${OUT}/p1-phone-after-drag.png`, fullPage: true });
}
await api.put('/features/files-tab', { enabled: true });
await browser.close();
const bad = errors;
if (bad.length) { console.error('ERRORS:\n' + bad.join('\n')); process.exit(1); }
console.log('part1 ok');
