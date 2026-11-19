import { mkdirSync } from 'node:fs';
import { launch, open, apiCtx, OUT, B } from './lib.mjs';
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const errors = [];
const fail = (m) => { errors.push('ASSERT: ' + m); console.log('FAIL', m); };
const api = await apiCtx(browser);
const projects = await api.get('/projects');
const p1 = projects.find((p) => p.name === 'Focus Tracker v2').id;
await api.call('PATCH', '/modes/work', { color: '#3366cc' });
await api.put('/focus', { project_id: p1 });
await api.post('/session/start', { planned_min: 25, pomodoro: false }).catch((e) => console.log('session', e.message));
const lists = await api.get('/lists/overview');
const note = lists.find((l) => l.kind === 'note').id;

const themes = [
  ['light', { colorScheme: 'dark', theme: 'light' }],
  ['dark', { colorScheme: 'light', theme: 'dark' }],
  ['eink', { colorScheme: 'dark', theme: 'eink' }],
  ['system', { colorScheme: 'dark', theme: null }],
];
const views = [['phone', { width: 390, height: 844 }], ['desk', { width: 1280, height: 860 }]];
const routes = [['today', '/today'], ['projects', '/projects'], ['project', `/p/${p1}`], ['files', '/files'], ['habits', '/habits'], ['insights', '/insights'], ['whiteboards', '/files?type=whiteboards'], ['settings', '/settings']];

const checkEink = (page) => page.evaluate(() => {
  const bad = { colour: new Set(), shadow: 0, motion: 0, small: [] };
  const grey = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return true; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return +a === 0 || (r === g && g === b); };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (!(el.offsetWidth || el.offsetHeight)) continue;
    if (!grey(cs.color)) bad.colour.add(`${el.tagName}.${String(el.className).slice(0, 30)} color ${cs.color}`);
    if (!grey(cs.backgroundColor)) bad.colour.add(`${el.tagName}.${String(el.className).slice(0, 30)} bg ${cs.backgroundColor}`);
    if (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0 && !grey(cs.borderTopColor)) bad.colour.add(`${el.tagName}.${String(el.className).slice(0, 30)} border ${cs.borderTopColor}`);
    if (cs.boxShadow !== 'none') bad.shadow++;
    if (cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0) || (cs.animationName !== 'none')) bad.motion++;
    if (el.matches('button, select, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), .chip, .tabs a, .side a')) {
      const r = el.getBoundingClientRect();
      if (r.height && (r.height < 43.5 || (r.width < 43.5 && !el.matches('input')))) bad.small.push(`${el.tagName}.${String(el.className).slice(0, 25)} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || el.getAttribute('aria-label') || '').slice(0, 15)}"`);
    }
  }
  return { colour: [...bad.colour].slice(0, 12), shadow: bad.shadow, motion: bad.motion, small: bad.small.slice(0, 12) };
});

