// Browser check for opening the app at a file in a given profile (D44), as the Android Files and
// Single file widgets do: `/?profile=<id>#/n/<id>` opens that profile at the file, takes the query
// off the address, keeps the profile on the device and tells the server; a page already open in
// another profile follows; an address without it changes nothing. 390 and 1280 px.
// Needs a seeded server; removes the profile it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/open-link.mjs
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
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const shown = (page) => page.$eval('.profile-switch', (s) => s.options[s.selectedIndex].text);
const LABEL = 'Widget link check';

async function cleanUp() {
  for (const p of (await api.get('/profiles')).profiles) if (p.label === LABEL) await api.post(`/profiles/${p.id}/delete`, { confirm: p.label });
  for (const p of (await api.get('/profiles')).deleted) if (p.label === LABEL) await api.post(`/profiles/${p.id}/purge`, { confirm: p.label });
  await api.put('/profiles/default', { id: 'personal' });
}
await cleanUp();

const prof = await api.post('/profiles', { label: LABEL });
const id = prof.id ?? (await api.get('/profiles')).profiles.find((p) => p.label === LABEL).id;
const note = await api.call('POST', `/lists?mode=${id}`, { name: 'Widget note', kind: 'note' });
await api.call('PUT', `/notes/of/list/${note.id}?mode=${id}`, { body: 'Seen from the widget' });

try {
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desk', { width: 1280, height: 860 }],
  ]) {
    const { page, ctx } = await open(browser, viewport, errors, { name });
    await page.goto(`${B}/#/today`);
    await settle(page);
    ok((await shown(page)) === 'Personal', `${name}: starts in Personal`);

    // As the widget opens it: a full load with ?profile=.
    await page.goto(`${B}/?profile=${encodeURIComponent(id)}#/n/${note.id}`);
    await page.waitForSelector('text=Seen from the widget', { timeout: 8000 });
    await settle(page);
    ok((await shown(page)) === LABEL, `${name}: the profile in the address is open`);
    ok(!page.url().includes('profile='), `${name}: the query is taken off the address (${page.url()})`);
    ok(page.url().endsWith(`#/n/${note.id}`), `${name}: the file's page stays`);
    ok((await page.evaluate(() => localStorage.getItem('ft.mode'))) === id, `${name}: the profile is kept on the device`);
    await page.screenshot({ path: `${OUT}/open-link-${name}.png` });
    const after = await api.get('/profiles');
    if (after.follow_open) ok(after.default === id, `${name}: the server was told (the widgets and menu bar follow the open profile)`);

    // Back the other way, and an address without ?profile= leaves the profile alone.
    await page.goto(`${B}/?profile=personal#/today`);
    await settle(page);
    ok((await shown(page)) === 'Personal', `${name}: ?profile=personal opens Personal`);
    await page.goto(`${B}/#/files`);
    await settle(page);
    ok((await shown(page)) === 'Personal', `${name}: no ?profile= changes nothing`);
    await ctx.close();
  }
} finally {
  await cleanUp();
  await browser.close();
}
if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
console.log('ok - no console errors');
