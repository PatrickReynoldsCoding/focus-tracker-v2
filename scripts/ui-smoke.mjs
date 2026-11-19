// Browser smoke test: seeds a local server, clicks through every tab at phone and desktop size,
// saves screenshots and fails on console errors.
//   npm run build && npx wrangler dev --port 8787 --persist-to /tmp/ft-smoke   (fresh data, .dev.vars password)
//   node scripts/ui-smoke.mjs /tmp/ft-shots        (CHROME_PATH=... if Chrome is not /usr/bin/google-chrome)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const B = process.env.FT_URL ?? 'http://localhost:8787';
const PASSWORD = process.env.FT_PASSWORD ?? 'test-password';
const OUT = process.argv[2] ?? '/tmp/ft-shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true });
const errors = [];
async function session(viewport, name) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(B);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button.primary');
  await page.waitForSelector('.focus');
  return page;
}
// seed via API with a cookie session
const seedCtx = await browser.newContext();
const r = await seedCtx.request.post(`${B}/auth/login`, { data: { password: PASSWORD } });
const H = { 'X-FT-Client': 'seed', 'Content-Type': 'application/json' };
const post = (p, d) => seedCtx.request.post(`${B}/api${p}`, { headers: H, data: d }).then((x) => x.json());
const cat = await post('/categories', { label: 'Coding', color: 'blue' });
const p1 = await post('/projects', { name: 'Focus Tracker v2', category_id: cat.id });
await post('/projects', { name: 'Garden shed' });
await post('/projects', { name: 'Job search', category_id: cat.id });
await post('/tasks', { project_id: p1.id, title: 'Design schema', note: 'Tables for **every** entity' });
await post('/tasks', { project_id: p1.id, title: 'MCP tools', color: 'green' });
await post('/criteria', { project_id: p1.id, text: 'Works on my phone' });
await post('/habits', { name: 'Stretch', sessions: 2, per: 'day', small_version: '1 minute' });
await post('/habits', { name: 'Run', sessions: 3, per: 'week' });
await post('/todos', { title: 'Reply to landlord', day: new Date().toISOString().slice(0, 10) });
const note = await post('/lists', { name: 'Ideas', kind: 'note' });
await seedCtx.request.put(`${B}/api/notes/of/list/${note.id}`, { headers: H, data: { body: '# Ideas\n- widget\n- **menu bar**' } });
await post('/lists', { name: 'Read and watch', kind: 'list' });

for (const [vp, name] of [[{ width: 390, height: 844 }, 'phone'], [{ width: 1280, height: 860 }, 'desktop']]) {
  const page = await session(vp, name);
  await page.screenshot({ path: `${OUT}/${name}-today-empty.png`, fullPage: true });
  // choose focus from a suggestion chip
  await page.click('.focus .chips .chip >> nth=0');
  await page.waitForSelector('.focus-name');
  await page.click('text=Start session');
  await page.waitForSelector('.timer');
  // add a to-do
  await page.fill('input[placeholder="Add a to-do for today"]', 'Buy milk');
  await page.press('input[placeholder="Add a to-do for today"]', 'Enter');
  await page.waitForSelector('text=Buy milk');
  // Today shows one pill's panels at a time: the habits are in the first pill, Today, in the Today list
  // (or in the Habits panel while the flag today-panel is off).
  await page.locator('.today-list .tl-sec .tl-tick, .habits-panel .dot').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-today-session.png`, fullPage: true });
  // stop the session
  await page.click('.focus button.primary');
  await page.fill('dialog textarea', 'halfway through');
  await page.click('dialog button.primary');
  await page.waitForSelector('text=Session logged');
  // project page
  await page.goto(`${B}/#/p/${p1.id}`);
  await page.waitForSelector('.board');
  await page.fill('.column >> nth=1 >> input[placeholder="Add a card"]', 'Doing card');
  await page.press('.column >> nth=1 >> input[placeholder="Add a card"]', 'Enter');
  await page.waitForSelector('text=Doing card');
  await page.screenshot({ path: `${OUT}/${name}-project.png`, fullPage: true });
  await page.click('text=Design schema');
  await page.waitForSelector('dialog[open]');
  await page.screenshot({ path: `${OUT}/${name}-card.png` });
  await page.keyboard.press('Escape');
  await page.goto(`${B}/#/projects`); await page.waitForSelector('table');
  await page.screenshot({ path: `${OUT}/${name}-projects.png`, fullPage: true });
  await page.goto(`${B}/#/notes`); await page.waitForSelector('.note-grid');
  await page.screenshot({ path: `${OUT}/${name}-notes.png`, fullPage: true });
  await page.goto(`${B}/#/habits`); await page.waitForSelector('.habits-page');
  await page.goto(`${B}/#/settings`); await page.waitForSelector('text=Weekly rotation');
  await page.screenshot({ path: `${OUT}/${name}-settings.png`, fullPage: true });
  await page.goto(`${B}/#/log`); await page.waitForSelector('text=halfway through');
  // clean focus for the next run
  await seedCtx.request.put(`${B}/api/focus`, { headers: H, data: { project_id: null } });
}
await browser.close();
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`ok: screenshots in ${OUT}`);