for (const [tname, t] of themes) {
  for (const [vname, vp] of views) {
    const { page } = await open(browser, vp, errors, { name: `${tname}-${vname}`, colorScheme: t.colorScheme, init: t.theme ? `try{localStorage.setItem('ft.theme','${t.theme}')}catch(e){}` : undefined });
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (attr !== t.theme) fail(`${tname}: data-theme ${attr}`);
    await page.waitForTimeout(1500);
    for (const [rname, r] of routes) {
      await page.goto(`${B}/#${r}`);
      await page.waitForTimeout(rname === 'insights' ? 900 : 500);
      if (rname === 'project') await page.waitForSelector('.sticky-wrap', { timeout: 3000 }).catch(() => {});
      await page.screenshot({ path: `${OUT}/p2-${tname}-${vname}-${rname}.png`, fullPage: true });
      if (tname === 'eink') {
        const c = await checkEink(page);
        if (c.colour.length || c.shadow || c.motion || c.small.length) { console.log(`eink ${vname} ${rname}`, JSON.stringify(c)); }
      }
      if (rname !== 'project' && (await page.evaluate(() => document.documentElement.scrollWidth)) > vp.width + 1) fail(`${tname} ${vname} ${rname}: sideways scroll`);
    }
    // a note in the editor
    await page.goto(`${B}/#/n/${note}`);
    await page.waitForSelector('.ed-view, .ed');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/p2-${tname}-${vname}-note.png`, fullPage: true });
    await page.click('.ed-view').catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/p2-${tname}-${vname}-note-editing.png` });
    if (tname === 'eink') { const c = await checkEink(page); if (c.colour.length || c.shadow || c.motion || c.small.length) console.log(`eink ${vname} note-edit`, JSON.stringify(c)); }
    await page.locator('.ed-head button, .ed-foot button').filter({ hasText: 'Done' }).first().click().catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(300);
    // card dialog on the project page
    await page.goto(`${B}/#/p/${p1}`);
    await page.waitForSelector('.kcard', { timeout: 5000 }).catch((e) => fail(tname + ' ' + vname + ' no kcard'));
    await page.click('.kcard >> nth=0');
    await page.waitForSelector('dialog[open]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/p2-${tname}-${vname}-card.png` });
    await page.keyboard.press('Escape');
    await page.close();
  }
}
// no-flash: with the app's script blocked, the inline script alone has set the theme
{
  const ctx = await browser.newContext();
  await ctx.addInitScript(`try{localStorage.setItem('ft.theme','eink')}catch(e){}`);
  const page = await ctx.newPage();
  await page.route('**/assets/*.js', (r) => r.abort());
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  const a = await page.evaluate(() => [document.documentElement.getAttribute('data-theme'), getComputedStyle(document.body).backgroundColor, document.querySelector('meta[name=theme-color]').content]);
  console.log('no-flash check', JSON.stringify(a));
  if (a[0] !== 'eink' || a[1] !== 'rgb(255, 255, 255)') fail('inline script did not apply eink before the app loaded');
  // storage blocked: must not throw
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(`Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})`);
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('blocked-storage pageerror ' + e.message));
  await p2.goto(B);
  await p2.waitForTimeout(500);
}

// mode accent in light and dark
{
  for (const th of ['light', 'dark']) {
    const { page } = await open(browser, { width: 390, height: 844 }, errors, { name: 'accent-' + th, init: `try{localStorage.setItem('ft.theme','${th}')}catch(e){}` });
    page.on('response', (r) => r.status() === 404 && console.log('404', r.url()));
    // During the session started above the app opens on the project's page (Settings → When the app opens);
    // switch modes from Settings, so the Personal project is not asked for in Work (a 404).
    await page.goto(`${B}/#/settings`);
    await page.waitForTimeout(300);
    await page.click('.mode-switch button >> text=Work');
    await page.waitForTimeout(800);
    const acc = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    console.log('work accent in', th, acc);
    await page.goto(`${B}/#/settings`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/p2-accent-${th}-settings.png`, fullPage: true });
    await page.goto(`${B}/#/files`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/p2-accent-${th}-files.png` });
    // change theme through the UI
    await page.goto(`${B}/#/settings`);
    await page.click('.theme-option >> text=E-ink');
    await page.waitForTimeout(300);
    const eink = await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('ft.theme'), getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()]);
    console.log('after choosing E-ink', JSON.stringify(eink));
    if (eink[0] !== 'eink' || eink[1] !== 'eink') fail('theme choice not applied/stored');
    await page.click('.theme-option >> text=Same as computer');
    await page.waitForTimeout(300);
    const sys = await page.evaluate(() => [document.documentElement.getAttribute('data-theme'), localStorage.getItem('ft.theme')]);
    if (sys[0] !== null || sys[1] !== null) fail('system choice not cleared ' + JSON.stringify(sys));
    await page.close();
  }
}
await browser.close();
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('part2 ok');
