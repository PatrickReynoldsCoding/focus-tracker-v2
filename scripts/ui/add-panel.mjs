// Browser check for Add panel (DECISIONS D33): "+ Add panel" in Today's pill bar and under the
// panels, its sheet (feature panels with icons, Add file), the file picker (recent files, search,
// type chips, folders and the path, + New), a file put on Today and in the pill and scrolled into
// view, Remove taking a file off Today and out of the pill, the All pill, a project page (a removed
// panel back, a file into the project's folder), the phone, E-ink, and the flag off.
// Needs a seeded server (seed.mjs); it puts the data it changes back as it was.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/add-panel.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/add-panel-${name}.png` });
const settle = (page) => page.waitForTimeout(500);
const eink = () => localStorage.setItem('ft.theme', 'eink');

await api.put('/features/add-panel', { enabled: true });
const lists = await api.get('/lists');
const byName = (n) => lists.find((l) => l.name === n);
const projects = await api.get('/projects');
const p1 = projects.find((p) => p.name === 'Focus Tracker v2');
await api.put('/focus', { project_id: p1.id });
for (const l of lists)
  await api.put('/today-panels/show', {
    list_id: l.id,
    on: ['Ideas', 'Shopping'].includes(l.name),
  });
await api.put('/today-panels/show', { project_id: p1.id, on: false });
await api.call('DELETE', '/layout/today/grid').catch(() => {});
await api.call('DELETE', '/layout/project/grid').catch(() => {});
await api.call('DELETE', '/layout/today/pills').catch(() => {});
for (const id of ['today', 'notes', 'more']) await api.call('DELETE', `/layout/today/grids/${id}`).catch(() => {});
const pillsNow = async () => (await api.get('/layout/today')).pills;
const pillOf = async (id) => (await pillsNow())?.find((p) => p.id === id);
const pill = async (page, name) => {
  await page.click(`.pl-pill:has-text("${name}")`);
  await settle(page);
};
/** Whether the element is in the window now. */
const inView = (page, sel) =>
  page.$eval(sel, (e) => {
    const box = e.getClientRects().length ? e : e.firstElementChild; // a phone row is display: contents
    const r = box.getBoundingClientRect();
    return r.top < innerHeight && r.bottom > 0;
  });

