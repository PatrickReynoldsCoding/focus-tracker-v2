// Browser check for tags (v0.37.0, D43, flag tags): chips on Files cards and rows (with the
// project label, inside the card's footer, first two then "+n"), the Tags filter row (several =
// all of them, No tag, Clear, a chip on a card filters by it), search finding a tag's name, the
// tag editor from a file's ⋯ menu (suggestions while typing, a new name makes a tag, ✕ takes one
// off), Manage tags (rename, colour, merge, delete with Undo), the tags on a note's page header,
// Add file's rows, no sideways scroll, E-ink outlines, the flag off. Light, dark and E-ink at
// 1280 and 390 px. Needs a seeded server (seed.mjs); it removes what it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/tags.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/tags-${name}.png` });
const settle = (page) => page.waitForTimeout(700);
const theme = (t) => `localStorage.setItem('ft.theme', '${t}')`;
const noHScroll = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1);

await api.put('/features/tags', { enabled: true });
const p1 = (await api.get('/projects')).find((p) => p.name === 'Focus Tracker v2');
const recipes = await api.post('/lists', { name: 'TG recipes', kind: 'note', project_id: p1.id });
await api.put(`/notes/of/list/${recipes.id}`, { body: 'Soup, bread and a long list of things to cook.' });
const loose = await api.post('/lists', { name: 'TG loose', kind: 'note' });
const jobs = await api.post('/lists', { name: 'TG jobs', kind: 'todo' });
const urgent = await api.post('/tags', { name: 'TG urgent', color: 'red' });
const home = await api.post('/tags', { name: 'TG home', color: 'green' });
await api.post('/tags/set', { type: 'note', id: recipes.id, add: [urgent.id, home.id, 'TG extra'] });
await api.post('/tags/set', { type: 'todo', id: jobs.id, add: [home.id] });
const tagsOf = async (type, id) => (await api.get(`/tags/of/${type}/${id}`)).map((t) => t.name).sort();

async function filesWith(page, url) {
  await page.goto(`${B}/#${url}`);
  await page.waitForSelector('.file-grid, .file-list, .files .empty');
  await settle(page);
}

