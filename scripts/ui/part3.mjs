import { mkdirSync } from 'node:fs';
import { launch, open, apiCtx, OUT, B } from './lib.mjs';
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const errors = [];
const fail = (m) => { errors.push('ASSERT: ' + m); console.log('FAIL', m); };
const ok = (m) => console.log('ok  ', m);
const api = await apiCtx(browser);
// no running session, so Today stays Today
await api.post('/session/stop', { note: 'test' }).catch(() => {});
const projects = await api.get('/projects');
const p1 = projects.find((p) => p.name === 'Focus Tracker v2').id;
const lists = await api.get('/lists/overview');
const note = lists.find((l) => l.kind === 'note').id;

const hash = (page) => page.evaluate(() => location.hash);
const transform = (page) => page.evaluate(() => document.querySelector('main.content').style.transform);

async function swipe(page, cdp, { from, to, y = 400, hold, steps = 10, end = true }) {
  const pt = (x) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from) });
  let mid = null;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from + ((to - from) * i) / steps) });
    await page.waitForTimeout(16);
    if (i === Math.floor(steps / 2)) mid = await transform(page);
  }
  if (hold) await page.waitForTimeout(hold);
  if (end) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(550);
  return mid;
}

// ---------------- phone, touch
{
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name: 'phone', touch: true });
  const cdp = await ctx.newCDPSession(page);
  await page.waitForTimeout(800);
  // 1. Back button
  await page.goto(`${B}/#/today`);
  await page.waitForTimeout(500);
  if (await page.locator('.back-btn').count()) fail('Back button shown with nothing to go back to');
  else ok('no Back button at the start');
  await page.goto(`${B}/#/files`);
  await page.waitForSelector('.files .files-open');
  await page.locator('.files .files-open[href^="#/n/"]').first().click();
  await page.waitForSelector('.ed.is-editing');
  await page.waitForSelector('.back-btn');
  await page.screenshot({ path: `${OUT}/p3-phone-back-visible.png` });
  ok('Back button appears after opening a note: ' + (await hash(page)));
  await page.reload();
  await page.waitForSelector('.back-btn', { timeout: 5000 }).then(() => ok('Back survives a reload')).catch(() => fail('Back lost on reload'));
  await page.click('.back-btn');
  await page.waitForTimeout(400);
  if ((await hash(page)) !== '#/files') fail('Back went to ' + (await hash(page)));
  else ok('Back returns to Files');
  // deleted pages are skipped
  const tmp = await api.post('/lists', { name: 'Temporary', kind: 'note' });
  await page.reload(); await page.waitForSelector('.files .files-open');
  await page.goto(`${B}/#/n/${tmp.id}`);
  await page.waitForSelector('.page-head h1');
  await page.goto(`${B}/#/habits`);
  await page.waitForTimeout(400);
  await api.call('DELETE', `/lists/${tmp.id}`);
  await page.click('.back-btn');
  await page.waitForTimeout(800);
  const h = await hash(page);
  if (h.includes(tmp.id)) fail('Back went to a deleted page ' + h); else ok('Back skips the deleted page, now at ' + h);
  // dialogs close first with the phone's own back
  await page.goto(`${B}/#/p/${p1}`);
  await page.waitForSelector('.kcard');
  await page.click('.kcard >> nth=0', { position: { x: 12, y: 12 } }); // the seeded sticky notes cover its middle on a phone
  await page.waitForSelector('dialog[open]');
  await page.goBack();
  await page.waitForTimeout(500);
  if (await page.locator('dialog[open]').count()) fail('phone back did not close the dialog'); else ok('phone back closes the dialog first');
  if (!(await hash(page)).startsWith('#/p/')) fail('phone back left the page: ' + (await hash(page)));

  // 2. Swipe
  await page.goto(`${B}/#/files`);
  await page.waitForSelector('.files .files-open');
  await page.waitForTimeout(400);
  let mid = await swipe(page, cdp, { from: 300, to: 60, y: 330, hold: 0, end: false });
  console.log('   transform mid-swipe:', mid);
  if (!mid || !mid.includes('translateX(-')) fail('page did not follow the finger: ' + mid);
  else ok('page follows the finger');
  await page.screenshot({ path: `${OUT}/p3-phone-swipe-mid.png` });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  if ((await hash(page)) !== '#/habits') fail('swipe left from Files went to ' + (await hash(page))); else ok('swipe left: Files -> Habits');
  if ((await transform(page)) !== '') fail('transform not cleared: ' + (await transform(page)));
  await swipe(page, cdp, { from: 60, to: 320, y: 330 });
  if ((await hash(page)) !== '#/files') fail('swipe right went to ' + (await hash(page))); else ok('swipe right: back to Files');
  // short swipe springs back
  await swipe(page, cdp, { from: 200, to: 160, y: 330, steps: 5 });
  if ((await hash(page)) !== '#/files') fail('short swipe changed the page'); else ok('short swipe springs back');
  // first tab: swipe right does nothing and springs back
  await page.goto(`${B}/#/today`);
  await page.waitForTimeout(500);
  mid = await swipe(page, cdp, { from: 60, to: 330, y: 330 });
  console.log('   transform at the end of the tabs (mid):', mid);
  if ((await hash(page)) !== '#/today' || (await transform(page)) !== '') fail('end of tabs: ' + (await hash(page)) + ' ' + (await transform(page))); else ok('springs back at the first tab');
  // from the edge is left to the phone
  await page.goto(`${B}/#/files`); await page.waitForTimeout(400);
  await swipe(page, cdp, { from: 8, to: 300, y: 330 });
  if ((await hash(page)) === '#/projects') fail('edge swipe taken: ' + (await hash(page))); else ok('edge swipe left alone');

  // ignored places
  const stays = async (name, setup, p) => {
    await page.goto(`${B}/#${p}`); await page.waitForTimeout(700);
    const pos = await setup();
    await swipe(page, cdp, { from: pos.x, to: pos.x - 230, y: pos.y });
    const now = await hash(page);
    await page.evaluate(() => document.querySelectorAll('#test-range, #test-wide').forEach((e) => e.remove()));
    if (now !== `#${p}`) fail(`swipe over ${name} changed the page to ${now}`); else ok(`swipe ignored over ${name}`);
  };
  await stays('a board', async () => { const b = await page.locator('.board').boundingBox(); return { x: 330, y: b.y + 30 }; }, `/p/${p1}`);
  await stays('a sticky note', async () => { const b = await page.locator('.sticky-wrap >> nth=0').boundingBox(); return { x: b.x + b.width - 30, y: b.y + 70 }; }, `/p/${p1}`);
  await stays('a text field', async () => { const b = await page.locator('input[type=search]').boundingBox(); return { x: b.x + b.width - 30, y: b.y + 10 }; }, '/files');
  await stays('a slider', async () => {
    await page.evaluate(() => { const i = document.createElement('input'); i.type = 'range'; i.id = 'test-range'; i.style.cssText = 'position:fixed;top:300px;left:20px;width:340px;z-index:5'; document.body.appendChild(i); });
    return { x: 330, y: 310 };
  }, '/habits');
  await stays('a sideways-scrolling element', async () => {
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'test-wide'; d.style.cssText = 'position:fixed;top:300px;left:0;width:390px;height:80px;overflow-x:auto;z-index:5;background:#eee'; d.innerHTML = '<div style="width:1200px;height:60px">wide</div>'; document.body.appendChild(d); });
    return { x: 330, y: 330 };
  }, '/habits');
  // the editor
  await page.goto(`${B}/#/n/${note}`);
  await page.waitForSelector('.ed.is-editing');
  await page.waitForTimeout(500);
  let b = await page.locator('.ed.is-editing').boundingBox();
  await swipe(page, cdp, { from: 330, to: 100, y: b.y + 30 });
  if (!(await hash(page)).startsWith('#/n/')) fail('swipe over note view changed the page'); else ok('swipe ignored over the note');
  await page.click('.ProseMirror'); await page.waitForTimeout(600);
  await swipe(page, cdp, { from: 330, to: 100, y: 300 });
  if (!(await hash(page)).startsWith('#/n/')) fail('swipe in the editor changed the page'); else ok('swipe ignored in the editor');
  await page.locator('.ed-head button, .ed-foot button').filter({ hasText: 'Done' }).first().click().catch(() => {});
  // a dialog
  await page.goto(`${B}/#/p/${p1}`); await page.waitForSelector('.kcard');
  await page.click('.kcard >> nth=0', { position: { x: 12, y: 12 } }); // the seeded sticky notes cover its middle on a phone await page.waitForSelector('dialog[open]');
  await swipe(page, cdp, { from: 330, to: 100, y: 400 });
  if (!(await hash(page)).startsWith('#/p/')) fail('swipe in a dialog changed the page'); else ok('swipe ignored in a dialog');
  await page.keyboard.press('Escape');
  // whiteboards
  const wbs = await api.get('/whiteboards');
  if (wbs.length) {
    await page.goto(`${B}/#/w/${wbs[0].id}`); await page.waitForTimeout(2500);
    await swipe(page, cdp, { from: 330, to: 100, y: 400 });
    if (!(await hash(page)).startsWith('#/w/')) fail('swipe on a whiteboard changed the page'); else ok('swipe ignored on a whiteboard');
  }

  // 3. flag off
  await api.put('/features/swipe-tabs', { enabled: false });
  await page.goto(`${B}/#/files`); await page.reload(); await page.waitForSelector('.files .files-open'); await page.waitForTimeout(600);
  await swipe(page, cdp, { from: 330, to: 60, y: 330 });
  if ((await hash(page)) !== '#/files') fail('swipe worked with the flag off'); else ok('flag off: no swipe');
  await api.put('/features/swipe-tabs', { enabled: true });
  await page.close();
}

