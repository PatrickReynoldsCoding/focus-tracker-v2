// Browser check for free arranging (D65, flag free-panels): on a project page at 1280 px with a mouse
// and at 390 px with touch, and the Desktop page at 600 px: a short press or a press that moves does
// nothing, a hold arranges every panel (grabbers on four sides, ✕); a panel dragged to an empty spot
// leaves its gap and nothing else moves; a panel dropped on another pushes it down with no overlaps;
// each side resizes; ✕ removes and Undo brings it back; Esc, Done and a tap on an empty spot finish;
// a reload keeps the places; a phone and a computer keep their own; no sideways scroll; the flag off
// gives the older grid back. Light and E-ink. Needs a seeded server; it puts the layouts back.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/free.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/free-${name}.png` });
const eink = () => localStorage.setItem('ft.theme', 'eink');
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const anyOverlap = (cells) => Object.entries(cells).some(([i, a]) => Object.entries(cells).some(([j, b]) => i < j && overlaps(a, b)));

await api.put('/features/free-panels', { enabled: true });
const project = (await api.get('/projects')).find((p) => p.name === 'Focus Tracker v2');
ok(!!project, 'the seeded project is there');
const reset = async () => {
  await api.call('DELETE', '/layout/project/grid').catch(() => {});
  await api.call('DELETE', '/layout/desktop/grid').catch(() => {});
};
await reset();

const LINKED = ['Free check A', 'Free check B'];
const linkedIds = [];
for (const name of LINKED) linkedIds.push((await api.post('/lists', { name, kind: 'list', project_id: project.id })).id);

/** The saved places of the page for this device. */
const cellsOf = async (page, key) => (await api.get(`/layout/${page}`)).grid?.[key] ?? {};
/** The panels on screen, as their place in px. */
const boxes = (page) => page.$$eval('.fr-item', (els) => Object.fromEntries(els.map((e) => [e.dataset.panel, { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }])));

async function hold(page, id, ms = 650) {
  const t = await page.locator(`.fr-item[data-panel="${id}"]`).boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + 18);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  return t;
}