async function run(name, viewport, opts = {}) {
  const { page, ctx } = await open(browser, viewport, errors, { name, touch: opts.touch, init: opts.theme ? theme(opts.theme) : undefined, colorScheme: opts.theme === 'dark' ? 'dark' : 'light' });

  // The Tags row and a filter by one tag: grid with chips in the card's footer.
  await filesWith(page, '/files');
  if (await page.$('.file-list')) await page.click('.files-view-toggle'), await settle(page);
  ok(await page.locator('.tag-filter-chip', { hasText: '#TG urgent' }).isVisible(), `${name}: Files has a Tags row with the profile's tags`);
  await page.click('.tag-filter-chip:has-text("#TG urgent")');
  await page.waitForSelector('.file-card:has-text("TG recipes")');
  await settle(page);
  ok((await page.locator('.tag-filter-chip:has-text("#TG urgent")').getAttribute('aria-pressed')) === 'true', `${name}: the chosen tag is pressed`);
  let names = await page.$$eval('.file-card .files-name', (els) => els.map((e) => e.textContent));
  ok(names.join() === 'TG recipes', `${name}: filtering by a tag shows only its files (${names.join(', ')})`);
  const card = page.locator('.file-card', { hasText: 'TG recipes' });
  const chips = await card.locator('.tag-chip').allTextContents();
  ok(chips.length === 3 && chips[2] === '+1', `${name}: a card shows two tags then +1 (${chips.join(' ')})`);
  ok((await card.locator('.project-label').count()) === 1, `${name}: the project label is still there beside the tags`);
  const cb = await card.boundingBox();
  const tb = await card.locator('.file-thumb').boundingBox();
  const nb = await card.locator('.files-name').boundingBox();
  for (const el of await card.locator('.file-labels > *, .tag-chip').all()) {
    const b = await el.boundingBox();
    if (!b || !b.width) continue;
    ok(b.x >= cb.x - 1 && b.x + b.width <= cb.x + cb.width + 1 && b.y >= tb.y + tb.height - 1 && b.y >= nb.y + nb.height - 1, `${name}: a label sits in the card's footer, inside the card`);
  }
  ok(await noHScroll(page), `${name}: no sideways scroll with the Tags row`);
  if (opts.theme === 'eink') ok((await card.locator('.tag-chip').first().evaluate((e) => getComputedStyle(e).borderTopWidth)) === '2px', `${name}: E-ink draws tags with an outline`);
  await shot(page, `${name}-filter-grid`);

  // Two tags: files with both. No tag. Clear.
  await page.click('.tag-filter-chip:has-text("#TG home")');
  await settle(page);
  names = await page.$$eval('.file-card .files-name', (els) => els.map((e) => e.textContent));
  ok(names.join() === 'TG recipes', `${name}: two tags show files with both`);
  await page.click('.tag-filter-chip:has-text("No tag")');
  await settle(page);
  names = await page.$$eval('.file-card .files-name', (els) => els.map((e) => e.textContent));
  ok(names.includes('TG loose') && !names.includes('TG recipes') && !names.includes('TG jobs'), `${name}: No tag shows untagged files only`);
  await page.click('.tag-filter-clear');
  await settle(page);
  ok(!(await page.$('.tag-filter-chip[aria-pressed="true"]')), `${name}: Clear takes the tag filter off`);

  // The list view: chips beside the name, no sideways scroll.
  await page.click('.files-view-toggle');
  await page.click('.tag-filter-chip:has-text("#TG home")');
  await page.waitForSelector('.file-row:has-text("TG jobs")');
  await settle(page);
  const row = page.locator('.file-row', { hasText: 'TG recipes' });
  const rb = await row.boundingBox();
  ok(rb.height < 90, `${name}: a row with a project label and tags stays small (${Math.round(rb.height)} px)`);
  ok(await noHScroll(page), `${name}: no sideways scroll in the list`);
  await shot(page, `${name}-filter-list`);
  await page.click('.tag-filter-clear');
  await settle(page);
  await page.click('.files-view-toggle');
  await settle(page);

  // Search finds a tag's name.
  await page.fill('.files-search', 'TG extra');
  await page.waitForSelector('.file-card:has-text("TG recipes")');
  ok(true, `${name}: searching a tag's name finds its files`);
  await page.fill('.files-search', '');
  await settle(page);

  // A chip on a card filters Files by it.
  await page.click('.tag-filter-chip:has-text("#TG home")');
  await page.waitForSelector('.file-card:has-text("TG recipes")');
  await page.click('.tag-filter-clear');
  await settle(page);
  await filesWith(page, `/files?tag=${urgent.id}`);
  await page.locator('.file-card', { hasText: 'TG recipes' }).locator('.tag-chip', { hasText: '#TG home' }).click();
  await page.waitForFunction(() => location.hash.includes('tag='));
  await settle(page);
  ok((await page.locator('.tag-filter-chip:has-text("#TG home")').getAttribute('aria-pressed')) === 'true', `${name}: tapping a tag on a card filters Files by it`);
  names = await page.$$eval('.file-card .files-name', (els) => els.map((e) => e.textContent).sort());
  ok(names.join() === 'TG jobs,TG recipes', `${name}: …showing its files (${names.join(', ')})`);

  // The editor from ⋯: suggestions, a new tag, take one off.
  await page.locator('.file-card', { hasText: 'TG jobs' }).locator('.files-more').click();
  await page.click('.files-menu-item:has-text("Tags…")');
  await page.waitForSelector('dialog[open] .tag-editor');
  await page.fill('dialog[open] .tag-editor-add input', 'TG urg');
  await page.waitForSelector('dialog[open] .tag-suggestion:has-text("#TG urgent")');
  ok(true, `${name}: typing suggests a tag`);
  await settle(page);
  await shot(page, `${name}-editor`);
  await page.click('dialog[open] .tag-suggestion:has-text("#TG urgent")');
  await page.fill('dialog[open] .tag-editor-add input', `TG new ${name}`);
  ok(await page.locator('dialog[open] .tag-make').isVisible(), `${name}: an unknown name offers Make`);
  await page.press('dialog[open] .tag-editor-add input', 'Enter');
  await page.waitForSelector(`dialog[open] .tag-editor-on .tag-chip:has-text("TG new ${name}")`);
  await page.waitForTimeout(900);
  ok((await tagsOf('todo', jobs.id)).join() === ['TG home', `TG new ${name}`, 'TG urgent'].sort().join(), `${name}: the editor adds a known tag and makes a new one`);
  await page.click(`dialog[open] .tag-chip-x[aria-label="Remove tag TG new ${name}"]`);
  await page.waitForTimeout(900);
  ok(!(await tagsOf('todo', jobs.id)).includes(`TG new ${name}`), `${name}: ✕ takes a tag off`);
  ok(await noHScroll(page), `${name}: the editor fits`);
  await page.click('dialog[open] button:has-text("Done")');
  await settle(page);
  ok((await page.locator('.file-card', { hasText: 'TG jobs' }).locator('.tag-chip').allTextContents()).includes('#TG urgent'), `${name}: the card shows the new tag`);
  await api.post('/tags/set', { type: 'todo', id: jobs.id, remove: [urgent.id] });
  for (const t of await api.get('/tags')) if (t.name === `TG new ${name}`) await api.call('DELETE', `/tags/${t.id}`);

  // A note's page: its tags in the header.
  await page.goto(`${B}/#/n/${recipes.id}`);
  await page.waitForSelector('.page-head .tags-header .tag-chip');
  ok((await page.locator('.page-head .tags-header .tag-chip').count()) === 3, `${name}: a note's page shows its tags in the header`);
  ok(await page.locator('.tags-header-edit').isVisible(), `${name}: …with a button to edit them`);
  ok(await noHScroll(page), `${name}: no sideways scroll on the note's page`);
  await settle(page);
  await shot(page, `${name}-note-page`);

  await ctx.close();
}