async function desktop() {
  const name = 'desk';
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await pill(page, 'Today');
  ok(!(await page.$('.tp-add')), `${name}: the old “+ Add to Today” is gone`);
  ok(!!(await page.$('.pl-add')) && !!(await page.$('.lg-add-panel button')), `${name}: + Add panel in the pill bar and under the panels`);

  // The sheet: feature panels with icons and a line, and Add file.
  await page.click('.pl-add');
  await page.waitForSelector('dialog[open] .ap-list');
  await settle(page);
  await shot(page, `${name}-sheet`);
  const rows = await page.$$eval('dialog[open] .ap-row strong', (els) => els.map((e) => e.textContent.trim()));
  ok(rows[0] === 'Add file' && rows.includes('Habits') && rows.includes('This week') === false, `${name}: the sheet offers Add file and the panels not in the pill (${rows.join(', ')})`);
  ok(!rows.includes('Ideas') && !rows.includes('Shopping'), `${name}: notes and lists are not listed one by one`);
  await page.click('dialog[open] .ap-row:has-text("Habits")');
  await page.waitForSelector('.lg-item[data-panel="habits"]');
  ok((await pillOf('today'))?.panels.includes('habits'), `${name}: Habits is saved in the Today pill (the usual pills were saved)`);
  await page.waitForTimeout(900);
  ok(await inView(page, '.lg-item[data-panel="habits"]'), `${name}: the new panel is scrolled into view`);

  // Add file: recent first, search, type chips, folders.
  await page.click('.pl-add');
  await page.click('dialog[open] .ap-file');
  await page.waitForSelector('dialog[open] .ap-picker h3:has-text("Recent")');
  await page.waitForSelector('dialog[open] .ap-picker h3:has-text("All files")');
  await settle(page);
  await shot(page, `${name}-picker`);
  const chips = await page.$$eval('dialog[open] .ap-chips .chip', (els) => els.map((e) => e.textContent.trim()));
  ok(chips.join() === 'All,Notes,To-dos,Lists,Whiteboards', `${name}: type chips without Links (${chips.join(', ')})`);
  const here = await page.$$eval('dialog[open] .ap-row:disabled strong', (els) => els.map((e) => e.textContent.trim()));
  ok(!here.includes('Ideas'), `${name}: a file on Today but not in this pill can still be added`);
  await page.click('dialog[open] .ap-chips .chip:has-text("Whiteboards")');
  await page.waitForTimeout(600);
  const boards = await page.$$eval('dialog[open] .ap-picker section .ap-row strong', (els) => els.map((e) => e.textContent.trim()));
  ok(boards.length >= 1 && boards.every((b) => b === 'Plan sketch'), `${name}: the Whiteboards chip shows only whiteboards (${boards.join(', ')})`);
  await page.click('dialog[open] .ap-chips .chip:has-text("All")');
  await page.fill('dialog[open] input[type=search]', 'Recip');
  await page.waitForSelector('dialog[open] .ap-row:has-text("Recipes")');
  await page.waitForTimeout(400);
  await shot(page, `${name}-search`);
  await page.click('dialog[open] .ap-row:has-text("Recipes")');
  const recipes = byName('Recipes');
  await page.waitForSelector(`.lg-item[data-panel="list-${recipes.id}"]`);
  ok((await api.get(`/lists/${recipes.id}`)).show_today, `${name}: Recipes is on Today`);
  ok((await pillOf('today')).panels.includes(`list-${recipes.id}`), `${name}: and in the Today pill`);
  await page.waitForTimeout(900);
  ok(await inView(page, `.lg-item[data-panel="list-${recipes.id}"]`), `${name}: and scrolled into view`);

  // A project's notes, from its folder (the path takes you back).
  await page.click('.pl-add');
  await page.click('dialog[open] .ap-file');
  await page.click('dialog[open] .ap-row:has-text("Focus Tracker v2"):has-text("Project folder")');
  await page.waitForSelector('dialog[open] .ap-crumbs button:has-text("Focus Tracker v2")');
  await settle(page);
  await shot(page, `${name}-folder`);
  await page.click('dialog[open] .ap-row:has-text("Focus Tracker v2 notes")');
  await page.waitForSelector(`.lg-item[data-panel="pnote-${p1.id}"]`);
  ok((await pillOf('today')).panels.includes(`pnote-${p1.id}`), `${name}: a project's notes from its folder go in the pill`);

  // + New: a note made in the picker goes straight in.
  await page.click('.pl-add');
  await page.click('dialog[open] .ap-file');
  await page.click('dialog[open] .ap-bar button:has-text("+ New")');
  await page.fill('dialog[open] .ap-new input[aria-label=Name]', 'Fresh note');
  await shot(page, `${name}-new`);
  await page.click('dialog[open] .ap-new button:has-text("Make and add")');
  await page.waitForTimeout(1200);
  const fresh = (await api.get('/lists')).find((l) => l.name === 'Fresh note');
  ok(fresh && fresh.kind === 'note' && fresh.show_today, `${name}: + New made a note on Today`);
  ok((await pillOf('today')).panels.includes(`list-${fresh.id}`), `${name}: and put it in the pill`);
  await page.waitForSelector(`.lg-item[data-panel="list-${fresh.id}"]`);
  await shot(page, `${name}-added`);
  await page.waitForTimeout(2200);
  ok(!(await page.$('.lg-new')), `${name}: the mark on a new panel goes after a moment`);

  // Remove a file panel: off Today and out of the pill.
  await page.hover(`.lg-item[data-panel="list-${fresh.id}"]`);
  await page.click(`.lg-item[data-panel="list-${fresh.id}"] .lg-more`);
  await page.click('.files-menu button:has-text("Remove from this pill")');
  await page.waitForTimeout(800);
  ok(!(await api.get(`/lists/${fresh.id}`)).show_today, `${name}: Remove takes the note off Today`);
  ok(!(await pillsNow()).some((p) => p.panels.includes(`list-${fresh.id}`)), `${name}: and out of every pill`);
  ok(!(await page.$(`.lg-item[data-panel="list-${fresh.id}"]`)), `${name}: and off the page`);

  // The All pill: Remove a feature panel, Add panel brings it back.
  await pill(page, 'All');
  await page.hover('.lg-item[data-panel="neglected"]').catch(() => {});
  const neglected = await page.$('.lg-item[data-panel="neglected"]');
  const target = neglected ? 'neglected' : 'habits';
  await page.hover(`.lg-item[data-panel="${target}"]`);
  await page.click(`.lg-item[data-panel="${target}"] .lg-more`);
  await page.click('.files-menu button:has-text("Remove from Today")');
  await page.waitForTimeout(600);
  ok((await api.get('/layout/today')).grid.removed.includes(target), `${name}: ${target} removed from All`);
  await page.click('.pl-add');
  await page.waitForSelector('dialog[open] .ap-list');
  ok((await page.textContent('dialog[open] .ap-where')).includes('To Today'), `${name}: in All the sheet adds to Today`);
  await page.click(`dialog[open] .ap-row:not(.ap-file)`);
  await page.waitForSelector(`.lg-item[data-panel="${target}"]`);
  ok(!(await api.get('/layout/today')).grid.removed.includes(target), `${name}: Add panel brings ${target} back`);

  // The ⋯ menu's line opens the same sheet.
  await page.hover(`.lg-item[data-panel="${target}"]`);
  await page.click(`.lg-item[data-panel="${target}"] .lg-more`);
  await page.click('.files-menu button:has-text("Add panel…")');
  ok(!!(await page.waitForSelector('dialog[open] .ap-list')), `${name}: ⋯ → Add panel… opens the sheet`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600); // the dialog's history step is taken back before going on

  // A project page: a removed panel back, and a file into the project's folder.
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.lg-item[data-panel="criteria"]', { timeout: 8000 }).catch(async (e) => {
    await shot(page, `${name}-project-fail`);
    console.log(errors, await page.evaluate(() => location.href));
    throw e;
  });
  await page.hover('.lg-item[data-panel="criteria"]');
  await page.click('.lg-item[data-panel="criteria"] .lg-more');
  await page.click('.files-menu button:has-text("Remove from project pages")');
  await page.waitForTimeout(500);
  await page.click('.lg-add-panel button');
  await page.waitForSelector('dialog[open] .ap-list');
  await shot(page, `${name}-project-sheet`);
  await page.click('dialog[open] .ap-row:has-text("Done when")');
  await page.waitForSelector('.lg-item[data-panel="criteria"]');
  ok(!(await api.get('/layout/project')).grid.removed.includes('criteria'), `${name}: Done when is back on project pages`);
  await page.click('.lg-add-panel button');
  await page.click('dialog[open] .ap-file');
  await page.fill('dialog[open] input[type=search]', 'Gift');
  await page.waitForSelector('dialog[open] .ap-row:has-text("Gift ideas")');
  await page.click('dialog[open] .ap-row:has-text("Gift ideas")');
  await page.waitForTimeout(1200);
  const gift = byName('Gift ideas');
  ok((await api.get(`/lists/${gift.id}`)).project_id === p1.id, `${name}: a file added on a project page is filed in the project`);
  await shot(page, `${name}-project`);
  await api.call('POST', '/files/move', {
    items: [{ type: 'note', id: gift.id }],
    folder_id: null,
  });
  await ctx.close();
}

