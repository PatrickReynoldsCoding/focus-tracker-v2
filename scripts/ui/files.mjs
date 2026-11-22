// Browser check for the Files tab (D31, flag files-tab): it replaces the Notes and Whiteboards
// tabs; old addresses (#/notes, #/whiteboards) land in Files; folders and project folders (under
// Projects › category, D52; files-tree.mjs checks that tree more closely); type
// chips, search (names and note text, everywhere below), sort, grid and list; New (folder, note,
// whiteboard, link) in the folder on screen; Rename, Move… (the folder picker), drag onto a folder
// and onto the path, deleting a folder that is not empty (move up, or everything) with Undo; a
// project's notes on their own page; the flag off. Light, dark and E-ink at 390 and 1280 px.
// Needs a seeded server (seed.mjs). Usage: FT_URL=http://localhost:8787 node scripts/ui/files.mjs
// It puts the data back as it was (removes what it made, moves things back).
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
const shot = (page, name, fullPage = true) => page.screenshot({ path: `${OUT}/files-${name}.png`, fullPage });
const settle = (page, ms = 400) => page.waitForTimeout(ms);
const THUMB =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAAUklEQVR42u3XsQ0AIAgEQMZ2RMdhA11AKhqNRygpuOrzsYrJOY57230AAAAAALQArzxa3QMAAAAA9ACSGAAAAEAfkMQAAAAA+oAkBgAAAPgSsAGFQeJ4kVV6OwAAAABJRU5ErkJggg==';

