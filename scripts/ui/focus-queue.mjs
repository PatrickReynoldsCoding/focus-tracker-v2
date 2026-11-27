// Browser check for the focus queue (D67, flag focus-queue): cards and to-dos queued from the card
// dialog (◎ Focus on this now, ＋ Add to queue; a card from another project says so in a message),
// Queued · #n / Now and Take off queue in the dialog, the Now / Queued chip on board cards and list
// rows; Today's focus card shows only Now (tick, title opening its project or list, project label)
// and nothing new when the queue is empty; ticking Now makes the next one Now; the Queue page from
// the focus card's ⋯ (count, order, Now first, drag to reorder, ◎ Now, ✕ leaving the card on its
// board, Nothing queued.); a to-do from the Today list (its list, then its dialog); a phone at
// 390 px (light) and E-ink at 1280 px; the flag off hides everything; no console errors.
// Needs a seeded server (seed.mjs); it removes what it makes and puts the focus back.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/focus-queue.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/focus-queue-${name}.png`, fullPage: true });
const settle = (page) => page.waitForTimeout(700);
const eink = () => localStorage.setItem('ft.theme', 'eink');
const noHScroll = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1);

await api.put('/features/focus-queue', { enabled: true });
await api.put('/features/project-labels', { enabled: true });
const projects = await api.get('/projects');
const p1 = projects.find((p) => p.name === 'Focus Tracker v2');
const p2 = projects.find((p) => p.name === 'Garden shed');
const before = await api.get('/today');
const day = before.day;
await api.put('/focus', { project_id: p1.id });
const clearQueue = async () => {
  for (const i of await api.get('/focus-queue')) await api.call('DELETE', `/focus-queue/${i.id}`);
};
await clearQueue();
const cards = (await api.get(`/projects/${p1.id}/full`)).columns.flatMap((c) => c.cards);
const design = cards.find((c) => c.title === 'Design schema');
const mcp = cards.find((c) => c.title === 'MCP tools');
const gate = await api.post('/tasks', { project_id: p2.id, title: 'FQ fix the gate' });
const shopping = (await api.get('/lists')).find((l) => l.name === 'Shopping');
const todo = await api.post('/todos', { title: 'FQ ring the plumber', list_id: shopping.id, day });
const made = [gate.id, todo.id];
const queueTitles = async () => (await api.get('/focus-queue')).map((i) => i.title);
const toastText = async (page) => (await page.locator('.toast').first().textContent({ timeout: 3000 }).catch(() => '')) ?? '';

/** Open a card's dialog from a project's board (Board view). */
async function openCard(page, projectId, title) {
  await page.goto(`${B}/#/p/${projectId}`);
  await page.waitForSelector('.ub-project');
  await settle(page);
  const seg = page.locator('.ub-seg button:has-text("Board")');
  if ((await seg.count()) && !(await seg.getAttribute('class'))?.includes('on')) await seg.click(), await settle(page);
  // (A sticky note of the project may lie over the card.)
  await page.locator('.kcard', { hasText: title }).first().dispatchEvent('click');
  await page.waitForSelector('dialog[open] .fq-section');
}
const closeDialog = async (page) => (await page.keyboard.press('Escape'), await settle(page));

