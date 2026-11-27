// Browser check for two things:
//  1. The Today list's "Habits" heading is a button that opens the whole Habits page in a pop-out
//     dialog: at 1280 and 390 px, a habit ticked inside shows on Today, Esc, ✕ and the phone's Back
//     close it, Today is refreshed, "Open Habits tab" goes to the tab; with the habits flag off the
//     heading is plain text.
//  2. The Desktop page (#/desktop) reloads its data on its own (every 60 s; the test shortens it with
//     window.__ftDesktopRefreshMs) and skips the reload while a field has focus or a dialog is open.
// Needs a seeded server (seed.mjs). Usage: FT_URL=http://localhost:8787 node scripts/ui/habits-popup.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/habits-popup-${name}.png` });
const settle = (page) => page.waitForTimeout(500);

await api.put('/features/today-panel', { enabled: true });
await api.put('/features/habits', { enabled: true });
await api.call('DELETE', '/layout/today/pills').catch(() => {});
const habits = (await api.get('/habits')).filter((h) => h.status === 'active');
if (!habits.length) throw new Error('Run seed.mjs first');
const reset = async () => {
  for (const h of habits) {
    await api.post(`/habits/${h.id}/check`, { count: 0 });
    await api.post(`/habits/${h.id}/not-today`, { on: false });
  }
};
const doneToday = async () => (await api.get('/today')).habits.reduce((n, h) => n + (h.done_today ?? 0), 0);
const hasDialog = (page) => page.$('dialog.habits-popup[open]').then(Boolean);