// ---------------- E-ink and reduced motion: swipe changes the page, no motion
for (const [name, opts] of [['eink', { init: "try{localStorage.setItem('ft.theme','eink')}catch(e){}" }], ['reduced', { reducedMotion: 'reduce' }]]) {
  const { page, ctx } = await open(browser, { width: 390, height: 844 }, errors, { name: 'calm-' + name, touch: true, ...opts });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${B}/#/files`); await page.waitForSelector('.files .files-open'); await page.waitForTimeout(500);
  const mid = await swipe(page, cdp, { from: 330, to: 60, y: 330, end: false });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  if (mid) fail(`${name}: page moved with the finger (${mid})`); else ok(`${name}: page does not follow the finger`);
  if ((await hash(page)) !== '#/habits') fail(`${name}: swipe did not change tab: ` + (await hash(page))); else ok(`${name}: swipe still changes the tab`);
  await page.screenshot({ path: `${OUT}/p3-${name}-habits.png` });
  await page.close();
}

// ---------------- desktop 1280: Back button, no swipe
{
  const { page } = await open(browser, { width: 1280, height: 860 }, errors, { name: 'desk' });
  await page.goto(`${B}/#/files`); await page.waitForSelector('.files .files-open');
  await page.locator('.files .files-open[href^="#/n/"]').first().click();
  await page.waitForSelector('.back-btn');
  await page.screenshot({ path: `${OUT}/p3-desk-back.png` });
  await page.click('.back-btn');
  await page.waitForTimeout(400);
  if ((await hash(page)) !== '#/files') fail('desktop Back: ' + (await hash(page))); else ok('desktop Back works');
  await page.goto(`${B}/#/projects`); await page.waitForTimeout(300);
  await page.goBack(); await page.waitForTimeout(300);
  ok('browser back at desktop: ' + (await hash(page)) + ', button ' + (await page.locator('.back-btn').count()));
  await page.close();
}
await browser.close();
const real = errors.filter((e) => !/status of 404/.test(e)); console.log('(expected 404 probe logs:', errors.length - real.length, ')');
if (real.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('part3 ok');
