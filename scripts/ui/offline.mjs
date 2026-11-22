// Offline use (DECISIONS D27): open the app with no connection after a first visit, see saved data,
// make changes (tick a to-do, add a card, edit a note), reload while offline (the queue survives),
// go online and see them sent; a conflict on a card and on a note; a refused change; a new deploy.
// Needs a seeded server (seed.mjs) and the built app in public/ (the new-deploy step edits it and
// puts it back). Run: FT_URL=http://localhost:8816 node scripts/ui/offline.mjs
import { copyFileSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { apiCtx, B, launch, OUT, PASSWORD } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const browser = await launch();
const api = await apiCtx(browser);
const errors = [];
const ok = (cond, what) => {
  if (!cond) throw new Error(`FAILED: ${what}`);
  console.log(`ok - ${what}`);
};
// Network failures while offline are expected; anything else is not.
const expected = (t) => /ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch|NetworkError|net::ERR/.test(t);

const projects = await api.get('/projects');
const p1 = projects.find((p) => p.name === 'Focus Tracker v2');
const lists = await api.get('/lists');
const shopping = lists.find((l) => l.name === 'Shopping');

let current = null;
process.on('uncaughtException', async (e) => {
  console.log(e.message);
  if (current) {
    await current.screenshot({ path: `${OUT}/offline-FAILED.png` }).catch(() => {});
    console.log('net:', await current.evaluate(() => document.querySelector('.net')?.textContent).catch(() => '?'), 'toast:', await current.evaluate(() => document.querySelector('.toast')?.textContent).catch(() => '?'));
  }
  process.exit(1);
});

async function session(viewport, name) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !expected(m.text()) && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(B);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button.primary');
  await page.waitForSelector('.shell');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  current = page;
  return { ctx, page };
}
/** Leave the note editor: Done on a phone (full screen), a click outside on a desktop. */
async function leaveEditor(page) {
  const done = page.locator('.ed-head button.primary');
  if (await done.isVisible()) await done.click();
  else await page.mouse.click(5, 300);
}
const badge = (page) => page.locator('.net').first();
// The to-do on Today: in the Today list (flag today-panel; a ticked one folds away) or in To do today.
const todayRow = (page) => page.locator('.today-list .tl-sec .tl-row', { hasText: 'Reply to landlord' });
const todayShown = (page, opts) => page.waitForSelector('.today-list, .checks li:has-text("Reply to landlord")', opts);
async function tickOnToday(page) {
  if (await page.$('.today-list')) await todayRow(page).locator('.tl-tick').first().click();
  else await page.locator('.checks li', { hasText: 'Reply to landlord' }).locator('input[type=checkbox]').first().check();
}
async function tickedOnToday(page) {
  if (await page.$('.today-list')) return (await todayRow(page).count()) === 0 && (await page.textContent('.today-list')).includes('1 done');
  return page.locator('.checks li', { hasText: 'Reply to landlord' }).locator('input').first().isChecked();
}
const notesPage = `${B}/#/pn/${p1.id}`;
const shot = (page, n) => page.screenshot({ path: `${OUT}/offline-${n}.png` });