async function run(page, name, key, phone) {
  await page.goto(`${B}/#/p/${project.id}`);
  await page.waitForSelector('.fr-board .fr-item');
  await page.waitForTimeout(800);
  ok(!(await page.$('.lg-grid, .lg-stack')), `${name}: the free board draws the panels (no older grid)`);
  const ids = await page.$$eval('.fr-item', (els) => els.map((e) => e.dataset.panel));
  ok(ids.length >= 3, `${name}: panels drawn (${ids.join(', ')})`);
  ok(linkedIds.every((id) => ids.includes(`list-${id}`)) && !ids.includes('lists'), `${name}: each linked list is a panel of its own`);
  const b0 = await boxes(page);
  ok(!Object.entries(b0).some(([i, a]) => Object.entries(b0).some(([j, c]) => i < j && a.x < c.x + c.w - 1 && c.x < a.x + a.w - 1 && a.y < c.y + c.h - 1 && c.y < a.y + a.h - 1)), `${name}: no panels overlap`);
  ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${name}: no sideways scroll`);
  const a = ids.find((id) => id !== 'board') ?? ids[0];
  let b, c;

  // A short press, and a press that moves, do nothing.
  await hold(page, a, 150);
  await page.mouse.up();
  await page.waitForTimeout(300);
  ok(!(await page.$('.fr-arranging')), `${name}: a short press does not arrange`);
  const s = await hold(page, a, 60);
  await page.mouse.move(s.x + s.width / 2, s.y + 80, { steps: 4 });
  await page.waitForTimeout(600);
  await page.mouse.up();
  ok(!(await page.$('.fr-arranging')), `${name}: a press that moves first does not arrange`);

  // A hold arranges everything.
  await hold(page, a);
  ok(!!(await page.$('.fr-arranging')), `${name}: a hold arranges the panels`);
  ok((await page.$$('.fr-item .fr-grab')).length === ids.length * 4, `${name}: every panel has grabbers on four sides`);
  await shot(page, `${name}-arranging`);

  // Drag it below everything: the gap stays, nothing else moves.
  const before = await boxes(page);
  const bb = await page.locator('.fr-board').boundingBox();
  const t = await page.locator(`.fr-item[data-panel="${a}"]`).boundingBox();
  await page.mouse.move(t.x + t.width / 2, Math.min(bb.y + bb.height - 30, t.y + 18 + 2000), { steps: 12 });
  await page.waitForTimeout(150);
  ok(!!(await page.$('.fr-ghost')), `${name}: a dashed outline shows where it lands`);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await boxes(page);
  ok(after[a].y > before[a].y, `${name}: ${a} moved down (${before[a].y} → ${after[a].y})`);
  ok(ids.filter((id) => id !== a).every((id) => after[id].x === before[id].x && after[id].y === before[id].y), `${name}: the others stayed put, so the gap stays`);
  let saved = await cellsOf('project', key);
  ok(saved[a] && Object.keys(saved).length === ids.length, `${name}: every place is saved under ${key}`);

  // Drop b on c: c moves down, nothing overlaps.
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
  // The two top panels (both on screen).
  [b, c] = Object.entries(saved).filter(([id]) => id !== a).sort(([, p], [, q]) => p.y - q.y || p.x - q.x).map(([id]) => id);
  const cBefore = saved[c];
  const bt = await page.locator(`.fr-item[data-panel="${b}"]`).boundingBox();
  const ct = await page.locator(`.fr-item[data-panel="${c}"]`).boundingBox();
  await page.mouse.move(bt.x + 60, bt.y + 30);
  await page.mouse.down();
  await page.mouse.move(ct.x + 60, ct.y + 30, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  saved = await cellsOf('project', key);
  ok(!anyOverlap(saved), `${name}: after dropping ${b} on ${c}, nothing overlaps`);
  ok(saved[c].y > cBefore.y || saved[c].x !== cBefore.x, `${name}: ${c} moved out of the way (y ${cBefore.y} → ${saved[c].y})`);

  // Sides: bottom taller, right wider (computer), top and left.
  await page.$eval(`.fr-item[data-panel="${b}"]`, (e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const side = async (id, which, dx, dy) => {
    const g = await page.locator(`.fr-item[data-panel="${id}"] .fr-${which}`).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + dx, g.y + g.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    return (await cellsOf('project', key))[id];
  };
  const p0 = (await cellsOf('project', key))[b];
  const p1 = await side(b, 'bottom', 0, 2 * 44 + 10);
  ok(p1.h === p0.h + 2, `${name}: the bottom grabber makes it taller (${p0.h} → ${p1.h} rows)`);
  const p2 = await side(b, 'top', 0, 44 + 10);
  ok(p2.h === p1.h - 1 && p2.y === p1.y + 1, `${name}: the top grabber moves its top edge (y ${p1.y} → ${p2.y})`);
  if (!phone) {
    const col = (await page.locator('.fr-board').boundingBox()).width / 12;
    const p3 = await side(b, 'left', col * 2 + 4, 0);
    ok(p3.w === p2.w - 2 && p3.x === p2.x + 2, `${name}: the left grabber moves its left edge (x ${p2.x} → ${p3.x})`);
    const p4 = await side(b, 'right', col * 3 + 4, 0);
    ok(p4.w === Math.min(12 - p3.x, p3.w + 3), `${name}: the right grabber makes it wider (${p3.w} → ${p4.w})`);
  } else {
    const col = (await page.locator('.fr-board').boundingBox()).width / 4;
    const p3 = await side(b, 'right', -col * 2 - 4, 0);
    ok(p3.w === Math.max(1, p2.w - 2), `${name}: the right grabber makes it narrower on a phone (${p2.w} → ${p3.w} of 4)`);
  }
  ok(!anyOverlap(await cellsOf('project', key)), `${name}: still nothing overlaps`);
  await shot(page, `${name}-arranged`);

  // ✕ and Undo.
  const removable = ids.find((id) => id !== 'board' && id !== 'delete');
  if (await page.$(`.fr-item[data-panel="${removable}"] .fr-x`)) {
    await page.click(`.fr-item[data-panel="${removable}"] .fr-x`);
    await page.waitForTimeout(500);
    ok(!(await page.$(`.fr-item[data-panel="${removable}"]`)), `${name}: ✕ removes ${removable}`);
    await page.click('.toast button:has-text("Undo")');
    await page.waitForSelector(`.fr-item[data-panel="${removable}"]`);
    ok(true, `${name}: Undo brings it back`);
  }

  // Finishing.
  if (phone) {
    const bx = await page.locator('.fr-board').boundingBox();
    const free = await page.evaluate(() => {
      const b = document.querySelector('.fr-board').getBoundingClientRect();
      for (let y = b.bottom - 10; y > b.top; y -= 20) for (let x = b.left + 10; x < b.right; x += 20) if (document.elementFromPoint(x, y)?.classList.contains('fr-board')) return { x, y };
      return null;
    });
    ok(!!free, `${name}: an empty spot to tap (board ${Math.round(bx.height)} px tall)`);
    await page.mouse.click(free.x, free.y);
  } else await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok(!(await page.$('.fr-arranging')), `${name}: ${phone ? 'a tap on an empty spot' : 'Esc'} finishes`);
  const other = [b, c, a].find((id) => id !== 'board');
  await page.$eval(`.fr-item[data-panel="${other}"]`, (e) => e.scrollIntoView({ block: 'center' }));
  await hold(page, other);
  await page.mouse.up();
  await page.click('.fr-done');
  await page.waitForTimeout(300);
  ok(!(await page.$('.fr-arranging')), `${name}: Done finishes`);

  // A reload keeps the places.
  const kept = await boxes(page);
  await page.reload();
  await page.waitForSelector('.fr-board .fr-item');
  await page.waitForTimeout(800);
  const again = await boxes(page);
  ok(Object.keys(kept).every((id) => again[id] && again[id].x === kept[id].x && again[id].y === kept[id].y && again[id].h === kept[id].h), `${name}: the same after a reload`);
  ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${name}: still no sideways scroll`);
}