// ---------- data ----------
const projects = await api.get('/projects');
const p1 = projects.find((p) => p.name === 'Focus Tracker v2');
const p2 = projects.find((p) => p.name === 'Garden shed');
if (!p1 || !p2) throw new Error('Run seed.mjs first');
await api.put('/features/files-tab', { enabled: true });
const made = { folders: [], lists: [], boards: [], links: [] };
const reading = await api.post('/folders', { name: 'Reading' });
const papers = await api.post('/folders', { name: 'Papers', parent_id: reading.id });
made.folders.push(reading.id, papers.id);
const paperNote = await api.post('/lists', { name: 'Paper notes', kind: 'note', folder_id: papers.id });
made.lists.push(paperNote.id);
const spec = await api.post('/resources', { title: 'Spec doc', value: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit', project_id: p1.id });
made.links.push(spec.id);
const board = await api.post('/whiteboards', { name: 'Schema sketch', project_id: p1.id });
await api.put(`/whiteboards/${board.id}/thumbnail`, { thumbnail: THUMB });
made.boards.push(board.id);
const shedList = await api.post('/lists', { name: 'Shed parts', kind: 'todo', project_id: p2.id });
made.lists.push(shedList.id);
const ideas = (await api.get('/lists')).find((l) => l.name === 'Ideas');
const folderOf = async (pid) => (await api.get(`/files?project=${pid}`)).folder;
const p1Folder = await folderOf(p1.id);

const names = async (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const fileNames = (page) => names(page, '.files-section .file-card .files-name, .file-list .file-row .files-name');
const folderNames = (page) => names(page, '.folder-tile .files-name');
/** A tab's or menu item's text has its icon first: "❏Files". */
const hasTab = (tabs, n) => tabs.some((t) => t.endsWith(n));

try {
  // ---------- computer ----------
  {
    const { page, ctx } = await open(browser, { width: 1280, height: 860 }, errors, { name: 'desk' });
    await page.evaluate(() => (localStorage.removeItem('ft.files.view'), localStorage.removeItem('ft.files.sort')));
    await page.waitForSelector('.side a:has-text("Insights")'); // flags loaded
    const tabs = await names(page, '.side a');
    ok(hasTab(tabs, 'Files') && !hasTab(tabs, 'Notes') && !hasTab(tabs, 'Whiteboards'), `side bar: Files in place of Notes and Whiteboards (${tabs.join(', ')})`);

    // Old addresses.
    await page.goto(`${B}/#/notes`);
    await page.waitForSelector('.files');
    ok((await page.evaluate(() => location.hash)) === '#/files', '#/notes opens Files');
    await page.goto(`${B}/#/whiteboards`);
    await page.waitForSelector('.files .chip.on');
    ok((await page.evaluate(() => location.hash)) === '#/files?type=whiteboards' && (await page.textContent('.files .chip.on')) === 'Whiteboards', '#/whiteboards opens Files with Whiteboards chosen');
    await page.waitForFunction(() => document.querySelectorAll('.file-card').length > 0);
    ok((await fileNames(page)).join() === 'Plan sketch,Schema sketch', 'every whiteboard, from every folder');
    ok(await page.$eval('.file-card img', (i) => i.complete && i.naturalWidth > 0), 'a board’s preview image loads');
    const backLabel = await page.$('.back-btn, button:has-text("Back")');
    if (backLabel) {
      await backLabel.click();
      await settle(page);
      ok(!(await page.evaluate(() => location.hash)).startsWith('#/notes'), 'Back does not go to the old #/notes address');
    }

    // The top level: one Projects folder, the owner's folders and loose files, as a grid.
    await page.goto(`${B}/#/files`);
    await page.waitForSelector('.folder-tile');
    ok(!(await page.$('.files-crumbs')), 'no path at the top level');
    const top = await folderNames(page);
    ok(top[0] === 'Projects' && top.includes('Reading') && !top.includes('Focus Tracker v2') && !top.includes('Garden shed'), `folders at the top: Projects and the owner's (${top.join(', ')})`);
    const loose = await fileNames(page);
    ok(loose.includes('Ideas') && !loose.includes('Paper notes') && !loose.includes('Spec doc'), 'files at the top level only');
    await shot(page, 'desk-root');

    // Chips and search.
    await page.click('.files-chips .chip:has-text("Links")');
    await page.waitForFunction(() => [...document.querySelectorAll('.file-card .files-name')].map((e) => e.textContent).join() === 'Spec doc');
    ok((await page.textContent('.file-card .files-sub')).includes('Projects › Coding › Focus Tracker v2'), 'a link found with where it is');
    ok(!!(await page.$('.file-card .kind-icon.kind-doc')), 'a Google Doc shows its icon');
    await page.click('.files-chips .chip:has-text("All")');
    await page.fill('.files-search', 'widget');
    await page.waitForFunction(() => [...document.querySelectorAll('.file-card .files-name')].map((e) => e.textContent).join() === 'Ideas');
    ok(true, 'search finds a note by its text');
    await page.fill('.files-search', 'pap');
    await page.waitForFunction(() => document.querySelectorAll('.folder-tile').length === 1 && document.querySelectorAll('.file-card').length === 1);
    ok((await folderNames(page)).join() === 'Papers' && (await page.textContent('.folder-tile .files-sub')).includes('Reading'), 'search finds a folder deep inside, with where it is');
    await shot(page, 'desk-search');
    await page.fill('.files-search', '');

    // A project's folder: Projects › its category › the project.
    await page.click('.folder-tile .files-open:has-text("Projects")');
    await page.waitForSelector('.folder-tile:has-text("Coding")');
    await page.click('.folder-tile .files-open:has-text("Coding")');
    await page.waitForSelector('.folder-tile:has-text("Focus Tracker v2")');
    await page.click('.folder-tile .files-open:has-text("Focus Tracker v2")');
    await page.waitForSelector('.files-crumbs .crumb:has-text("Focus Tracker v2")');
    ok((await names(page, '.files-crumbs .crumb')).join() === 'Files,Projects,Coding,Focus Tracker v2', 'the path shows Files › Projects › Coding › Focus Tracker v2');
    await page.waitForFunction(() => document.querySelectorAll('.file-card').length >= 3);
    const inP1 = await fileNames(page);
    ok(['Focus Tracker v2 notes', 'Schema sketch', 'Spec doc'].every((n) => inP1.includes(n)), `the project's notes, board and link are in its folder (${inP1.join(', ')})`);
    ok(!!(await page.$('.files-project-note a[href*="#/p/"]')), 'a link to the project page');
    await page.click('.files-crumbs .files-more');
    const projMenu = await names(page, '.files-menu .files-menu-item');
    ok(hasTab(projMenu, 'Rename project') && !hasTab(projMenu, 'Delete'), `a project folder cannot be deleted (${projMenu.join(', ')})`);
    await page.keyboard.press('Escape');
    await shot(page, 'desk-project');

    // New folder here, then a note in it.
    await page.click('button:has-text("+ New")');
    await page.click('.files-menu-item:has-text("Folder")');
    await page.fill('dialog input', 'Specs');
    await page.click('dialog button.primary');
    await page.waitForSelector('.folder-tile:has-text("Specs")');
    const specs = (await api.get(`/files?folder=${p1Folder.id}`)).folders.find((f) => f.name === 'Specs');
    ok(!!specs, 'New → Folder makes it in the folder on screen');
    made.folders.push(specs.id);
    await page.click('.folder-tile .files-open:has-text("Specs")');
    await page.waitForSelector('.files-crumbs .crumb:has-text("Specs")');
    await page.click('button:has-text("+ New")');
    await page.click('.files-menu-item:has-text("Note")');
    await page.fill('dialog input', 'API notes');
    await page.click('dialog button.primary');
    await page.waitForFunction(() => location.hash.startsWith('#/n/'));
    const noteId = (await page.evaluate(() => location.hash)).slice(4);
    made.lists.push(noteId);
    const note = await api.get(`/lists/${noteId}`);
    ok(note.folder_id === specs.id && note.project_id === p1.id, 'New → Note opens the note, filed in Specs and on the project');
    ok((await page.textContent('.back')).includes('Files'), 'the note’s back link says Files');
    await page.click('.back');
    await page.waitForSelector('.files-crumbs .crumb:has-text("Specs")');
    ok(true, 'back to the folder');

    // Drag a file onto the path (up to the project folder), and a folder onto another.
    await page.waitForSelector('.file-card:has-text("API notes")');
    await page.dragAndDrop('.file-card:has-text("API notes")', '.files-crumbs .crumb:has-text("Focus Tracker v2")');
    await page.waitForFunction(() => !document.querySelector('.file-card'));
    ok((await api.get(`/lists/${noteId}`)).folder_id === p1Folder.id, 'drag onto the path moves a file up');
    await page.goto(`${B}/#/files`);
    await page.waitForSelector('.folder-tile:has-text("Reading")');
    await page.dragAndDrop('.file-card:has(.files-name:text-is("Ideas"))', '.folder-tile:has-text("Reading")');
    await page.waitForFunction(() => ![...document.querySelectorAll('.file-card .files-name')].some((e) => e.textContent === 'Ideas'));
    ok((await api.get(`/lists/${ideas.id}`)).folder_id === reading.id, 'drag onto a folder moves a file into it');
    ok((await page.textContent('.toast')).includes('Moved to Reading'), 'a message with Undo');
    await page.click('.toast button:has-text("Undo")');
    await page.waitForSelector('.file-card:has(.files-name:text-is("Ideas"))');
    ok((await api.get(`/lists/${ideas.id}`)).folder_id == null, 'Undo puts it back');

    // Rename a folder, sort, list view.
    await page.click('.folder-tile:has-text("Reading") .files-more');
    await page.click('.files-menu-item:has-text("Rename")');
    await page.fill('dialog input', 'Reading list');
    await page.click('dialog button.primary');
    await page.waitForSelector('.folder-tile:has-text("Reading list")');
    ok((await api.get(`/folders/${reading.id}`)).name === 'Reading list', 'Rename');
    await page.selectOption('.files-view select', 'changed');
    const newest = (await api.get('/files?sort=changed')).files.map((f) => f.name).join();
    await page.waitForFunction((want) => [...document.querySelectorAll('.file-card .files-name')].map((e) => e.textContent).join() === want, newest);
    ok(true, 'sort by last changed');
    await page.click('.files-view-toggle');
    await page.waitForSelector('.file-list .file-row');
    await shot(page, 'desk-list');
    await page.click('.files-view-toggle');
    await page.selectOption('.files-view select', 'name');

    // Delete a folder that is not empty: the choice, then Undo.
    await page.click('.folder-tile:has-text("Reading list") .files-more');
    await page.click('.files-menu-item:has-text("Delete")');
    await page.waitForSelector('dialog:has-text("It holds 1 file and 1 folder")');
    await shot(page, 'desk-delete');
    await page.click('dialog button:has-text("Move them to Files")');
    await page.waitForSelector('.folder-tile:has-text("Papers")');
    ok(!(await folderNames(page)).includes('Reading list'), 'deleting moves what was inside up');
    await page.click('.toast button:has-text("Undo")');
    await page.waitForSelector('.folder-tile:has-text("Reading list")');
    ok((await api.get(`/folders/${papers.id}`)).parent_id === reading.id, 'Undo brings the folder back with what was in it');

    // A project's notes on their own page.
    await page.goto(`${B}/#/files/p/${p1.id}`);
    await page.click('.file-card .files-open:has-text("Focus Tracker v2 notes")');
    await page.waitForFunction(() => location.hash.startsWith('#/pn/'));
    await page.waitForSelector('.page-head h1:has-text("Focus Tracker v2 notes")');
    ok((await page.textContent('.card')).includes('phone first'), 'a project’s notes open in the note editor');
    await shot(page, 'desk-project-note');
    await ctx.close();
  }

  // ---------- phone ----------
  {
    const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name: 'phone', touch: true });
    await page.evaluate(() => (localStorage.removeItem('ft.files.view'), localStorage.removeItem('ft.files.sort')));
    await page.waitForSelector('.tabs a:has-text("Files")');
    const bar = await names(page, '.tabs a');
    ok(hasTab(bar, 'Files') && !hasTab(bar, 'Notes'), `phone bar: ${bar.join(', ')}`);
    await page.goto(`${B}/#/files`);
    await page.waitForSelector('.file-list .file-row');
    ok(true, 'a list on a phone');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(wide <= 390, `no sideways scroll (${wide}px)`);
    await shot(page, 'phone-root');

    // Move… with the folder picker.
    await page.click('.file-row:has-text("Gift ideas") .files-more');
    await settle(page, 200);
    await shot(page, 'phone-menu', false); // a full-page shot resizes the page, which would close the menu
    await page.click('.files-menu-item:has-text("Move")');
    await page.waitForSelector('dialog .files-move-row');
    await page.click('dialog .files-move-row:has-text("Projects")');
    await page.waitForSelector('dialog .files-move-row:has-text("No category")');
    ok(await page.$eval('dialog button:has-text("Move here")', (b) => b.disabled), 'Move here is off in Projects (files go in a project’s folder)');
    await page.click('dialog .files-move-row:has-text("No category")');
    await page.click('dialog .files-move-row:has-text("Garden shed")');
    await page.waitForSelector('dialog .files-crumbs .crumb:has-text("Garden shed")');
    await shot(page, 'phone-move');
    await page.click('dialog button:has-text("Move here")');
    await page.waitForFunction(() => ![...document.querySelectorAll('.file-row .files-name')].some((e) => e.textContent === 'Gift ideas'));
    const gift = (await api.get('/lists')).find((l) => l.name === 'Gift ideas');
    ok(gift.project_id === p2.id, 'Move… into a project’s folder makes it that project’s');
    await api.post('/files/move', { items: [{ type: 'note', id: gift.id }], folder_id: null });

    // New whiteboard in a folder, from the phone.
    await page.click('.file-row .files-open:has-text("Reading list")');
    await page.waitForSelector('.files-crumbs');
    await page.click('button:has-text("+ New")');
    await settle(page, 200);
    await shot(page, 'phone-new', false);
    await page.click('.files-menu-item:has-text("Link")');
    await page.fill('dialog input[type=url]', 'https://example.com/paper.pdf');
    await page.click('dialog button.primary');
    await page.waitForSelector('.file-row:has-text("paper.pdf")');
    const pdf = (await api.get(`/files?folder=${reading.id}`)).files.find((f) => f.type === 'link');
    ok(pdf?.kind === 'pdf', 'New → Link adds a link in the folder, with its kind');
    made.links.push(pdf.id);
    await shot(page, 'phone-folder');
    await ctx.close();
  }

  // ---------- themes ----------
  for (const theme of ['dark', 'eink']) {
    for (const [w, h, name] of [[390, 844, 'phone'], [1280, 860, 'desk']]) {
      const { page, ctx } = await open(browser, { width: w, height: h }, errors, { name: `${theme}-${name}`, init: `localStorage.setItem('ft.theme', '${theme}')` });
      await page.goto(`${B}/#/files/${p1Folder.id}`);
      await page.waitForSelector('.files-crumbs');
      await page.evaluate(() => localStorage.setItem('ft.files.view', 'grid'));
      await page.reload();
      await page.waitForSelector('.file-card');
      await settle(page);
      await shot(page, `${theme}-${name}`);
      await ctx.close();
    }
  }

  // ---------- the flag off: the old tabs ----------
  await api.put('/features/files-tab', { enabled: false });
  {
    const { page, ctx } = await open(browser, { width: 1280, height: 860 }, errors, { name: 'off' });
    await page.waitForSelector('.side a:has-text("Whiteboards")');
    const tabs = await names(page, '.side a');
    ok(hasTab(tabs, 'Notes') && hasTab(tabs, 'Whiteboards') && !hasTab(tabs, 'Files'), `flag off: Notes and Whiteboards are back (${tabs.join(', ')})`);
    await page.goto(`${B}/#/notes`);
    await page.waitForSelector('.note-grid');
    ok(true, 'flag off: #/notes is the Notes tab');
    await ctx.close();
  }
} finally {
  await api.put('/features/files-tab', { enabled: true });
  // Put the data back: delete what was made, folders last (anything else inside moves up, never deleted).
  for (const id of made.lists) await api.call('DELETE', `/lists/${id}`).catch(() => {});
  for (const id of made.boards) await api.call('DELETE', `/whiteboards/${id}`).catch(() => {});
  for (const id of made.links) await api.call('DELETE', `/resources/${id}`).catch(() => {});
  for (const id of made.folders.reverse()) await api.call('DELETE', `/folders/${id}`).catch(() => {});
  if (ideas) await api.post('/files/move', { items: [{ type: 'note', id: ideas.id }], folder_id: null }).catch(() => {});
  await browser.close();
}
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
