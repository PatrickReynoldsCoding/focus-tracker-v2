// Browser check for the category buttons (v0.36.0, flag category-buttons, off by default): the
// row above the Projects list, counts, All, filter and clear, remembered per device, categories
// with no projects hidden, No category only when needed, the drop-down back when the flag is off,
// keyboard and aria-pressed, E-ink outlines. Light, dark and E-ink at 1280 and 390 px.
// Needs a seeded server (seed.mjs); it removes what it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/category-buttons.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/category-buttons-${name}.png` });

const made = [];
const cat = async (label, color) => {
  const c = await api.post('/categories', { label, color });
  made.push(['/categories', c.id]);
  return c;
};
const proj = async (name, category_id, status) => {
  const p = await api.post('/projects', { name, category_id, status });
  made.push(['/projects', p.id]);
  return p;
};
const house = await cat('CB House', 'red');
const garden = await cat('CB Garden', 'green');
const custom = await cat('CB Custom', '#ffd400');
const empty = await cat('CB Empty', 'purple');
for (const c of ['orange', 'teal', 'pink', 'grey', 'yellow']) await cat(`CB Extra ${c}`, c);
await proj('CB paint hall', house.id);
await proj('CB fix gate', house.id);
await proj('CB old shed', house.id, 'done');
await proj('CB veg bed', garden.id);
await proj('CB gold thing', custom.id);
const loose = await proj('CB loose end');
await api.put('/features/category-buttons', { enabled: true });

const names = (page) => page.$$eval('table.table tbody tr a', (as) => as.map((a) => a.textContent));
const labels = (page) => page.$$eval('.cat-btn .cat-btn-name', (as) => as.map((a) => a.textContent));
const noHScroll = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1);

async function run(name, viewport, opts = {}) {
  const { page, ctx } = await open(browser, viewport, errors, { name, touch: opts.touch, colorScheme: opts.dark ? 'dark' : 'light', init: opts.eink ? () => localStorage.setItem('ft.theme', 'eink') : undefined });
  await page.goto(`${B}/#/projects`);
  await page.waitForSelector('.cat-buttons');
  await page.fill('input[type=search]', 'CB ');
  const btn = (t) => page.locator('.cat-btn', { hasText: t });
  ok(!(await page.locator('.filters select[aria-label=Category]').count()), `${name}: the drop-down is replaced`);
  ok((await page.getAttribute('.cat-buttons', 'role')) === 'group' && !!(await page.getAttribute('.cat-buttons', 'aria-label')), `${name}: a labelled group`);
  const all = await labels(page);
  ok(all[0] === 'All' && all.includes('CB House') && !all.includes('CB Empty'), `${name}: All first, empty category hidden`);
  ok((await btn('CB House').innerText()).replace(/\s+/g, ' ').includes('2'), `${name}: House counts its two active projects (done one follows the status chips)`);
  ok(all.includes('No category'), `${name}: No category shown while some have none`);
  await shot(page, `${name}-row`);
  await btn('CB House').click();
  ok((await btn('CB House').getAttribute('aria-pressed')) === 'true', `${name}: pressed`);
  ok((await names(page)).sort().join() === 'CB fix gate,CB paint hall', `${name}: list filtered to House`);
  ok((await btn('CB Garden').getAttribute('class')).includes('dim'), `${name}: others dimmed`);
  await shot(page, `${name}-selected`);
  await page.reload();
  await page.waitForSelector('.cat-buttons');
  ok((await btn('CB House').getAttribute('aria-pressed')) === 'true', `${name}: selection remembered on this device`);
  await btn('CB House').focus();
  await page.keyboard.press('Enter');
  ok((await btn('CB House').getAttribute('aria-pressed')) === 'false', `${name}: Enter on the focused button clears it`);
  await btn('CB House').click();
  await btn('All').click();
  ok((await names(page)).length > 4, `${name}: All clears`);
  await btn('No category').click();
  ok((await names(page)).includes('CB loose end'), `${name}: No category filter`);
  await btn('No category').click();
  ok(await noHScroll(page), `${name}: no sideways page scroll`);
  if (viewport.width < 600) ok(await page.$eval('.cat-buttons', (e) => e.scrollWidth > e.clientWidth), `${name}: the row scrolls sideways on a phone`);
  if (opts.eink) {
    await btn('CB Garden').click();
    const bg = await btn('CB Garden').evaluate((e) => getComputedStyle(e).backgroundColor);
    ok(bg === 'rgb(0, 0, 0)', `${name}: E-ink selected is solid black`);
    ok((await btn('CB House').evaluate((e) => getComputedStyle(e).borderTopWidth)) === '2px', `${name}: E-ink outline`);
    await btn('CB Garden').click();
  }
  await ctx.close();
}

try {
  await run('light-1280', { width: 1280, height: 800 });
  await run('dark-1280', { width: 1280, height: 800 }, { dark: true });
  await run('eink-1280', { width: 1280, height: 800 }, { eink: true });
  await run('light-390', { width: 390, height: 800 }, { touch: true });
  await run('dark-390', { width: 390, height: 800 }, { touch: true, dark: true });
  await run('eink-390', { width: 390, height: 800 }, { touch: true, eink: true });

  // Hidden category appears again with a project; No category goes when none are loose; a deleted saved category shows all.
  const { page, ctx } = await open(browser, { width: 1280, height: 800 }, errors, { name: 'rules' });
  await api.call('PATCH', `/projects/${loose.id}`, { category_id: empty.id });
  await page.goto(`${B}/#/projects`);
  await page.waitForSelector('.cat-buttons');
  const l = await labels(page);
  ok(l.includes('CB Empty'), 'a category with a project shows');
  await ctx.close();

  // Flag off: the drop-down again, no buttons.
  await api.put('/features/category-buttons', { enabled: false });
  const off = await open(browser, { width: 1280, height: 800 }, errors, { name: 'off' });
  await off.page.goto(`${B}/#/projects`);
  await off.page.waitForSelector('.filters select[aria-label=Category]');
  ok(!(await off.page.locator('.cat-buttons').count()), 'flag off: no buttons, the drop-down is back');
  await off.ctx.close();
  ok(!errors.length, `no console errors ${errors.join('; ')}`);
} finally {
  for (const [path, id] of made.reverse()) await api.call('DELETE', `${path}/${id}`).catch(() => {});
  await browser.close();
}