async function desktop() {
  const name = 'desk';
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name });
  const focus = page.locator('.card.focus').first();

  // Nothing queued: nothing new on the focus card, only its ⋯.
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.card.focus');
  await settle(page);
  const plain = await focus.textContent();
  ok(!(await focus.locator('.fq-now').count()) && !/queue|nothing|up next/i.test(plain), `${name}: an empty queue adds nothing to the focus card`);
  ok((await focus.locator('.fq-menu-btn').count()) === 1, `${name}: the focus card has a ⋯ menu`);
  await shot(page, `${name}-empty`);

  // ◎ Focus on this now from a card's dialog.
  await openCard(page, p1.id, 'Design schema');
  ok((await page.locator('dialog[open] .fq-section button').allTextContents()).join('|') === '◎ Focus on this now|＋ Add to queue', `${name}: the dialog offers Focus on this now and Add to queue`);
  await page.click('dialog[open] button:has-text("Focus on this now")');
  await page.waitForSelector('dialog[open] .fq-section .fq-mark');
  ok((await page.locator('dialog[open] .fq-mark').textContent()) === 'Now', `${name}: the dialog then says Now`);
  ok((await toastText(page)).startsWith('Now: Design schema') && !(await toastText(page)).includes('not in'), `${name}: a card of the focus project gives no warning`);
  await shot(page, `${name}-dialog-now`);
  await closeDialog(page);
  ok((await page.locator('.kcard', { hasText: 'Design schema' }).locator('.fq-mark').textContent()) === '◎ Now', `${name}: the board card has the Now chip`);

  // A card from another project: queued, with a message.
  await openCard(page, p2.id, 'FQ fix the gate');
  await page.click('dialog[open] button:has-text("Add to queue")');
  await page.waitForSelector('dialog[open] .fq-section .fq-mark');
  ok((await page.locator('dialog[open] .fq-mark').textContent()) === 'Queued · #2', `${name}: the dialog says Queued · #2`);
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('not in today'));
  ok((await toastText(page)).includes('not in today’s focus project (Focus Tracker v2)'), `${name}: another project's card says it is not in today's focus project`);
  await shot(page, `${name}-other-project`);
  await closeDialog(page);
  ok((await page.locator('.kcard', { hasText: 'FQ fix the gate' }).locator('.fq-mark').textContent()) === 'Queued', `${name}: the board card has the Queued chip`);

  await openCard(page, p1.id, 'MCP tools');
  await page.click('dialog[open] button:has-text("Add to queue")');
  await page.waitForSelector('dialog[open] .fq-section .fq-mark');
  await closeDialog(page);
  ok(!(await page.locator('.kcard', { hasText: 'Write tests' }).locator('.fq-mark').count()), `${name}: a card not queued has no chip`);

  // A to-do from the Today list: its list, then its dialog; the chip on the list row.
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.today-list');
  await page.locator('.tl-row', { hasText: 'FQ ring the plumber' }).locator('.tl-name').click();
  await page.waitForFunction((id) => location.hash === `#/n/${id}`, shopping.id);
  await settle(page);
  await page.locator('.ub-item', { hasText: 'FQ ring the plumber' }).locator('.ub-title').click();
  await page.waitForSelector('dialog[open] .fq-section');
  await page.click('dialog[open] button:has-text("Add to queue")');
  await page.waitForSelector('dialog[open] .fq-section .fq-mark');
  ok((await page.locator('dialog[open] .fq-mark').textContent()) === 'Queued · #4', `${name}: a to-do is queued from its dialog`);
  await closeDialog(page);
  ok((await page.locator('.ub-item', { hasText: 'FQ ring the plumber' }).locator('.fq-mark').textContent()) === 'Queued', `${name}: the to-do's list row has the Queued chip`);
  ok((await page.locator('.ub-item', { hasText: 'Milk' }).locator('.fq-mark').count()) === 0, `${name}: other rows have none`);
  ok(JSON.stringify(await queueTitles()) === JSON.stringify(['Design schema', 'FQ fix the gate', 'MCP tools', 'FQ ring the plumber']), `${name}: the queue is in the order added`);

  // Today: only Now, with its project label; nothing about what is next.
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.card.focus .fq-now');
  await settle(page);
  ok((await focus.locator('.fq-now-title').textContent()) === 'Design schema', `${name}: the focus card shows Now`);
  ok((await focus.locator('.fq-now .project-label').textContent()) === 'Focus Tracker v2', `${name}: with its project label`);
  const fText = await focus.textContent();
  ok(!fText.includes('FQ fix the gate') && !fText.includes('MCP tools') && !/up next/i.test(fText), `${name}: nothing of what is up next`);
  ok((await focus.locator('button:has-text("Start session"), button:has-text("Swap")').count()) >= 1, `${name}: the rest of the focus card is still there`);
  await shot(page, `${name}-now`);
  ok((await focus.locator('a.fq-now-title').getAttribute('href')) === `#/p/${p1.id}`, `${name}: the title opens its project`);

  // Tick Now: the next one becomes Now.
  await focus.locator('.fq-now .fq-tick').click();
  await page.waitForFunction(() => document.querySelector('.card.focus .fq-now-title')?.textContent === 'FQ fix the gate');
  await settle(page);
  ok((await api.get(`/tasks/${design.id}`)).done, `${name}: ticking Now ticks the card done`);
  ok((await queueTitles())[0] === 'FQ fix the gate', `${name}: the next one is Now`);
  ok((await focus.locator('.fq-now .project-label').textContent()) === 'Garden shed', `${name}: its label names its own project`);

  // The Queue page through ⋯.
  await focus.locator('.fq-menu-btn').click();
  const item = page.locator('.files-menu-item', { hasText: 'Queue' });
  ok((await item.textContent()).replace(/\s+/g, ' ').includes('Queue 3'), `${name}: ⋯ has Queue with its count`);
  await item.click();
  await page.waitForSelector('.fq-page .fq-item');
  ok((await page.evaluate(() => location.hash)) === '#/queue', `${name}: it opens #/queue`);
  ok((await page.locator('.fq-page h1').textContent()) === 'Queue', `${name}: the page is called Queue`);
  const rows = page.locator('.fq-item');
  const titles = async () => (await rows.locator('.fq-title').allTextContents()).map((t) => t.trim());
  ok(JSON.stringify(await titles()) === JSON.stringify(['FQ fix the gate', 'MCP tools', 'FQ ring the plumber']), `${name}: the items in order`);
  ok((await rows.first().locator('.fq-k').textContent()) === 'Now' && (await rows.locator('.fq-k').count()) === 1, `${name}: the first marked Now`);
  ok((await rows.first().locator('.fq-now-btn').count()) === 0 && (await rows.nth(1).locator('.fq-now-btn').count()) === 1, `${name}: ◎ Now on the others`);
  ok((await rows.nth(1).locator('.project-label').textContent()) === 'Focus Tracker v2', `${name}: a project label per item`);
  await shot(page, `${name}-queue`);

  // Drag the last to the top with a mouse.
  const from = await rows.nth(2).locator('.fq-grip').boundingBox();
  const to = await rows.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let s = 1; s <= 12; s++) await page.mouse.move(from.x + 4, from.y + (to.y + 4 - from.y) * (s / 12)), await page.waitForTimeout(30);
  await page.mouse.up();
  await settle(page);
  ok(JSON.stringify(await titles()) === JSON.stringify(['FQ ring the plumber', 'FQ fix the gate', 'MCP tools']), `${name}: dragging reorders on screen`);
  ok((await queueTitles())[0] === 'FQ ring the plumber', `${name}: and on the server`);

  // ◎ Now moves one first.
  await rows.nth(2).locator('.fq-now-btn').click();
  await settle(page);
  ok(JSON.stringify(await titles()) === JSON.stringify(['MCP tools', 'FQ ring the plumber', 'FQ fix the gate']), `${name}: ◎ Now moves it first`);
  ok((await queueTitles())[0] === 'MCP tools', `${name}: and on the server`);

  // ✕ takes one off; the card stays on its board.
  await rows.nth(2).locator('.fq-x').click();
  await settle(page);
  ok(JSON.stringify(await titles()) === JSON.stringify(['MCP tools', 'FQ ring the plumber']), `${name}: ✕ takes it off the queue`);
  const g = await api.get(`/tasks/${gate.id}`);
  ok(g && !g.done, `${name}: the card stays on its board, not done`);

  // A tick on the page; the title opens a to-do's list.
  await rows.first().locator('.fq-tick').click();
  await settle(page);
  ok(JSON.stringify(await titles()) === JSON.stringify(['FQ ring the plumber']), `${name}: a tick on the page takes it off`);
  ok((await api.get(`/tasks/${mcp.id}`)).done, `${name}: and ticks it done`);
  await rows.first().locator('.fq-title').click();
  await page.waitForFunction((id) => location.hash === `#/n/${id}`, shopping.id);
  ok(true, `${name}: a to-do's title opens its list`);

  // Empty.
  await clearQueue();
  await page.goto(`${B}/#/queue`);
  await page.waitForSelector('.fq-empty');
  ok((await page.locator('.fq-empty').textContent()) === 'Nothing queued. Add cards from a card’s dialog.', `${name}: an empty queue says so in one line`);
  await shot(page, `${name}-queue-empty`);
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.card.focus');
  await settle(page);
  ok(!(await focus.locator('.fq-now').count()), `${name}: Today shows no Now once the queue is empty`);
  await ctx.close();
}

