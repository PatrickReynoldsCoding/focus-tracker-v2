// Browser check for the movable floating timers (core/draggable.ts): the Pomodoro's floating timer and the
// session's corner timer start in their usual corners, move with a mouse at 1280 px and with a finger's
// press and hold at 390 px (a quick swipe does not move them, buttons inside still tap, a tap on the
// corner timer still opens the project), stay where they were left after a reload, stay fully on screen
// when the window gets smaller, go back to their corner on a double-click of the grip; light and E-ink;
// no console errors.
// Needs a seeded server (seed.mjs); stops the Pomodoro and the session it starts.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/timer-move.mjs
import { mkdirSync } from 'node:fs';
import { apiCtx, B, launch, open, OUT } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const browser = await launch();
const api = await apiCtx(browser);
const errors = [];
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};

const projects = await api.get('/projects');
const proj = projects.find((p) => p.name === 'Focus Tracker v2') ?? projects[0];
await api.put('/focus', { project_id: proj.id });
await api.post('/session/stop', {}).catch(() => {});
await api.post('/session/start', { planned_min: 25, pomodoro: false });
await api.post('/pomodoro/stop').catch(() => {});
await api.post('/pomodoro/start');

// The corner timer first: at 390 px the two start overlapping, the corner timer on top.
const TIMERS = [
  ['corner', '.corner-timer'],
  ['pomodoro', '.pomo-float'],
];
const inside = (b, vp) => b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;
const near = (a, b, d = 3) => Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d;

async function mouseDrag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

async function touchDrag(page, cdp, from, dx, dy, holdMs = 500) {
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });
  await touch('touchStart', from);
  await page.waitForTimeout(holdMs);
  let p = from;
  for (let i = 1; i <= 10; i++) {
    p = { x: from.x + (dx * i) / 10, y: from.y + (dy * i) / 10 };
    await touch('touchMove', p);
    await page.waitForTimeout(30);
  }
  await touch('touchEnd', p);
  await page.waitForTimeout(150);
}

/** A point on the timer's body that is not a button: its grip's row, past the grip. */
async function bodyPoint(page, sel) {
  const g = await page.locator(`${sel} .drag-grip`).boundingBox();
  return { x: g.x + g.width + 14, y: g.y + g.height / 2 };
}

