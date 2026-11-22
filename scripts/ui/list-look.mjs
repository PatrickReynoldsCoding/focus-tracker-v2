// Browser check for a plain list's look (D58, mockup B in docs/mockups/list-panel.html): no
// Board / List switch on a plain list (a to-do keeps it); each group its own box with a coloured
// edge, a tinted header (fold button, name, count) and a fold remembered on this device; long
// text held to two lines with a "more" toggle; a web address (and a pasted [name](address)) one
// chip with the site's name, the stored text untouched, a tap on the chip not opening the item;
// a tap on the item opening it; the ⋯ menu (Edit, Move to <group>, Delete with Undo) instead of
// ✕; the same in the list's panel on Today (desktop) and its small version (phone). Light, dark
// and E-ink at 390 and 1280 px.
// Needs a seeded server (seed.mjs); makes its own lists, deletes them, puts desktop-pills back.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/list-look.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/list-look-${name}.png`, fullPage: true });
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };
const sideways = async (page, w, where) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= w + 1, `${where}: no sideways scroll`);

const LONG = 'Sharing Link Validation, a very long note that carries on and on across several lines until it is cut off here so the row stays tidy and easy to scan. '.repeat(4).trim();
const MD = '[Read and Watch doc](https://docs.google.com/document/d/abc123/edit?usp=sharing)';
const BARE = 'Hamel eval blog https://www.hamel.dev/blog/posts/evals/index.html';

const features = await api.get('/features');
const pillsWere = features.find((f) => f.id === 'desktop-pills')?.enabled;
await api.put('/features/desktop-pills', { enabled: false });
await api.put('/features/panel-restyle', { enabled: true });
await api.put('/features/unified-board', { enabled: true });
for (const l of await api.get('/lists')) if (l.name.startsWith('LL ')) await api.call('DELETE', `/lists/${l.id}`);

let list, todo, first, second;
async function makeData() {
  for (const l of await api.get('/lists')) if (l.name.startsWith('LL ')) await api.call('DELETE', `/lists/${l.id}`);
  todo = await api.post('/lists', { name: 'LL Jobs', kind: 'todo' });
  await api.post('/tasks', { title: 'Wash car', list_id: todo.id });
  list = await api.post('/lists', { name: 'LL Read and Watch', kind: 'list' });
  first = (await api.get(`/lists/${list.id}/full`)).columns[0];
  await api.call('PATCH', `/columns/${first.id}`, { name: 'imanage' });
  second = await api.post('/columns', { list_id: list.id, name: 'Blogs' });
  await api.post('/tasks', { title: MD, column_id: first.id });
  await api.post('/tasks', { title: LONG, column_id: first.id });
  await api.post('/tasks', { title: BARE, column_id: second.id });
  await api.post('/tasks', { title: 'Plain thing', column_id: second.id });
  await api.put('/today-panels/show', { list_id: list.id, on: true });
}
const titles = async () => (await api.get(`/lists/${list.id}/full`)).columns.flatMap((c) => c.cards.map((k) => k.title));
const colOf = async (t) => (await api.get(`/lists/${list.id}/full`)).columns.find((c) => c.cards.some((k) => k.title === t))?.name;
const item = (page, text) => page.locator(`.ll-item:has-text("${text}")`).first();