async function seedQueue() {
  await clearQueue();
  await api.post(`/tasks/${design.id}/tick`, { done: false });
  await api.post('/focus-queue', { task_id: design.id });
  await api.post('/focus-queue', { task_id: gate.id });
  await api.post('/focus-queue', { task_id: todo.id });
}

async function look(name, viewport, opts) {
  await seedQueue();
  const { page, ctx } = await open(browser, viewport, errors, { name, touch: opts.touch, init: opts.eink ? eink : undefined });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.card.focus .fq-now');
  await settle(page);
  const focus = page.locator('.card.focus').first();
  ok((await focus.locator('.fq-now-title').textContent()) === 'Design schema', `${name}: Now on the focus card`);
  ok(await noHScroll(page), `${name}: no sideways scroll on Today`);
  if (opts.touch) {
    for (const sel of ['.fq-menu-btn', '.fq-now .fq-tick']) {
      const bb = await focus.locator(sel).boundingBox();
      ok(bb.width >= 44 && bb.height >= 44, `${name}: ${sel} is a 44 px target`);
    }
  }
  if (opts.eink) ok((await focus.locator('.fq-now').evaluate((e) => getComputedStyle(e).borderTopWidth)) === '3px', `${name}: E-ink outlines Now`);
  await shot(page, `${name}-today`);
  await focus.locator('.fq-menu-btn').click();
  await page.locator('.files-menu-item', { hasText: 'Queue' }).click();
  await page.waitForSelector('.fq-page .fq-item');
  await settle(page);
  ok((await page.locator('.fq-item').count()) === 3, `${name}: the Queue page lists them`);
  ok(await noHScroll(page), `${name}: no sideways scroll on the Queue page`);
  if (opts.touch) {
    for (const sel of ['.fq-tick', '.fq-now-btn', '.fq-x']) {
      const bb = await page.locator(`.fq-item:nth-child(2) ${sel}`).boundingBox();
      ok(bb.width >= 44 && bb.height >= 44, `${name}: ${sel} on the Queue page is a 44 px target`);
    }
    // A press and hold drags with a finger.
    const r = page.locator('.fq-item');
    const a = await r.nth(2).locator('.fq-grip').boundingBox();
    const t = await r.nth(0).boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(a.x + 6, a.y + a.height / 2) });
    await page.waitForTimeout(400);
    for (let s = 1; s <= 12; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(a.x + 6, a.y + a.height / 2 + (t.y + 4 - a.y - a.height / 2) * (s / 12)) }), await page.waitForTimeout(30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page);
    ok((await queueTitles())[0] === 'FQ ring the plumber', `${name}: a press and hold drags one to the top`);
  }
  await shot(page, `${name}-queue`);
  // The card dialog's part on this screen.
  await openCard(page, p1.id, 'Write tests');
  ok(await noHScroll(page), `${name}: no sideways scroll with the dialog open`);
  if (opts.touch) {
    const bb = await page.locator('dialog[open] .fq-section button').first().boundingBox();
    ok(bb.height >= 44, `${name}: the dialog's buttons are 44 px tall`);
  }
  await shot(page, `${name}-dialog`);
  await closeDialog(page);
  ok((await page.locator('.kcard', { hasText: 'Design schema' }).locator('.fq-mark').count()) === 1, `${name}: the chip on the board`);
  await shot(page, `${name}-board`);
  await ctx.close();
}

