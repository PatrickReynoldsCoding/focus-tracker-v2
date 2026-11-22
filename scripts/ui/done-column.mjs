// Browser check for the Done column (D34, flag done-column): a project board's fixed last status
// (no ✕, no move buttons; other columns have ‹ ›), a new column added before it, the card
// dialog's Status picker (into Done marks the card done), Hide done (a slim strip with the count,
// remembered on the server so a reload and another device show it folded; tapping the strip
// opens it), a card dropped on the strip, the flag off. Light, dark and E-ink at 390 and 1280 px.
// Needs a seeded server (seed.mjs); puts the data back. Usage: FT_URL=http://localhost:8787 node scripts/ui/done-column.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/done-column-${name}.png`, fullPage: true });
const settle = (page) => page.waitForTimeout(400);
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 860 };

// Garden shed (no sticky notes over its board), with three cards made here and deleted at the end.
const p1 = (await api.get('/projects')).find((p) => p.name === 'Garden shed');
if (!p1) throw new Error('Run seed.mjs first');
await api.put('/features/done-column', { enabled: true });
const made = [];
{
  // What an earlier run that stopped half way may have left.
  for (const c of (await api.get(`/projects/${p1.id}/full`)).columns) {
    if (c.name === 'Waiting') await api.call('DELETE', `/columns/${c.id}`);
    else for (const k of c.cards) if (['Saw the planks', 'Paint the door', 'Buy timber'].includes(k.title)) await api.call('DELETE', `/tasks/${k.id}`);
  }
  await api.call('PATCH', `/projects/${p1.id}`, { hide_done: false });
  const cols = (await api.get(`/projects/${p1.id}/full`)).columns;
  for (const [title, col] of [['Saw the planks', 0], ['Paint the door', 0], ['Buy timber', cols.length - 1]]) made.push(await api.post('/tasks', { title, column_id: cols[col].id }));
}
const full0 = await api.get(`/projects/${p1.id}/full`);
const startCards = Object.fromEntries(full0.columns.flatMap((c) => c.cards.map((k) => [k.id, c.id])));
const startCols = full0.columns.map((c) => c.id);

const board = (page) => page.locator('.board');
const colNames = (page) => page.$$eval('.board > .column:not(.add-column)', (els) => els.map((e) => (e.querySelector('.column-name')?.textContent ?? e.querySelector('.done-strip-name')?.textContent ?? '').trim()));
const sideways = async (page, w, where) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= w + 1, `${where}: no sideways scroll`);

async function reset() {
  await api.call('PATCH', `/projects/${p1.id}`, { hide_done: false });
  const full = await api.get(`/projects/${p1.id}/full`);
  for (const c of full.columns) if (!startCols.includes(c.id)) await api.call('DELETE', `/columns/${c.id}`);
  for (const [i, id] of startCols.entries()) await api.post(`/columns/${id}/move`, { index: i });
  for (const k of full.columns.flatMap((c) => c.cards)) if (startCards[k.id] && startCards[k.id] !== k.column_id) await api.post(`/tasks/${k.id}/move`, { column_id: startCards[k.id] });
}

async function view(theme, vname, vp, act) {
  const name = `${theme}-${vname}`;
  await reset();
  const { page, ctx } = await open(browser, vp, errors, { name, colorScheme: theme === 'dark' ? 'dark' : 'light', init: `try{localStorage.setItem('ft.theme','${theme}')}catch(e){}` });
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.board .column.done-col');
  await settle(page);
  const names = await colNames(page);
  ok(names.at(-1) === 'Done', `${name}: Done is the last column (${names.join(', ')})`);
  const done = page.locator('.board .column.done-col');
  ok((await done.locator('button[aria-label^="Delete column"]').count()) === 0 && (await done.locator('.column-move').count()) === 0, `${name}: Done has no ✕ and no move buttons`);
  ok((await page.locator('.board .column:not(.done-col) button[aria-label^="Delete column"]').count()) === names.length - 1, `${name}: the other columns can be deleted`);
  await sideways(page, vp.width, name);
  await shot(page, `${name}-board`);
  if (act) await act(page, name, ctx);
  // Hide done: a strip with the count, then open it again.
  const n = (await api.get(`/projects/${p1.id}/full`)).columns.at(-1).cards.length;
  await page.click('.board-tools button:has-text("Hide done")');
  await settle(page);
  ok((await page.locator('.done-strip').count()) === 1 && (await page.textContent('.done-strip-count')).trim() === String(n), `${name}: Hide done folds Done into a strip with its count (${n})`);
  ok((await page.textContent('.board-tools')).includes(`Show done (${n})`), `${name}: the button says Show done (${n})`);
  await sideways(page, vp.width, `${name} folded`);
  // The strip sits at the far right of the board, pinned to its right edge, also while the columns scroll.
  const edge = () => page.$eval('.board.horizontal', (b) => { const s = b.querySelector('.done-strip').getBoundingClientRect(); const r = b.getBoundingClientRect(); return Math.round(r.right - s.right); });
  ok((await edge()) <= 2, `${name}: the folded strip is at the board's right edge (${await edge()}px)`);
  await page.$eval('.board.horizontal', (b) => (b.scrollLeft = 0));
  await settle(page, 150);
  ok((await edge()) <= 2, `${name}: and stays there with the board scrolled to the start`);
  await page.waitForTimeout(500);
  ok((await api.get(`/projects/${p1.id}/full`)).hide_done === true, `${name}: Hide done is saved on the project`);
  await page.locator('.board-wrap').screenshot({ path: `${OUT}/done-column-${name}-folded.png` });
  await page.click('.done-strip-btn');
  await settle(page);
  ok((await page.locator('.done-strip').count()) === 0 && (await page.locator('.column.done-col .column-name').count()) === 1, `${name}: tapping the strip opens Done again`);
  await ctx.close();
}

