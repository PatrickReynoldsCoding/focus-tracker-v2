// Browser check for Files › Projects › category › project (D52) and the projects' automatic tags
// (D53): the top level shows Projects (no project folders), Projects shows a folder per category in
// the categories' order and colour, then No category; a project's folder moves to another
// category's folder by dragging (mouse) or Move… (phone) and its category changes, with Undo;
// Move here is off where something cannot go; no + New in the virtual folders; finished projects
// behind "Show n finished"; renaming a category's folder renames the category; the ● project tag
// in the Tags row filters to the project's files and shows a lock in the tag editor. Light and
// E-ink at 1280 and 390 px. Needs a seeded server (seed.mjs); removes what it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/files-tree.mjs
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
const shot = (page, name, fullPage = true) => page.screenshot({ path: `${OUT}/files-tree-${name}.png`, fullPage });
const settle = (page, ms = 400) => page.waitForTimeout(ms);
const names = async (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const folderNames = (page) => names(page, '.folder-tile .files-name, .file-list .file-row .files-name');

const projects = await api.get('/projects');
const p1 = projects.find((p) => p.name === 'Focus Tracker v2');
const p2 = projects.find((p) => p.name === 'Garden shed');
if (!p1 || !p2) throw new Error('Run seed.mjs first');
await api.put('/features/files-tab', { enabled: true });
await api.put('/features/tags', { enabled: true });
const coding = (await api.get('/categories')).find((c) => c.id === p1.category_id);
const made = { categories: [], projects: [], lists: [] };
const house = await api.post('/categories', { label: 'House', color: '#7a3e9d' });
made.categories.push(house.id);
const old = await api.post('/projects', { name: 'Old fence', category_id: house.id, status: 'done' });
made.projects.push(old.id);
const shedNote = await api.post('/lists', { name: 'Shed sizes', kind: 'note', project_id: p2.id });
made.lists.push(shedNote.id);
const p2Before = p2.category_id ?? null;

try {
  // ---------- computer ----------
  {
    const { page, ctx } = await open(browser, { width: 1280, height: 860 }, errors, { name: 'desk' });
    await page.evaluate(() => (localStorage.setItem('ft.files.view', 'grid'), localStorage.removeItem('ft.files.finished')));
    await page.goto(`${B}/#/files`);
    await page.waitForSelector('.folder-tile');
    const top = await folderNames(page);
    ok(top[0] === 'Projects' && !top.some((n) => ['Focus Tracker v2', 'Garden shed', 'Old fence'].includes(n)), `the top level shows Projects, no project folders (${top.join(', ')})`);

    await page.click('.folder-tile .files-open:has-text("Projects")');
    await page.waitForSelector('.folder-tile:has-text("House")');
    const cats = await folderNames(page);
    ok(cats.join() === `${coding.label},House,No category`, `a folder per category in order, No category last (${cats.join(', ')})`);
    ok(!(await page.$('.files-head button:has-text("+ New")')), 'no + New in Projects');
    ok(!!(await page.$('.files-virtual-note')), 'a line saying what Projects is');
    const fill = await page.$eval('.folder-tile:has-text("House") .folder-shape', (e) => getComputedStyle(e).fill);
    ok(fill === 'rgb(122, 62, 157)', `a category's folder has its colour (${fill})`);
    ok((await page.textContent('.folder-tile:has-text("House") .files-sub')).includes('1 project'), 'a category folder says how many projects');
    await shot(page, 'desk-projects');

    // Finished projects wait behind "Show n finished".
    await page.click('.folder-tile .files-open:has-text("House")');
    await page.waitForSelector('.files-finished');
    ok((await page.textContent('.files-finished')).includes('Show 1 finished project') && !(await page.$('.folder-tile:has-text("Old fence")')), 'a finished project is hidden behind Show 1 finished project');
    await page.click('.files-finished');
    await page.waitForSelector('.folder-tile:has-text("Old fence")');
    await page.click('.files-finished:has-text("Hide")');

    // The path; a project folder dropped on the top level (the crumb Files) stays where it is.
    await page.goto(`${B}/#/files/vf:nocat`);
    await page.waitForSelector('.folder-tile:has-text("Garden shed")');
    ok((await names(page, '.files-crumbs .crumb')).join() === 'Files,Projects,No category', 'the path: Files › Projects › No category');
    await page.dragAndDrop('.folder-tile:has-text("Garden shed")', '.files-crumbs .crumb:text-is("Files")');
    await settle(page);
    ok(((await api.get(`/projects/${p2.id}`)).category_id ?? null) === p2Before && !!(await page.$('.folder-tile:has-text("Garden shed")')), 'a project folder dropped on Files stays where it is');

    // Drag Garden shed onto the House folder (a search in Projects shows both): its category changes; Undo.
    await page.goto(`${B}/#/files/vf:projects`);
    await page.waitForSelector('.folder-tile:has-text("House")');
    await page.fill('.files-search', 'e');
    await page.waitForSelector('.folder-tile:has-text("Garden shed")');
    await page.dragAndDrop('.folder-tile:has-text("Garden shed")', '.folder-tile:has-text("House")');
    await page.waitForSelector('.toast:has-text("category")');
    ok((await api.get(`/projects/${p2.id}`)).category_id === house.id, 'dragging the folder onto House gives the project that category');
    await page.click('.toast button:has-text("Undo")');
    await page.waitForFunction(async () => true);
    await settle(page, 800);
    ok(((await api.get(`/projects/${p2.id}`)).category_id ?? null) === p2Before, 'Undo puts the category back');
    await page.fill('.files-search', '');
    await page.waitForSelector('.folder-tile:has-text("No category")');

    // Rename a category from its folder's ⋯.
    await page.click('.folder-tile:has-text("House") .files-more');
    const menu = await names(page, '.files-menu .files-menu-item');
    ok(menu.some((m) => m.endsWith('Rename category')) && !menu.some((m) => m.endsWith('Delete')) && !menu.some((m) => m.endsWith('Move…')), `a category folder: Rename category, no Move or Delete (${menu.join(', ')})`);
    await page.click('.files-menu-item:has-text("Rename category")');
    await page.fill('dialog input', 'Home and garden');
    await page.click('dialog button.primary');
    await page.waitForSelector('.folder-tile:has-text("Home and garden")');
    ok((await api.get(`/categories/${house.id}`)).label === 'Home and garden', 'renaming the folder renamed the category');

    // The project's automatic tag in the Tags row.
    await page.goto(`${B}/#/files`);
    await page.waitForSelector('.tag-filter-chip.tag-auto');
    const autos = await names(page, '.tag-filter-chip.tag-auto');
    ok(autos.some((t) => t.includes('Garden shed')) && !autos.some((t) => t.includes('Old fence')), `the Tags row has the projects' tags, not finished ones (${autos.join(', ')})`);
    await page.click('.tag-filter-chip.tag-auto:has-text("Garden shed")');
    await page.waitForFunction(() => [...document.querySelectorAll('.file-card .files-name')].some((e) => e.textContent === 'Shed sizes'));
    const found = await names(page, '.file-card .files-name');
    ok(found.includes('Shed sizes') && !found.includes('Ideas'), `the project's tag shows its files (${found.join(', ')})`);
    await shot(page, 'desk-auto-tag');
    await page.click('.file-card:has-text("Shed sizes") .files-more');
    await page.click('.files-menu-item:has-text("Tags")');
    await page.waitForSelector('dialog .tag-chip.tag-auto');
    ok(!!(await page.$('dialog .tag-chip.tag-auto .tag-chip-lock')) && !(await page.$('dialog .tag-chip.tag-auto .tag-chip-x')), 'the editor shows the project tag with a lock, no ✕');
    await shot(page, 'desk-tag-editor', false);
    await page.keyboard.press('Escape');
    await ctx.close();
  }

  // ---------- phone: Move… a project folder to another category ----------
  {
    const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name: 'phone', touch: true });
    await page.evaluate(() => localStorage.setItem('ft.files.view', 'list'));
    await page.goto(`${B}/#/files/vf:nocat`);
    await page.waitForSelector('.file-row:has-text("Garden shed")');
    await page.click('.file-row:has-text("Garden shed") .files-more');
    await page.click('.files-menu-item:has-text("Move")');
    await page.waitForSelector('dialog .files-crumbs .crumb:has-text("No category")');
    await page.click('dialog .crumb:text-is("Files")');
    await page.waitForSelector('dialog .files-move-row:has-text("Projects")');
    ok(await page.$eval('dialog button:has-text("Move here")', (b) => b.disabled), 'Move here is off outside a category’s folder');
    await page.click('dialog .files-move-row:has-text("Projects")');
    await page.waitForSelector('dialog .files-move-row:has-text("Home and garden")');
    ok(await page.$eval('dialog button:has-text("Move here")', (b) => b.disabled), 'and in Projects itself');
    ok((await page.textContent('dialog .files-move-hint')).includes('category'), 'it says where a project’s folder can go');
    await page.click('dialog .files-move-row:has-text("Home and garden")');
    await page.waitForSelector('dialog .files-crumbs .crumb:has-text("Home and garden")');
    await shot(page, 'phone-move');
    await page.click('dialog button:has-text("Move here")');
    await page.waitForFunction(() => ![...document.querySelectorAll('.file-row .files-name')].some((e) => e.textContent === 'Garden shed'));
    ok((await api.get(`/projects/${p2.id}`)).category_id === house.id, 'Move… into a category’s folder changed the project’s category');
    ok((await page.textContent('.toast')).includes('category'), 'the message says the category changed');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(wide <= 390, `no sideways scroll (${wide}px)`);
    await page.goto(`${B}/#/files/vf:projects`);
    await page.waitForSelector('.file-row:has-text("Home and garden")');
    await settle(page);
    await shot(page, 'phone-projects');
    await ctx.close();
  }

  // ---------- E-ink and dark at both widths ----------
  for (const theme of ['eink', 'dark']) {
    for (const [w, h, name] of [[390, 844, 'phone'], [1280, 860, 'desk']]) {
      const { page, ctx } = await open(browser, { width: w, height: h }, errors, { name: `${theme}-${name}`, init: `localStorage.setItem('ft.theme', '${theme}'); localStorage.setItem('ft.files.view', 'grid')` });
      await page.goto(`${B}/#/files/vf:projects`);
      await page.waitForSelector('.folder-tile:has-text("No category")');
      await settle(page);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      ok(wide <= w, `${theme} ${name}: no sideways scroll (${wide}px)`);
      await shot(page, `${theme}-${name}`);
      await page.goto(`${B}/#/files`);
      await page.waitForSelector('.tag-filter-chip.tag-auto');
      await settle(page);
      await shot(page, `${theme}-${name}-root`);
      await ctx.close();
    }
  }
} finally {
  await api.call('PATCH', `/projects/${p2.id}`, { category_id: p2Before }).catch(() => {});
  for (const id of made.lists) await api.call('DELETE', `/lists/${id}`).catch(() => {});
  for (const id of made.projects) await api.call('DELETE', `/projects/${id}`).catch(() => {});
  for (const id of made.categories) await api.call('POST', `/categories/${id}/delete`, {}).catch(() => {});
  await browser.close();
}
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
