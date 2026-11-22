// Browser check for the small note (v0.33.1): a note in a narrow panel on Today and on a project's
// page, and the note preview on Files cards, keep the note's line breaks and extra blank lines as
// in the editor; the small note has its own scroll (the panel does not grow with the text), and
// the resize handle still sets its height. Light, dark and E-ink at 390 and 1280 px.
// Needs a seeded server (seed.mjs); it removes what it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/note-small.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/note-small-${name}.png` });
const settle = (page) => page.waitForTimeout(700);
const eink = () => localStorage.setItem('ft.theme', 'eink');

const para = (i) => `Paragraph ${i} first line\nParagraph ${i} second line, a single newline above`;
const BODY = ['# NS long note', ...Array.from({ length: 14 }, (_, i) => para(i + 1)), 'First after three blank lines\n\n\n\nLast line of the note'].join('\n\n');
const note = await api.post('/lists', { name: 'NS long note', kind: 'note' });
await api.put(`/notes/of/list/${note.id}`, { body: BODY });
await api.put('/today-panels/show', { list_id: note.id, on: true });
await api.put('/features/desktop-pills', { enabled: true });
await api.call('DELETE', '/layout/today/pills').catch(() => {});
await api.call('DELETE', '/layout/today/grid').catch(() => {});

const lineY = (page, sel, text) => page.locator(sel).evaluate((root, t) => {
  const el = [...root.querySelectorAll('p')].find((p) => p.textContent.includes(t));
  return el ? el.getBoundingClientRect().top : null;
}, text);

/** The small note's checks on a page that shows it. */
async function checkSmall(page, name, scope) {
  const box = page.locator(`${scope} .ed-scroll`);
  await box.waitFor();
  await page.waitForTimeout(500);
  const sizes = await box.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight, oy: getComputedStyle(e).overflowY }));
  ok(sizes.oy === 'auto' && sizes.sh > sizes.ch + 20, `${name}: the small note scrolls (${sizes.ch}px box, ${sizes.sh}px of text)`);
  const h1 = await page.locator(scope).first().evaluate((e) => e.getBoundingClientRect().height);
  ok(h1 < 460, `${name}: the panel keeps a fixed height (${Math.round(h1)}px) and does not follow the text`);
  const brs = await box.evaluate((e) => e.querySelectorAll('br').length);
  ok(brs >= 14, `${name}: single newlines are line breaks (${brs} breaks)`);
  const blanks = await box.evaluate((e) => [...e.querySelectorAll('.ProseMirror > p')].filter((p) => !p.textContent.trim()).length);
  ok(blanks >= 2, `${name}: extra blank lines are kept (${blanks})`);
  await box.evaluate((e) => (e.scrollTop = e.scrollHeight));
  await page.waitForTimeout(200);
  ok(await page.locator(`${scope} .ed-scroll`).getByText('Last line of the note').isVisible(), `${name}: scrolling inside reaches the end of the note`);
  const gap = await box.evaluate((e) => {
    const ps = [...e.querySelectorAll('p')];
    const a = ps.find((p) => p.textContent.startsWith('First after three'));
    const b = ps.find((p) => p.textContent.startsWith('Last line'));
    return b.getBoundingClientRect().top - a.getBoundingClientRect().bottom;
  });
  ok(gap > 30, `${name}: the blank lines show as space (${Math.round(gap)}px)`);
  await box.evaluate((e) => (e.scrollTop = 0));
}