async function listPage(name, vp, page) {
  await page.goto(`${B}/#/n/${list.id}`);
  await page.waitForSelector('.ll-page');
  await settle(page, 700);
  ok((await page.locator('.ub-seg').count()) === 0, `${name}: a plain list has no Board / List switch`);
  ok((await page.locator('.ll-group').count()) === 2 && (await page.locator('.ll-head .ll-fold').count()) === 2, `${name}: each group is its own box with a fold button`);
  const colours = await page.$$eval('.ll-group', (els) => els.map((e) => getComputedStyle(e).borderLeftColor));
  ok(colours[0] !== colours[1] || name.includes('eink'), `${name}: the groups have different edge colours`);
  ok((await page.locator('.ll-item .ll-menu-btn').count()) === 4 && (await page.locator('.ll-item button:has-text("✕")').count()) === 0, `${name}: every item has a ⋯ menu and no ✕`);
  // The Markdown link is tidied; the stored text is not rewritten.
  const md = item(page, 'Read and Watch doc');
  ok((await md.locator('.ll-title').textContent()) === 'Read and Watch doc', `${name}: the pasted Markdown link shows just its name`);
  ok((await md.locator('.ll-chip').count()) === 1 && (await md.locator('.ll-chip').textContent()).includes('docs.google.com'), `${name}: and one chip with the site name`);
  ok((await md.locator('.ll-chip').getAttribute('href')).startsWith('https://docs.google.com/document/d/abc123'), `${name}: the chip links to the address`);
  ok((await titles()).includes(MD), `${name}: the stored text is unchanged`);
  const bare = item(page, 'Hamel eval blog');
  ok((await bare.locator('.ll-chip').textContent()).includes('hamel.dev') && !(await bare.textContent()).includes('https://'), `${name}: a bare address is one short chip (hamel.dev), no long address`);
  // Two lines and "more".
  const longItem = item(page, 'Sharing Link');
  ok((await longItem.locator('.ll-more').count()) === 1 && (await longItem.locator('.ll-more').textContent()) === 'more', `${name}: long text shows "more"`);
  const h1 = (await longItem.locator('.ll-clamp').boundingBox()).height;
  ok((await item(page, 'Plain thing').locator('.ll-more').count()) === 0, `${name}: short text has no "more"`);
  await longItem.locator('.ll-more').click();
  await settle(page, 200);
  ok(!(await page.locator('dialog[open]').count()), `${name}: "more" does not open the item`);
  const h2 = (await longItem.locator('.ll-clamp').boundingBox()).height;
  ok(h2 > h1 + 5 && (await longItem.locator('.ll-more').textContent()) === 'less', `${name}: "more" shows all the text (${Math.round(h1)} to ${Math.round(h2)} px)`);
  await shot(page, `${name}-page-open`);
  await longItem.locator('.ll-more').click();
  // A tap on a chip does not open the item.
  await md.locator('.ll-chip').evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
  await md.locator('.ll-chip').click();
  await settle(page, 200);
  ok(!(await page.locator('dialog[open]').count()), `${name}: tapping a chip does not open the item`);
  // A tap on the item opens it.
  await item(page, 'Plain thing').locator('.ll-body').click();
  await page.waitForSelector('dialog[open]');
  ok(true, `${name}: tapping the item opens it`);
  await page.keyboard.press('Escape');
  await settle(page, 300);
  // The ⋯ menu.
  await item(page, 'Plain thing').locator('.ll-menu-btn').click();
  const menu = page.locator('.files-menu');
  const lines = await menu.locator('[role=menuitem]').allTextContents();
  ok(lines.some((l) => l.includes('Edit')) && lines.some((l) => l.includes('Move to imanage')) && lines.some((l) => l.includes('Delete')) && !lines.some((l) => l.includes('Move to Blogs')), `${name}: ⋯ offers Edit, Move to the other groups, Delete (${lines.map((l) => l.trim()).join(' | ')})`);
  await page.screenshot({ path: `${OUT}/list-look-${name}-menu.png` });
  await menu.locator('[role=menuitem]:has-text("Move to imanage")').click();
  await settle(page, 700);
  ok((await colOf('Plain thing')) === 'imanage', `${name}: Move to a group moves it`);
  await item(page, 'Plain thing').locator('.ll-menu-btn').click();
  await page.locator('.files-menu [role=menuitem]:has-text("Move to Blogs")').click();
  await settle(page, 700);
  ok((await colOf('Plain thing')) === 'Blogs', `${name}: and back`);
  await item(page, 'Plain thing').locator('.ll-menu-btn').click();
  await page.locator('.files-menu [role=menuitem]:has-text("Edit")').click();
  await page.waitForSelector('dialog[open]');
  await page.keyboard.press('Escape');
  await settle(page, 300);
  await item(page, 'Plain thing').locator('.ll-menu-btn').click();
  await page.locator('.files-menu [role=menuitem]:has-text("Delete")').click();
  await settle(page, 700);
  ok(!(await titles()).includes('Plain thing'), `${name}: Delete in the menu deletes`);
  await page.locator('.toast button:has-text("Undo"), button:has-text("Undo")').first().click();
  await settle(page, 900);
  ok((await titles()).includes('Plain thing'), `${name}: Undo brings it back`);
  // Fold, remembered on this device.
  await page.locator('.ll-group:has(.column-name:text-is("Blogs")) .ll-fold').click();
  await settle(page, 200);
  ok((await page.locator('.ll-group:has(.column-name:text-is("Blogs")) .ll-item:visible').count()) === 0, `${name}: the fold button folds the group`);
  ok((await page.locator('.ll-group:has(.column-name:text-is("imanage")) .ll-item:visible').count()) === 2, `${name}: the other group stays open`);
  await shot(page, `${name}-page-folded`);
  await page.reload();
  await page.waitForSelector('.ll-page');
  await settle(page, 600);
  ok((await page.locator('.ll-group:has(.column-name:text-is("Blogs")) .ll-item:visible').count()) === 0, `${name}: the fold is remembered after a reload`);
  await page.locator('.ll-group:has(.column-name:text-is("Blogs")) .ll-fold').click();
  await settle(page, 200);
  await sideways(page, vp.width, `${name} list page`);
  await shot(page, `${name}-page`);
}