async function interact(page, name, ctx) {
  // Add a column: it goes before Done.
  await page.fill('.add-column input', 'Waiting');
  await page.press('.add-column input', 'Enter');
  await page.waitForSelector('.board .column-name:text-is("Waiting")');
  await settle(page);
  let names = await colNames(page);
  ok(names.join() === 'To do,Doing,Waiting,Done', `${name}: a new column goes before Done (${names.join(', ')})`);
  // Reorder it: earlier.
  await page.click('.board button[aria-label="Move Waiting earlier"]');
  await page.waitForSelector('.board > .column:nth-child(2) .column-name:text-is("Waiting")');
  names = await colNames(page);
  ok(names.join() === 'To do,Waiting,Doing,Done', `${name}: ‹ moves a column earlier (${names.join(', ')})`);
  ok((await page.locator('.board button[aria-label="Move Doing later"]').count()) === 0, `${name}: the column before Done cannot move after it`);
  // The card dialog's Status picker: into Done marks it done.
  const card = page.locator('.board .column:first-child .kcard').first();
  const title = (await card.locator('.kcard-title').textContent()).trim();
  await card.click();
  await page.waitForSelector('dialog[open] select');
  const label = await page.locator('dialog[open] label.inline:has(select)').first().textContent();
  ok(label.trim().startsWith('Status'), `${name}: the card dialog has a Status picker`);
  const doneId = (await api.get(`/projects/${p1.id}/full`)).columns.at(-1).id;
  await page.locator('dialog[open] label.inline:has-text("Status") select').selectOption(doneId);
  await page.waitForTimeout(600);
  await shot(page, `${name}-status`);
  await page.keyboard.press('Escape');
  await settle(page);
  const moved = (await api.get(`/projects/${p1.id}/full`)).columns.at(-1).cards.find((k) => k.title === title);
  ok(!!moved && !!moved.done, `${name}: choosing Done in the dialog puts "${title}" in Done, done`);
  ok((await page.locator('.board .column.done-col .kcard-title', { hasText: title }).count()) === 1, `${name}: and it shows in Done on the board`);
  // A reload keeps Hide done (saved on the server): fold here, reload, then open again.
  await page.click('.board-tools button:has-text("Hide done")');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('.board');
  await settle(page);
  ok((await page.locator('.done-strip').count()) === 1, `${name}: after a reload Done is still folded`);
  // Another device (a new browser context) sees it folded too.
  const other = await open(browser, PHONE, errors, { name: `${name}-other` });
  await other.page.goto(`${B}/#/p/${p1.id}`);
  await other.page.waitForSelector('.board');
  await settle(other.page);
  ok((await other.page.locator('.done-strip').count()) === 1, `${name}: another device shows Done folded`);
  await other.ctx.close();
  if (name.endsWith('desk')) {
    // Drop a card on the strip: it is done. (Waiting goes first, so the whole board fits.)
    page.once('dialog', (d) => d.accept());
    await page.click('.board button[aria-label="Delete column Waiting"]');
    await page.waitForSelector('.board .column-name:text-is("Waiting")', { state: 'detached' });
    await settle(page);
    const src = page.locator('.board .column:first-child .kcard').first();
    const t2 = (await src.locator('.kcard-title').textContent()).trim();
    await page.locator('.done-strip ul.cards').scrollIntoViewIfNeeded();
    await src.dragTo(page.locator('.done-strip ul.cards'), { steps: 20 });
    await page.waitForTimeout(800);
    const got = (await api.get(`/projects/${p1.id}/full`)).columns.at(-1).cards.find((k) => k.title === t2);
    ok(!!got && !!got.done, `${name}: a card dropped on the folded strip is in Done, done`);
    ok((await page.textContent('.done-strip-count')).trim() === String((await api.get(`/projects/${p1.id}/full`)).columns.at(-1).cards.length), `${name}: the strip's count goes up`);
  }
  await page.click('.done-strip-btn');
  await settle(page);
}

await view('light', 'desk', DESK, interact);
await view('light', 'phone', PHONE, interact);
for (const theme of ['dark', 'eink']) for (const [v, vp] of [['phone', PHONE], ['desk', DESK]]) await view(theme, v, vp);

// The flag off: no Hide done, Done is an ordinary column.
{
  await reset();
  await api.put('/features/done-column', { enabled: false });
  try {
    const { page, ctx } = await open(browser, PHONE, errors, { name: 'flag-off' });
    await page.goto(`${B}/#/p/${p1.id}`);
    await page.waitForSelector('.board .column');
    await settle(page);
    ok(!(await page.$('.column.done-col')) && !(await page.$('.board-tools button:has-text("Hide done")')), 'flag off: no Done column marks and no Hide done');
    ok((await page.locator('.board button[aria-label="Delete column Done"]').count()) === 1, 'flag off: Done can be deleted like any column');
    await shot(page, 'flag-off');
    await ctx.close();
  } finally {
    await api.put('/features/done-column', { enabled: true });
  }
}

await reset();
for (const c of made) await api.call('DELETE', `/tasks/${c.id}`);
await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