async function phone(theme) {
  const name = `phone-${theme}`;
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name, touch: true, init: theme === 'eink' ? eink : undefined });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.pl-pill');
  await pill(page, 'Today');
  ok(!(await page.$('.pl-add')), `${name}: no bar button on a phone`);
  await page.click('.lg-add-panel button');
  await page.waitForSelector('dialog[open] .ap-list');
  await settle(page);
  await shot(page, `${name}-sheet`);
  await page.click('dialog[open] .ap-file');
  await page.waitForSelector('dialog[open] .ap-picker h3:has-text("Recent")');
  await settle(page);
  await shot(page, `${name}-picker`);
  const wide = await page.evaluate(
    () =>
      document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('dialog[open] *')].some((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.ap-chips')),
  );
  ok(!wide, `${name}: nothing runs off the screen`);
  const travel = byName('Travel');
  await page.fill('dialog[open] input[type=search]', 'Travel');
  await page.waitForSelector('dialog[open] .ap-row:has-text("Travel")');
  await page.click('dialog[open] .ap-row:has-text("Travel")');
  await page.waitForSelector(`.lg-row[data-panel="list-${travel.id}"]`);
  await page.waitForTimeout(1200);
  ok(await inView(page, `.lg-row[data-panel="list-${travel.id}"]`), `${name}: Travel is in the pill, scrolled into view`);
  await shot(page, `${name}-added`);
  await api.post('/layout/today/remove', { panel: `list-${travel.id}` });
  await ctx.close();
}

async function flagOff() {
  const name = 'off';
  await api.put('/features/add-panel', { enabled: false });
  try {
    const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name });
    await page.goto(`${B}/#/today`);
    await page.waitForSelector('.pl-pill');
    await pill(page, 'All');
    await page.waitForSelector('.tp-add');
    ok(!(await page.$('.pl-add')) && !(await page.$('.lg-add-panel')), `${name}: no + Add panel`);
    ok(!!(await page.$('.tp-add button:has-text("Add to Today")')), `${name}: “+ Add to Today” is back`);
    await page.hover('.lg-item[data-panel="today-list"]');
    await page.click('.lg-item[data-panel="today-list"] .lg-more');
    await page.click('.files-menu button:has-text("Add panels…")');
    await page.waitForSelector('dialog[open] .lg-add');
    ok(true, `${name}: ⋯ → Add panels… opens the old list`);
    await ctx.close();
  } finally {
    await api.put('/features/add-panel', { enabled: true });
  }
}

try {
  await desktop();
  await phone('light');
  await phone('eink');
  await flagOff();
} finally {
  // Back as it was: Recipes, the project's notes and Fresh note off Today, the usual pills and layouts.
  const now = await api.get('/lists');
  for (const l of now)
    await api.put('/today-panels/show', {
      list_id: l.id,
      on: ['Ideas', 'Shopping'].includes(l.name),
    });
  const fresh = now.find((l) => l.name === 'Fresh note');
  if (fresh) await api.call('DELETE', `/lists/${fresh.id}`);
  await api.put('/today-panels/show', { project_id: p1.id, on: false });
  await api.call('DELETE', '/layout/today/pills').catch(() => {});
  await api.call('DELETE', '/layout/today/grid').catch(() => {});
  await api.call('DELETE', '/layout/project/grid').catch(() => {});
  await browser.close();
}
if (errors.length) {
  console.log(errors.join('\n'));
  throw new Error(`${errors.length} console errors`);
}
console.log('add-panel: all good');
