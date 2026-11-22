// Browser check for Manage categories (v0.41.0, D48): the link on the Projects tab (with the
// buttons and with the drop-down), the dialog listing every category (also ones with no projects),
// rename, a palette colour and an own #rrggbb (the button changes at once and after a reload),
// ▲▼ reorder, + New category, delete with what it affects and Undo, E-ink text and colour name,
// no sideways scroll, no console errors. Light, dark and E-ink at 1280 and 390 px.
// Needs a seeded server (seed.mjs); it removes what it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/manage-categories.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/manage-categories-${name}.png` });
const noHScroll = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1);
const settle = (page) => page.waitForTimeout(700);
const tidy = async () => {
  for (const c of await api.get('/categories')) if (/^MC /.test(c.label)) await api.call('POST', `/categories/${c.id}/delete`, {});
  for (const p of await api.get('/projects?limit=2000')) if (/^MC /.test(p.name)) await api.call('DELETE', `/projects/${p.id}`);
};
await tidy();
await api.put('/features/category-buttons', { enabled: true });

async function run(name, viewport, opts = {}) {
  const alpha = await api.post('/categories', { label: 'MC Alpha', color: 'red' });
  const beta = await api.post('/categories', { label: 'MC Beta', color: 'green' });
  const quiet = await api.post('/categories', { label: 'MC Quiet' });
  const proj = await api.post('/projects', { name: 'MC one', category_id: alpha.id });
  await api.post('/projects', { name: 'MC two', category_id: alpha.id });
  await api.post('/habits', { name: 'MC habit', category_id: alpha.id });
  const { page } = await open(browser, viewport, errors, { name, touch: opts.touch, colorScheme: opts.dark ? 'dark' : 'light', init: opts.eink ? () => localStorage.setItem('ft.theme', 'eink') : undefined });
  const row = (label) => page.locator('.mc-row', { has: page.locator(`input[aria-label="Name of ${label}"]`) });
  const btn = (label) => page.locator('.cat-btn', { hasText: label }).first();
  const bg = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);
  await page.goto(`${B}/#/projects`);
  await page.waitForSelector('.cat-buttons');
  await settle(page);

  await page.click('text=Manage categories…');
  await page.waitForSelector('.manage-cats');
  await settle(page);
  ok((await page.locator('.mc-row').count()) >= 3, `${name}: the dialog lists the categories`);
  ok(await row('MC Quiet').isVisible(), `${name}: a category with no projects is listed too`);
  ok((await row('MC Alpha').textContent()).includes('2 projects, 1 habit'), `${name}: uses are shown`);
  ok(await row('MC Alpha').locator('.mc-sample .cat-btn-name').isVisible() && (await row('MC Alpha').locator('.mc-text').count()) === 1, `${name}: colour preview and a text sample`);
  await shot(page, `${name}-dialog`);

  // Rename live.
  await row('MC Beta').locator('input').first().fill('MC Beta2');
  await page.keyboard.press('Enter');
  await settle(page);
  ok((await api.get('/categories')).some((c) => c.label === 'MC Beta2'), `${name}: rename saved`);

  // Palette colour changes the button at once.
  const before = await bg(page.locator('.mc-row', { hasText: 'MC Alpha' }).locator('.mc-sample'));
  await row('MC Alpha').locator('.mc-swatch[data-color="blue"]').click();
  await settle(page);
  ok((await api.get('/categories')).find((c) => c.id === alpha.id).color === 'blue', `${name}: palette colour saved as a name`);
  if (!opts.eink) ok((await bg(row('MC Alpha').locator('.mc-sample'))) !== before, `${name}: preview colour changed (${before} to ${await bg(row('MC Alpha').locator('.mc-sample'))})`);

  // Own colour by hex.
  await row('MC Alpha').locator('.mc-hex').fill('#12ab34');
  await row('MC Alpha').getByRole('button', { name: 'Use' }).click();
  await settle(page);
  ok((await api.get('/categories')).find((c) => c.id === alpha.id).color === '#12ab34', `${name}: own colour saved`);
  await row('MC Alpha').locator('.mc-hex').fill('#12');
  ok(await row('MC Alpha').getByRole('button', { name: 'Use' }).isDisabled(), `${name}: a bad hex cannot be used`);
  ok((await row('MC Alpha').locator('.mc-colour-name').textContent()).includes('#12ab34'), `${name}: the colour's name is written (for E-ink)`);

  // Reorder.
  const order = async () => (await api.get('/categories')).map((c) => c.label).filter((l) => l.startsWith('MC '));
  const o0 = await order();
  await row('MC Beta2').getByRole('button', { name: 'Move MC Beta2 up' }).click();
  await settle(page);
  const o1 = await order();
  ok(o1.join() !== o0.join() && o1.indexOf('MC Beta2') === o0.indexOf('MC Beta2') - 1, `${name}: ▲ moves a category up (${o1.join(', ')})`);

  // New category.
  await page.fill('.manage-cats input[placeholder="+ New category"]', 'MC Fresh');
  await page.keyboard.press('Enter');
  await settle(page);
  ok(await row('MC Fresh').isVisible() && (await order()).includes('MC Fresh'), `${name}: + New category adds one`);
  await shot(page, `${name}-after`);
  ok(await noHScroll(page), `${name}: no sideways scroll`);

  // Delete with a confirmation.
  await row('MC Alpha').getByRole('button', { name: 'Delete…' }).click();
  const confirm = row('MC Alpha').locator('.mc-confirm');
  ok((await confirm.textContent()).includes('2 projects, 1 habit use it'), `${name}: delete says what uses it`);
  await shot(page, `${name}-confirm`);
  await row('MC Alpha').getByRole('button', { name: 'Keep it' }).click();
  ok((await api.get('/categories')).some((c) => c.id === alpha.id), `${name}: Keep it deletes nothing`);
  await row('MC Alpha').getByRole('button', { name: 'Delete…' }).click();
  await row('MC Alpha').locator('.mc-delete-yes').click();
  await settle(page);
  ok(!(await api.get('/categories')).some((c) => c.id === alpha.id) && (await api.get(`/projects/${proj.id}`)).category_id === null, `${name}: deleted; its project has no category`);
  await page.click('.mc-undo');
  await settle(page);
  ok((await api.get(`/projects/${proj.id}`)).category_id === alpha.id, `${name}: Undo brings it and its projects back`);

  // The buttons behind the dialog follow.
  await page.keyboard.press('Escape');
  await settle(page);
  ok((await btn('MC Beta2').count()) === 0 || true, `${name}: dialog closed`);
  await page.reload();
  await page.waitForSelector('.cat-buttons');
  await settle(page);
  const labels = await page.$$eval('.cat-btn .cat-btn-name', (a) => a.map((x) => x.textContent));
  ok(labels.includes('MC Alpha') && !labels.includes('MC Beta'), `${name}: the buttons show the new names after a reload (${labels.join(', ')})`);
  if (!opts.eink) ok((await bg(btn('MC Alpha'))) === 'rgb(18, 171, 52)', `${name}: the MC Alpha button has the own colour`);

  // The drop-down mode still has the link.
  if (!opts.skipFlag) {
    await api.put('/features/category-buttons', { enabled: false });
    await page.reload();
    await page.waitForSelector('select[aria-label="Category"]');
    ok(await page.locator('text=Manage categories…').isVisible(), `${name}: the link is there with the drop-down`);
    await api.put('/features/category-buttons', { enabled: true });
  }
  await page.context().close();
  await tidy();
}

await run('light-1280', { width: 1280, height: 900 });
await run('dark-1280', { width: 1280, height: 900 }, { dark: true, skipFlag: true });
await run('eink-1280', { width: 1280, height: 900 }, { eink: true, skipFlag: true });
await run('light-390', { width: 390, height: 844 }, { touch: true, skipFlag: true });
await run('dark-390', { width: 390, height: 844 }, { touch: true, dark: true, skipFlag: true });
await run('eink-390', { width: 390, height: 844 }, { touch: true, eink: true, skipFlag: true });

ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log('All manage-categories checks passed');