async function manage() {
  const name = 'manage';
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name, touch: true });
  await api.post('/tags', { name: 'TG merge me' });
  await filesWith(page, '/files');
  await page.click('.tag-filter-manage');
  await page.waitForSelector('dialog[open] .manage-tags-list');
  await page.click('dialog[open] .manage-tag-head:has-text("TG merge me")');
  await page.fill('dialog[open] .manage-tag.open input', 'TG merged');
  await page.click('dialog[open] .manage-tag.open button:text-is("Rename")');
  await page.waitForTimeout(800);
  ok((await api.get('/tags')).some((t) => t.name === 'TG merged'), `${name}: rename`);
  await page.click('dialog[open] .manage-tag.open .swatch[aria-label="blue"]');
  await page.waitForTimeout(800);
  ok((await api.get('/tags')).find((t) => t.name === 'TG merged').color === 'blue', `${name}: colour`);
  await settle(page);
  await shot(page, `${name}-dialog`);
  ok(await noHScroll(page), `${name}: the dialog fits a phone`);
  await page.selectOption('dialog[open] .manage-tag.open select', { label: '#TG home' });
  await page.click('dialog[open] .manage-tag.open button:text-is("Merge")');
  await page.waitForTimeout(800);
  ok(!(await api.get('/tags')).some((t) => t.name === 'TG merged'), `${name}: merge into another tag`);
  // Delete a tag that is on files: it asks, then Undo brings it back.
  page.once('dialog', (d) => d.accept());
  await page.click('dialog[open] .manage-tag-head:has-text("TG extra")');
  await page.click('dialog[open] .manage-tag.open .manage-tag-delete');
  await page.waitForTimeout(800);
  ok(!(await api.get('/tags')).some((t) => t.name === 'TG extra'), `${name}: delete a tag`);
  await api.post('/undo');
  ok((await tagsOf('note', recipes.id)).includes('TG extra'), `${name}: Undo brings the tag back on its file`);
  await ctx.close();
}

async function addFile() {
  const name = 'add-file';
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-add');
  await page.click('.pl-add');
  await page.click('dialog[open] .ap-file');
  await page.fill('dialog[open] input[type=search]', 'TG recipes');
  await page.waitForSelector('dialog[open] .ap-row:has-text("TG recipes") .tag-chip');
  ok((await page.locator('dialog[open] .ap-row', { hasText: 'TG recipes' }).locator('a.tag-chip').count()) === 0, `${name}: Add file shows tags, not as links inside the button`);
  await settle(page);
  await shot(page, `${name}-picker`);
  await ctx.close();
}

async function flagOff() {
  const name = 'off';
  await api.put('/features/tags', { enabled: false });
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name });
  await filesWith(page, '/files?type=notes');
  ok(!(await page.$('.tag-filter')) && !(await page.$('.tag-chip')), `${name}: no Tags row or chips with the flag off`);
  await page.goto(`${B}/#/n/${recipes.id}`);
  await page.waitForSelector('.page-head h1');
  ok(!(await page.$('.tags-header')), `${name}: no tags on the note's page`);
  await ctx.close();
  await api.put('/features/tags', { enabled: true });
}

try {
  await run('desk', { width: 1280, height: 900 });
  await run('phone', { width: 390, height: 844 }, { touch: true });
  await run('desk-eink', { width: 1280, height: 900 }, { theme: 'eink' });
  await run('phone-eink', { width: 390, height: 844 }, { touch: true, theme: 'eink' });
  await run('phone-dark', { width: 390, height: 844 }, { touch: true, theme: 'dark' });
  await manage();
  await addFile();
  await flagOff();
  ok(!errors.length, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  for (const l of [recipes, loose, jobs]) await api.call('DELETE', `/lists/${l.id}`).catch(() => {});
  for (const t of await api.get('/tags').catch(() => [])) if (t.name.startsWith('TG ')) await api.call('DELETE', `/tags/${t.id}`).catch(() => {});
  await browser.close();
}