/** Drag the panel's resize corner by (dx, dy), scrolling it into view first. */
async function dragCorner(page, panel, dx, dy) {
  await page.locator(`.lg-item${panel} .lg-resize`).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  let h = await page.locator(`.lg-item${panel} .lg-resize`).boundingBox();
  await page.mouse.move(h.x + 8, h.y + 8);
  await page.waitForTimeout(200);
  h = await page.locator(`.lg-item${panel} .lg-resize`).boundingBox();
  await page.mouse.move(h.x + 8, h.y + 8);
  await page.mouse.down();
  await page.mouse.move(h.x + 8 + dx, h.y + 8 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}

async function run(name, viewport, opts = {}) {
  await api.call('DELETE', '/layout/today/grid').catch(() => {});
  await api.call('DELETE', '/layout/today/stack').catch(() => {});
  const { page } = await open(browser, viewport, errors, { name, touch: opts.touch, colorScheme: opts.dark ? 'dark' : 'light', init: opts.eink ? eink : undefined });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await page.click('.pl-pill:has-text("All")').catch(() => {});
  await settle(page);
  const panel = `[data-panel="list-${note.id}"]`;
  const wide = viewport.width > 700;
  if (wide) {
    // Narrow it and make it shorter with the corner handle: the small version shows, in the height the owner set.
    await dragCorner(page, panel, -250, -400);
    const set = await page.locator(`${panel} .tp-note`).evaluate((e) => e.getBoundingClientRect().height);
    const fit = await page.locator(`${panel} .ed-scroll`).evaluate((e) => ({ ch: e.clientHeight, sh: e.scrollHeight }));
    ok(set < 700 && fit.ch > 100 && fit.sh > fit.ch + 20, `${name}: a panel set to ${Math.round(set)}px high shows a ${fit.ch}px text box that scrolls (${fit.sh}px of text)`);
    await shot(page, `${name}-today-set`);
    // ⋯ Auto height: the text box keeps its own height, the panel does not grow with the note.
    await page.hover(`.lg-item${panel}`, { position: { x: 200, y: 6 } });
    await page.click(`.lg-item${panel} .lg-more`);
    await page.click('.files-menu button:has-text("Auto height")');
    await settle(page);
  }
  await page.locator(panel).scrollIntoViewIfNeeded();
  await checkSmall(page, name, `${panel} .tp-note.panel-small`);
  await shot(page, `${name}-today`);
  if (wide) {
    // The owner's resize handle still sets the height; the text box fills it and scrolls.
    const before = await page.locator(`${panel} .tp-note`).evaluate((e) => e.getBoundingClientRect().height);
    await dragCorner(page, panel, 0, 208);
    const after = await page.locator(`${panel} .tp-note`).evaluate((e) => e.getBoundingClientRect().height);
    ok(after > before + 100, `${name}: dragging the corner makes the panel taller (${Math.round(before)} → ${Math.round(after)})`);
    const box = await page.locator(`${panel} .ed-scroll`).evaluate((e) => ({ ch: e.clientHeight, sh: e.scrollHeight }));
    ok(box.ch > 200 && box.ch < after && box.sh > box.ch, `${name}: the text box grew with the panel (${box.ch}px) and still scrolls (${box.sh}px)`);
    await shot(page, `${name}-today-tall`);
  }

  // Files: the card's preview keeps the line breaks.
  await page.goto(`${B}/#/files?type=notes`);
  await page.waitForSelector('.file-grid, .file-list');
  await page.fill('.files-search', 'NS long');
  await settle(page);
  if (await page.$('.file-list')) await page.click('.files-view-toggle'), await settle(page);
  const card = page.locator('.file-card', { hasText: 'NS long note' });
  const fb = await card.locator('.file-text-preview br, .file-text-preview p').count();
  ok(fb >= 3, `${name}: the Files card preview is formatted text with its own lines (${fb})`);
  ok(await card.locator('.file-text-preview br').count() >= 1, `${name}: the preview keeps a single newline as a line break`);
  await shot(page, `${name}-files`);
  const noH = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1);
  ok(noH, `${name}: no sideways scroll`);
  await page.context().close();
}

try {
  await run('light-1280', { width: 1280, height: 900 });
  await run('dark-1280', { width: 1280, height: 900 }, { dark: true });
  await run('eink-1280', { width: 1280, height: 900 }, { eink: true });
  await run('light-390', { width: 390, height: 800 }, { touch: true });
  await run('dark-390', { width: 390, height: 800 }, { touch: true, dark: true });
  await run('eink-390', { width: 390, height: 800 }, { touch: true, eink: true });
  ok(!errors.length, `no console errors ${errors.join('; ')}`);
} finally {
  if (!process.env.NS_KEEP) await api.call("DELETE", `/lists/${note.id}`).catch(() => {});
  await browser.close();
}