// ---------- phone: first visit, then no signal ----------
{
  const { ctx, page } = await session({ width: 390, height: 844 }, 'phone');
  // First visit: the pages we will need offline.
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('text=Reply to landlord');
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.kcard >> text=Design schema');
  // On a phone the project page shows the small note: its editor is on the notes' own page.
  await page.goto(notesPage);
  await page.waitForSelector('.ed-view >> text=phone first');
  await page.goto(`${B}/#/n/${shopping.id}`);
  await page.waitForSelector('text=Milk');
  await page.waitForTimeout(600); // saved copies are written after a short pause

  await ctx.setOffline(true);
  await page.goto(`${B}/#/today`);
  await page.reload();
  await page.waitForSelector('text=Reply to landlord', { timeout: 8000 });
  ok(true, 'the app opens offline with the saved copy of Today');
  await page.waitForFunction(() => /Offline/.test(document.querySelector('.net')?.textContent ?? ''));
  ok((await badge(page).textContent()).includes('showing saved copy from'), 'the header says "Offline · showing saved copy from …"');
  await shot(page, 'phone-today');

  // 1. tick a to-do on Today
  await tickOnToday(page);
  await page.waitForFunction(() => /Offline · 1/.test(document.querySelector('.net')?.textContent ?? ''));
  ok(true, 'ticking a to-do waits: "Offline · 1"');

  // 2. add a card on the project
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.kcard >> text=Design schema');
  await page.locator('.column').first().locator('input[placeholder="Add a card"]').fill('Card made offline');
  await page.locator('.column').first().locator('input[placeholder="Add a card"]').press('Enter');
  await page.waitForSelector('.kcard >> text=Card made offline');
  // 3. edit the project's note
  await page.waitForTimeout(600); // the saved copy is written after a short pause
  await page.goto(notesPage);
  await page.locator('.ed-view', { hasText: 'phone first' }).click();
  await page.waitForSelector('.ProseMirror');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Written on the train.');
  await page.waitForTimeout(1500); // the editor saves after a pause
  await leaveEditor(page);
  await page.waitForSelector('.ed-view >> text=Written on the train.');
  await page.waitForFunction(() => /Offline · 3/.test(document.querySelector('.net')?.textContent ?? ''));
  ok(true, 'card and note wait too: "Offline · 3"');
  // 4. a change that needs a connection says so
  await page.goto(`${B}/#/today`);
  await todayShown(page);
  await shot(page, 'phone-waiting');

  // reload while offline: everything still shows, the queue is still there
  await page.reload();
  await todayShown(page);
  await page.waitForTimeout(300);
  ok(await tickedOnToday(page), 'after a reload offline the to-do is still ticked');
  await page.waitForFunction(() => /Offline · 3/.test(document.querySelector('.net')?.textContent ?? ''));
  ok(true, 'after a reload offline 3 changes still wait');
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.kcard >> text=Card made offline');
  await shot(page, 'phone-project-offline');
  await page.goto(notesPage);
  await page.waitForSelector('.ed-view >> text=Written on the train.');
  ok(true, 'after a reload offline the new card and the note edit still show');

  // back online: sent in order
  await ctx.setOffline(false);
  for (let i = 0; i < 10 && process.env.DEBUG; i++) { console.log(await page.evaluate(() => [document.querySelector('.net')?.textContent, document.querySelector('.toast')?.textContent, navigator.onLine].join(' | '))); await page.waitForTimeout(1000); }
  await page.waitForSelector('.toast >> text=Back online: 3 changes sent', { timeout: 30000 });
  ok(true, 'back online: "3 changes sent"');
  const today = await api.get('/today');
  ok(!!today.todos.find((t) => t.title === 'Reply to landlord')?.done, 'server: the to-do is ticked');
  const full = await api.get(`/projects/${p1.id}/full`);
  ok(full.columns.some((c) => c.cards.some((k) => k.title === 'Card made offline')), 'server: the card exists');
  ok(/Written on the train\./.test(full.notes), 'server: the note has the edit');
  await page.waitForFunction(() => !document.querySelector('.net'));
  ok(true, 'the header badge goes away');

  // ---------- conflicts ----------
  const card = full.columns.flatMap((c) => c.cards).find((k) => k.title === 'MCP tools');
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.reload();
  await page.waitForSelector('.kcard >> text=MCP tools');
  await page.goto(notesPage); // the notes' page too, so its saved copy is fresh
  await page.waitForSelector('.ed-view >> text=phone first');
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.kcard >> text=MCP tools');
  await page.waitForTimeout(600);
  await ctx.setOffline(true);
  // rename a card offline
  await page.locator('.kcard', { hasText: 'MCP tools' }).press('Enter'); // a sticky note may lie over it on a phone
  await page.locator('dialog .sheet-head .inline-edit').click();
  await page.locator('dialog .sheet-head input').fill('MCP tools (phone)');
  await page.locator('dialog .sheet-head input').press('Enter');
  await page.locator('dialog button[aria-label=Close]').click();
  // edit the note offline
  await page.goto(notesPage);
  await page.locator('.ed-view', { hasText: 'phone first' }).click();
  await page.waitForSelector('.ProseMirror');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Phone line.');
  await page.waitForTimeout(1500);
  await leaveEditor(page);
  await page.waitForFunction(() => /Offline · 2/.test(document.querySelector('.net')?.textContent ?? ''));
  // meanwhile, another device changes both
  await api.call('PATCH', `/tasks/${card.id}`, { title: 'MCP tools (laptop)' });
  const laptopNote = full.notes + '\n\nLaptop line.';
  await api.put(`/notes/of/project/${p1.id}`, { body: laptopNote });
  await ctx.setOffline(false);
  await page.waitForSelector('.toast.error >> text=Not applied', { timeout: 30000 });
  await shot(page, 'phone-conflict-toast');
  ok((await api.get(`/tasks/${card.id}`)).title === 'MCP tools (laptop)', 'card conflict: the newer (laptop) title is kept');
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.kcard >> text=MCP tools (laptop)');
  ok(true, 'the screen reloads with the server version');
  await page.goto(notesPage);
  // the note: the editor's choice
  await page.waitForSelector('.ed-draft >> text=made offline');
  await shot(page, 'phone-note-clash');
  await page.locator('.ed-draft button', { hasText: 'Choose' }).click();
  await page.waitForSelector('.ed-conflict');
  await shot(page, 'phone-note-choice');
  await page.locator('.ed-conflict button', { hasText: 'Keep both' }).click();
  await page.waitForTimeout(2000);
  await leaveEditor(page);
  await page.waitForTimeout(800);
  const merged = (await api.get(`/notes/of/project/${p1.id}`)).body;
  ok(merged.includes('Laptop line.') && merged.includes('Phone line.'), 'note conflict: Keep both keeps both texts');
  const settings = await page.goto(`${B}/#/settings`);
  void settings;
  await page.waitForSelector('.offline-settings >> text=Not applied');
  await page.locator('.offline-settings').scrollIntoViewIfNeeded();
  await shot(page, 'phone-settings');

  // a change that cannot wait
  await page.goto(`${B}/#/today`);
  await todayShown(page);
  await ctx.setOffline(true);
  await page.locator('.top .undo').click();
  await page.waitForSelector('.toast.error >> text=this change needs a connection');
  ok(true, 'a change that cannot wait (undo) says it needs a connection');
  await shot(page, 'phone-refused');
  await ctx.setOffline(false);
  await ctx.close();
}