for (const [name, viewport, touch] of [
  ['desk', { width: 1280, height: 900 }, false],
  ['phone', { width: 390, height: 844 }, true],
]) {
  for (const theme of ['light', 'eink']) {
    const { page, ctx } = await open(browser, viewport, errors, { name: `${name}-${theme}`, touch, init: `try{localStorage.setItem('ft.theme','${theme}')}catch(e){}` });
    const cdp = touch ? await ctx.newCDPSession(page) : null;
    await page.goto(`${B}/#/files`);
    for (const [, sel] of TIMERS) await page.waitForSelector(sel);
    const vp = viewport;

    // The usual corners.
    const p0 = await page.locator('.pomo-float').boundingBox();
    ok(Math.abs(vp.width - (p0.x + p0.width) - 12) <= 2 && p0.y + p0.height > vp.height * 0.75, `${name}-${theme}: the Pomodoro starts bottom right`);
    const c0 = await page.locator('.corner-timer').boundingBox();
    ok(c0.x < vp.width / 2 && c0.y > vp.height / 2, `${name}-${theme}: the corner timer starts bottom left`);
    ok((await page.locator('.pomo-float .drag-grip').getAttribute('title')).includes('Double-click'), `${name}-${theme}: the grip's tooltip names the double-click`);

    const moved = {};
    for (const [tname, sel] of TIMERS) {
      const b0 = await page.locator(sel).boundingBox();
      const dx = Math.round(b0.x + b0.width / 2 > vp.width / 2 ? -Math.min(200, b0.x - 8) : Math.min(140, vp.width - b0.x - b0.width - 8)); // a move that fits
      const dy = -Math.round(Math.min(300, vp.height / 3));
      if (touch) {
        // A quick swipe over it is a scroll, not a move.
        const at = await bodyPoint(page, sel);
        await touchDrag(page, cdp, at, dx, dy, 0);
        ok(near(await page.locator(sel).boundingBox(), b0), `${name}-${theme}: a quick swipe does not move the ${tname} timer`);
        await touchDrag(page, cdp, at, dx, dy);
      } else {
        const g = await page.locator(`${sel} .drag-grip`).boundingBox();
        await mouseDrag(page, { x: g.x + g.width / 2, y: g.y + g.height / 2 }, dx, dy);
      }
      await page.waitForTimeout(150);
      const b1 = await page.locator(sel).boundingBox();
      ok(Math.abs(b1.x - b0.x - dx) <= 4 && Math.abs(b1.y - b0.y - dy) <= 4, `${name}-${theme}: the ${tname} timer moved by ${dx},${dy} (${Math.round(b1.x - b0.x)},${Math.round(b1.y - b0.y)})`);
      ok(inside(b1, vp), `${name}-${theme}: the ${tname} timer is on screen`);
      moved[tname] = b1;
    }
    ok(page.url().includes('#/files'), `${name}-${theme}: dragging the corner timer did not open the project`);

    // Dragged far off the edge, it stops at the edge.
    {
      const g = await page.locator('.pomo-float .drag-grip').boundingBox();
      const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
      const edge = { x: vp.width - 1 - from.x, y: 1 - from.y }; // to the window's top right corner, past where the timer fits
      if (touch) await touchDrag(page, cdp, from, edge.x, edge.y);
      else await mouseDrag(page, from, edge.x, edge.y);
      const b = await page.locator('.pomo-float').boundingBox();
      ok(inside(b, vp) && b.y < 20 && vp.width - (b.x + b.width) < 20, `${name}-${theme}: dragged past the top right, the Pomodoro stays on screen there (${JSON.stringify(b)})`);
      const g2 = await page.locator('.pomo-float .drag-grip').boundingBox();
      const back = { x: g2.x + g2.width / 2, y: g2.y + g2.height / 2 };
      if (touch) await touchDrag(page, cdp, back, moved.pomodoro.x - b.x, moved.pomodoro.y - b.y);
      else await mouseDrag(page, back, moved.pomodoro.x - b.x, moved.pomodoro.y - b.y);
      moved.pomodoro = await page.locator('.pomo-float').boundingBox();
    }

    // Buttons inside still work as taps.
    const pause = page.locator('.pomo-float button', { hasText: /Pause|Resume/ });
    const label = await pause.textContent();
    if (touch) await pause.tap();
    else await pause.click();
    await page.waitForFunction((l) => !document.querySelector('.pomo-float')?.textContent?.includes(l), label.trim());
    ok(near(await page.locator('.pomo-float').boundingBox(), moved.pomodoro, 40), `${name}-${theme}: Pause / Resume taps and the timer stays put`);
    const again = page.locator('.pomo-float button', { hasText: /Pause|Resume/ });
    if (touch) await again.tap();
    else await again.click();

    await page.screenshot({ path: `${OUT}/timer-move-${name}-${theme}.png` });

    // Kept after a reload.
    await page.reload();
    for (const [tname, sel] of TIMERS) {
      await page.waitForSelector(sel);
      await page.waitForTimeout(100);
      ok(near(await page.locator(sel).boundingBox(), moved[tname], 4), `${name}-${theme}: the ${tname} timer is where it was left after a reload`);
    }

    // A smaller window keeps them fully on screen.
    const small = { width: Math.round(vp.width * 0.6), height: Math.round(vp.height * 0.55) };
    await page.setViewportSize(small);
    await page.waitForTimeout(200);
    for (const [tname, sel] of TIMERS) ok(inside(await page.locator(sel).boundingBox(), small), `${name}-${theme}: the ${tname} timer is on screen at ${small.width}x${small.height}`);
    await page.setViewportSize(vp);
    await page.waitForTimeout(200);
    for (const [tname, sel] of TIMERS) ok(inside(await page.locator(sel).boundingBox(), vp), `${name}-${theme}: the ${tname} timer is on screen back at ${vp.width}x${vp.height}`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}-${theme}: no sideways scroll`);

    // A double-click (double tap) on the grip puts each back in its corner.
    for (const [tname, sel] of TIMERS) {
      const grip = page.locator(`${sel} .drag-grip`);
      if (touch) {
        await grip.tap();
        await grip.tap();
      } else await grip.dblclick();
      await page.waitForTimeout(150);
      ok(page.url().includes('#/files'), `${name}-${theme}: the ${tname} timer's grip does not open the project (${page.url()})`);
      ok(near(await page.locator(sel).boundingBox(), tname === 'pomodoro' ? p0 : c0, 4), `${name}-${theme}: a double-click on the grip puts the ${tname} timer back`);
    }
    await page.reload();
    await page.waitForSelector('.pomo-float');
    ok(near(await page.locator('.pomo-float').boundingBox(), p0, 4), `${name}-${theme}: back in the corner after a reload`);

    // A tap on the corner timer still opens the focus project.
    await page.waitForSelector('.corner-timer');
    const ct = page.locator('.corner-timer .ct-main');
    if (touch) await ct.tap();
    else await ct.click();
    await page.waitForFunction((id) => location.hash.includes(`/p/${id}`), proj.id);
    ok(true, `${name}-${theme}: a tap on the corner timer opens the project`);
    await ctx.close();
  }
}

await api.post('/pomodoro/stop').catch(() => {});
await api.post('/session/stop', {}).catch(() => {});
await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? `:\n${errors.join('\n')}` : ''}`);