async function flagOff() {
  const name = 'off';
  await seedQueue();
  await api.put('/features/focus-queue', { enabled: false });
  const { page, ctx } = await open(browser, { width: 1280, height: 900 }, errors, { name });
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.card.focus');
  await settle(page);
  ok(!(await page.locator('.fq-now, .fq-menu-btn').count()), `${name}: no Now and no ⋯ on the focus card`);
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.ub-project');
  await settle(page);
  ok(!(await page.locator('.fq-mark').count()), `${name}: no chips on the board`);
  await page.locator('.kcard', { hasText: 'Design schema' }).first().click();
  await page.waitForSelector('dialog[open]');
  await settle(page);
  ok(!(await page.locator('dialog[open] .fq-section').count()), `${name}: nothing in the card dialog`);
  await closeDialog(page);
  await page.goto(`${B}/#/queue`);
  await settle(page);
  ok(!(await page.locator('.fq-page').count()), `${name}: no Queue page`);
  await ctx.close();
  await api.put('/features/focus-queue', { enabled: true });
}

try {
  await desktop();
  await look('phone', { width: 390, height: 844 }, { touch: true });
  await look('eink', { width: 1280, height: 900 }, { eink: true });
  await flagOff();
  ok(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await clearQueue().catch(() => {});
  for (const id of [design.id, mcp.id]) await api.post(`/tasks/${id}/tick`, { done: false }).catch(() => {});
  for (const id of made) await api.call('DELETE', `/tasks/${id}`).catch(() => {});
  await api.put('/focus', { project_id: before.focus?.id ?? null }).catch(() => {});
  await browser.close();
}
