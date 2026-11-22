// Browser check for sticky notes on Today (D62): the profile's notes float over Today (no project),
// ＋ Sticky adds one, typing saves, a drag moves it, ⋯ colours, Hide / Show is per device and kept
// after a reload, project-page notes stay on the project page, the Sticky notes panel's buttons work,
// the layer stays inside the page at 390 px; light, dark and E-ink at 390 and 1280 px.
// Needs a seeded server (seed.mjs); removes the notes it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/today-stickies.mjs
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
const clear = async () => {
  for (const n of await api.get('/stickies?project_id=null')) await api.call('DELETE', `/stickies/${n.id}`);
};
await clear();
const projects = await api.get('/projects');
const proj = projects[0];
const mine = await api.post('/stickies', { project_id: proj.id, text: 'Project only' });

for (const [name, viewport, touch] of [['phone', { width: 390, height: 844 }, true], ['desk', { width: 1280, height: 900 }, false]]) {
  await clear();
  for (const scheme of ['light', 'dark', 'eink']) {
    const { page, ctx } = await open(browser, viewport, errors, { name: `${name}-${scheme}`, touch, init: `try{localStorage.setItem('ft.theme','${scheme}')}catch(e){}` });
    await page.goto(`${process.env.FT_URL ?? 'http://localhost:8787'}/#/`);
    await page.waitForSelector('.pl-page');
    if (scheme === 'light') {
      ok((await page.locator('.sticky-wrap').count()) === 0, `${name}: no notes yet, project note not on Today`);
      await page.getByRole('button', { name: '＋ Sticky' }).click();
      await page.waitForSelector('.sticky-wrap textarea');
      await page.fill('.sticky-wrap textarea', 'Buy milk');
      await page.waitForTimeout(1200);
      const saved = await api.get('/stickies?project_id=null');
      ok(saved.length === 1 && saved[0].text === 'Buy milk' && saved[0].project_id == null, `${name}: new note saved with no project`);
      const box = await page.locator('.sticky-wrap').boundingBox();
      ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, `${name}: note inside the page width`);
      // move by its strip
      const s = await page.locator('.sticky-strip').boundingBox();
      await page.mouse.move(s.x + 20, s.y + 10);
      await page.mouse.down();
      await page.mouse.move(s.x + 20, s.y + 90, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const moved = (await api.get('/stickies?project_id=null'))[0];
      ok(moved.y > saved[0].y + 40, `${name}: dragging moved it (${saved[0].y} to ${moved.y})`);
      // colour
      await page.click('.sticky-btn[aria-label="Note colour and paper"]');
      await page.click('.sticky-dot[aria-label="mint"]');
      await page.waitForTimeout(300);
      ok((await api.get('/stickies?project_id=null'))[0].color === 'mint', `${name}: colour saved`);
    }
    await page.screenshot({ path: `${OUT}/today-stickies-${name}-${scheme}.png` });
    ok((await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), `${name}-${scheme}: no sideways scroll`);
    if (scheme === 'light') {
      await page.getByRole('button', { name: 'Hide sticky notes' }).click();
      ok((await page.locator('.sticky-wrap').count()) === 0, `${name}: Hide hides them`);
      await page.reload();
      await page.waitForSelector('.pl-page');
      await page.waitForTimeout(500);
      ok((await page.locator('.sticky-wrap').count()) === 0 && (await page.getByRole('button', { name: /Show 1 sticky notes/ }).count()) === 1, `${name}: hidden kept after reload (this device)`);
      await page.getByRole('button', { name: /Show 1 sticky notes/ }).click();
      ok((await page.locator('.sticky-wrap').count()) === 1, `${name}: Show brings them back`);
    }
    await ctx.close();
  }
}
// A project page keeps its own notes
{
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name: 'project' });
  await page.goto(`${process.env.FT_URL ?? 'http://localhost:8787'}/#/p/${proj.id}`);
  await page.waitForSelector('.sticky-wrap');
  const texts = await page.locator('.sticky-wrap textarea').evaluateAll((a) => a.map((t) => t.value));
  ok(texts.includes('Project only') && !texts.includes('Buy milk'), 'project page shows its own notes, not Today’s');
  await ctx.close();
}
await api.call('DELETE', `/stickies/${mine.id}`);
await clear();
await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