async function popup(name, vp, touch) {
  await reset();
  const { page, ctx } = await open(browser, vp, errors, { name, touch });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.today-list');
  await settle(page);
  const head = page.locator('.today-list .tl-label-btn');
  ok((await head.count()) === 1 && /Habits/.test(await head.textContent()), `${name}: the Habits heading is a button`);
  const box = await head.boundingBox();
  ok(box.height >= 43.5, `${name}: the heading is at least 44 px tall (${box.height})`);
  const before = await page.locator('.today-list .tl-row').count();
  await head.click();
  await page.waitForSelector('dialog.habits-popup[open] .habits-page');
  await settle(page);
  ok((await page.textContent('dialog.habits-popup .sheet-head h2')) === 'Habits', `${name}: the dialog is titled Habits`);
  ok((await page.locator('dialog.habits-popup .habit-item').count()) >= 1 && (await page.locator('dialog.habits-popup button:has-text("+ New")').count()) === 1, `${name}: the Habits page is in it, with + New`);
  const dbox = await page.locator('dialog.habits-popup').boundingBox();
  if (touch) ok(dbox.width >= vp.width - 1 && dbox.height >= vp.height - 1, `${name}: fills the screen (${dbox.width}x${dbox.height})`);
  else ok(dbox.width <= 722 && dbox.width > 400, `${name}: a modal over Today (${dbox.width}px wide)`);
  ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= vp.width + 1, `${name}: no sideways scroll`);
  const cbox = await page.locator('dialog.habits-popup .sheet-head .icon').boundingBox();
  ok(cbox.width >= 43.5 && cbox.height >= 43.5, `${name}: ✕ is 44 px`);
  await shot(page, `${name}-open`);
  // Tick a habit inside.
  await page.locator('dialog.habits-popup .dot:not(.on)').first().click();
  await page.waitForTimeout(800);
  ok((await doneToday()) === 1, `${name}: a session ticked inside is saved`);
  // Edit opens the habit's own dialog on top; Esc closes only that one.
  await page.locator('dialog.habits-popup button:has-text("Edit")').first().click();
  await page.waitForTimeout(500);
  ok((await page.locator('dialog[open]').count()) === 2, `${name}: Edit opens on top of the pop-out`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  ok((await page.locator('dialog[open]').count()) === 1, `${name}: Esc closes only the top dialog`);
  // + New opens the new-habit form.
  await page.click('dialog.habits-popup button:has-text("+ New")');
  await page.waitForTimeout(500);
  ok((await page.locator('dialog[open]').count()) === 2, `${name}: + New opens the form`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // Esc closes it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  ok(!(await hasDialog(page)), `${name}: Esc closes the pop-out`);
  ok(/#\/today/.test(page.url()), `${name}: still on Today`);
  const rows = page.locator('.today-list .tl-row');
  ok((await page.textContent('.today-list')).length > 0 && (await rows.count()) >= 1, `${name}: Today shows (${before} rows before, ${await rows.count()} now)`);
  // ✕ closes it.
  await head.click();
  await page.waitForSelector('dialog.habits-popup[open]');
  await page.click('dialog.habits-popup .sheet-head .icon');
  await page.waitForTimeout(800);
  ok(!(await hasDialog(page)), `${name}: ✕ closes the pop-out`);
  // Back closes it first.
  await head.click();
  await page.waitForSelector('dialog.habits-popup[open]');
  await page.goBack();
  await page.waitForTimeout(800);
  ok(!(await hasDialog(page)) && /#\/today/.test(page.url()), `${name}: the phone's Back closes it and stays on Today`);
  // A habit ticked inside is on Today when it closes (a second session, ticked inside, changes the row).
  const stateBefore = await page.$$eval('.today-list .tl-row', (r) => r.map((x) => x.textContent).join('|'));
  await head.click();
  await page.waitForSelector('dialog.habits-popup[open]');
  await page.locator('dialog.habits-popup .dot:not(.on)').first().click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const stateAfter = await page.$$eval('.today-list .tl-row', (r) => r.map((x) => x.textContent).join('|'));
  ok(stateBefore !== stateAfter, `${name}: Today shows what was ticked inside`);
  await shot(page, `${name}-closed`);
  // Open Habits tab.
  if (!(await page.locator('.today-list .tl-label-btn').count())) await page.goto(`${B}/#/today`);
  await head.click();
  await page.waitForSelector('dialog.habits-popup[open]');
  await page.click('dialog.habits-popup .habits-popup-tab');
  await page.waitForTimeout(1000);
  ok(!(await hasDialog(page)) && /#\/habits/.test(page.url()), `${name}: Open Habits tab goes to the tab`);
  await ctx.close();
}

await popup('desk', { width: 1280, height: 800 }, false);
await popup('phone', { width: 390, height: 780 }, true);

// E-ink look.
{
  await reset();
  const { page, ctx } = await open(browser, { width: 1280, height: 800 }, errors, { name: 'eink', init: `try{localStorage.setItem('ft.theme','eink')}catch(e){}` });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.today-list .tl-label-btn');
  await page.click('.today-list .tl-label-btn');
  await page.waitForSelector('dialog.habits-popup[open] .habits-page');
  await settle(page);
  await shot(page, 'eink-open');
  await ctx.close();
}

// Flag off: plain text.
{
  await api.put('/features/habits', { enabled: false });
  const { page, ctx } = await open(browser, { width: 1280, height: 800 }, errors, { name: 'flag-off' });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.today-list');
  await settle(page);
  ok((await page.locator('.today-list .tl-label-btn').count()) === 0, 'flag off: no heading button');
  await shot(page, 'flag-off');
  await ctx.close();
  await api.put('/features/habits', { enabled: true });
}

// ---------- the Desktop page reloads by itself ----------
{
  const day = (await api.get('/today')).day;
  for (const t of (await api.get('/today')).todos) if (/^Probe /.test(t.title)) await api.call('DELETE', `/todos/${t.id}`);
  const a = await api.post('/todos', { title: 'Probe one', day });
  const { page, ctx } = await open(browser, { width: 1280, height: 800 }, errors, { name: 'desktop', init: 'window.__ftDesktopRefreshMs = 1500;' });
  await page.goto(`${B}/#/desktop`);
  await page.waitForSelector('.desktop-page [data-panel]');
  const rowsOf = () => page.$$eval('.desktop-page .tl-sec .tl-row .tl-title', (e) => e.map((x) => x.textContent.trim()));
  await settle(page);
  ok((await rowsOf()).includes('Probe one'), 'desktop: the to-do shows');
  await api.post(`/todos/${a.id}/tick`, { done: true });
  await page.waitForFunction(() => ![...document.querySelectorAll('.desktop-page .tl-sec .tl-row .tl-title')].some((e) => e.textContent.trim() === 'Probe one'), null, { timeout: 8000 });
  ok(true, 'desktop: a to-do ticked elsewhere leaves the Desktop by itself');
  // While a field has focus, no reload.
  const b = await api.post('/todos', { title: 'Probe two', day });
  const input = page.locator('.desktop-page input').first();
  await input.focus();
  await input.fill('typing');
  await page.waitForTimeout(4500);
  ok(!(await rowsOf()).includes('Probe two') && (await input.inputValue()) === 'typing', 'desktop: no reload while a field has focus, the text is kept');
  await input.evaluate((e) => e.blur());
  await page.waitForFunction(() => [...document.querySelectorAll('.desktop-page .tl-sec .tl-row .tl-title')].some((e) => e.textContent.trim() === 'Probe two'), null, { timeout: 8000 });
  ok(true, 'desktop: it catches up once the field is left');
  await shot(page, 'desktop');
  await api.call('DELETE', `/todos/${b.id}`);
  await api.call('DELETE', `/todos/${a.id}`).catch(() => {});
  await ctx.close();
}

await browser.close();
ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