// ---------- desktop: offline view, refusal message ----------
{
  const { ctx, page } = await session({ width: 1280, height: 800 }, 'desktop');
  await page.goto(`${B}/#/n/${shopping.id}`);
  await page.waitForSelector('text=Milk');
  await page.goto(`${B}/#/today`);
  await todayShown(page);
  await page.waitForTimeout(600);
  await ctx.setOffline(true);
  await page.reload();
  await todayShown(page);
  await page.goto(`${B}/#/n/${shopping.id}`);
  await page.waitForSelector('text=Milk');
  await page.locator('.ub-item', { hasText: 'Milk' }).locator('.ub-tick').click(); // the to-do's tick circle (D41)
  await page.waitForFunction(() => /1 waiting/.test(document.querySelector('.net')?.textContent ?? ''));
  ok((await badge(page).innerText()).includes('showing saved copy from'), 'desktop: the long badge text');
  await shot(page, 'desktop-list-offline');
  // a page never opened: a plain message, no crash
  await page.goto(`${B}/#/p/does-not-exist`);
  await page.waitForSelector('text=not saved on this device');
  ok(true, 'a page never opened says it is not saved on this device');
  // a new project needs a connection
  await page.goto(`${B}/#/projects`);
  await page.waitForTimeout(500);
  await shot(page, 'desktop-projects-offline');
  await ctx.setOffline(false);
  await page.waitForSelector('.toast >> text=Back online: 1 change sent', { timeout: 30000 });
  ok(true, 'desktop: the tick is sent');
  await ctx.close();
}

// ---------- a new deploy updates ----------
{
  const { ctx, page } = await session({ width: 390, height: 844 }, 'deploy');
  const html = readFileSync('public/index.html', 'utf8');
  const sw = readFileSync('public/sw.js', 'utf8');
  const entry = /\/assets\/(index-[\w-]+\.js)/.exec(html)[1];
  const next = entry.replace('.js', 'X.js');
  try {
    writeFileSync(`public/assets/${next}`, readFileSync(`public/assets/${entry}`, 'utf8') + '\nwindow.__ftDeploy = 2;\n');
    writeFileSync('public/index.html', html.replaceAll(entry, next));
    writeFileSync('public/sw.js', sw.replaceAll(entry, next).replace(/const BUILD = "(\w+)"/, 'const BUILD = "$1x"'));
    // wrangler dev picks up the changed files after a moment
    for (let i = 0; i < 40; i++) {
      const r = await api.call('GET', '/health').catch(() => null);
      void r;
      const res = await ctx.request.get(`${B}/assets/${next}`);
      if (res.ok() && (res.headers()['content-type'] ?? '').includes('javascript')) break;
      await page.waitForTimeout(500);
    }
    // A page left open (the Android app) finds the new deploy when it comes back to the front and loads it by itself.
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const self = await page.waitForFunction(() => window.__ftDeploy === 2, null, { timeout: 20000 }).then(() => true, () => false);
    ok(self, 'a page left open loads a new deploy by itself');
    await page.waitForSelector('.shell');
    await page.reload();
    await page.waitForSelector('.shell');
    ok(await page.evaluate(() => window.__ftDeploy === 2), 'a new deploy shows on the next open (network first for the page)');
    // the new service worker takes over and keeps the new files
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active && !(await navigator.serviceWorker.getRegistration()).installing && !(await navigator.serviceWorker.getRegistration()).waiting, null, { timeout: 15000 });
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForTimeout(2000);
    const build = await page.evaluate(
      () =>
        new Promise((res) => {
          navigator.serviceWorker.addEventListener('message', (e) => res(e.data.build), { once: true });
          navigator.serviceWorker.controller.postMessage('build');
        }),
    );
    ok(build.endsWith('x'), `the new service worker is active (${build})`);
    await ctx.setOffline(true);
    // wrangler dev picks up the changed files after a moment
    for (let i = 0; i < 40; i++) {
      const r = await api.call('GET', '/health').catch(() => null);
      void r;
      const res = await ctx.request.get(`${B}/assets/${next}`);
      if (res.ok() && (res.headers()['content-type'] ?? '').includes('javascript')) break;
      await page.waitForTimeout(500);
    }
    await page.reload();
    await page.waitForSelector('.shell');
    ok(await page.evaluate(() => window.__ftDeploy === 2), 'offline, the new version opens');
    await ctx.setOffline(false);
  } finally {
    writeFileSync('public/index.html', html);
    writeFileSync('public/sw.js', sw);
    for (const f of readdirSync('public/assets')) if (f === next) unlinkSync(`public/assets/${f}`);
    void copyFileSync;
  }
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.log('Console errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('All offline checks passed. Screenshots in', OUT);