const panel = (page, id) => page.locator(`:is(.lg-row, .lg-item)[data-panel="${id}"]`).first();
async function todayPanel(name, vp, page, phone) {
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('[data-panel="habits"], .pl-row', { timeout: 8000 }).catch(() => {});
  await settle(page, 700);
  if (phone && !(await page.locator(`[data-panel="list-${list.id}"]`).count())) {
    await page.click('.pl-pill:has-text("All")').catch(() => {});
    await settle(page, 700);
  }
  const q = panel(page, `list-${list.id}`);
  await q.scrollIntoViewIfNeeded();
  if (!phone) {
    ok((await q.locator('.ll-group').count()) === 2 && (await q.locator('.ll-menu-btn').count()) === 4, `${name}: the panel shows two group boxes, items with ⋯`);
    ok((await q.locator('.ll-chip').count()) === 2, `${name}: and the chips`);
    await q.locator('.ll-group:has(.ll-name:text-is("Blogs")) .ll-fold').click();
    await settle(page, 200);
    ok((await q.locator('.ll-group:has(.ll-name:text-is("Blogs")) .ll-item:visible').count()) === 0, `${name}: a group folds in the panel`);
    await q.locator('.ll-group:has(.ll-name:text-is("Blogs")) .ll-fold').click();
    await item(q, 'Sharing Link').locator('.ll-body').click();
    await page.waitForSelector('dialog[open]');
    await page.keyboard.press('Escape');
    await settle(page, 300);
  } else {
    ok((await q.locator('.ll-item').count()) >= 3 && (await q.locator('.ll-chip').count()) >= 1, `${name}: the small panel shows items and a chip`);
  }
  await sideways(page, vp.width, `${name} today`);
  await shot(page, `${name}-today`);
}

try {
  for (const [theme, vname, vp] of [['light', 'desk', DESK], ['dark', 'phone', PHONE], ['dark', 'desk', DESK], ['light', 'phone', PHONE], ['eink', 'desk', DESK], ['eink', 'phone', PHONE]]) {
    await makeData();
    const name = `${theme}-${vname}`;
    const phone = vp === PHONE;
    const { page, ctx } = await open(browser, vp, errors, { name, touch: phone, colorScheme: theme === 'dark' ? 'dark' : 'light', init: `try{localStorage.setItem('ft.theme','${theme}')}catch(e){}` });
    await listPage(name, vp, page);
    await todayPanel(name, vp, page, phone);
    // A to-do keeps its switch.
    await page.goto(`${B}/#/n/${todo.id}`);
    await page.waitForSelector('.ub');
    await settle(page);
    ok((await page.locator('.ub-seg').count()) === 1, `${name}: a to-do keeps the Board / List switch`);
    await ctx.close();
  }
} finally {
  if (pillsWere !== undefined) await api.put('/features/desktop-pills', { enabled: pillsWere });
  for (const l of await api.get('/lists')) if (l.name.startsWith('LL ')) await api.call('DELETE', `/lists/${l.id}`).catch(() => {});
}
await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