for (const theme of ['light', 'eink']) {
  await reset();
  {
    const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name: `${theme}-1280`, reducedMotion: 'reduce', init: theme === 'eink' ? eink : undefined });
    await run(page, `${theme}-1280`, 'cells', false);
    await ctx.close();
  }
  ok(Object.keys(await cellsOf('project', 'phone')).length === 0, `${theme}: arranging on a computer leaves the phone's places alone`);
  {
    const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name: `${theme}-390`, touch: true, reducedMotion: 'reduce', init: theme === 'eink' ? eink : undefined });
    await run(page, `${theme}-390`, 'phone', true);
    await ctx.close();
  }
}

// The Desktop page in a narrow window with a mouse is the phone's board (4 columns).
{
  const { page, ctx } = await open(browser, { width: 600, height: 1000 }, errors, { name: 'desktop-600' });
  await page.goto(`${B}/#/desktop`);
  await page.waitForSelector('.fr-board .fr-item');
  ok((await page.getAttribute('.fr-board', 'data-kind')) === 'phone', 'desktop-600: the Desktop page in a narrow window uses 4 columns');
  const first = await page.$eval('.fr-item', (e) => e.dataset.panel);
  await hold(page, first);
  ok(!!(await page.$('.fr-arranging')), 'desktop-600: a long mouse press arranges the Desktop');
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await ctx.close();
}

// The flag off: the older grid.
await api.put('/features/free-panels', { enabled: false });
{
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name: 'off' });
  await page.goto(`${B}/#/p/${project.id}`);
  await page.waitForSelector('.lg-grid .lg-item');
  ok(!(await page.$('.fr-board')), 'flag off: the older grid is back');
  await ctx.close();
}
await api.put('/features/free-panels', { enabled: true });
await reset();
for (const id of linkedIds) await api.call('DELETE', `/lists/${id}`);
await browser.close();
if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
console.log('all free arranging checks passed');
