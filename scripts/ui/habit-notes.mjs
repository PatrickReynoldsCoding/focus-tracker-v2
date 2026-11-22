// Browser check for habit notes and the habit dialog (D56): a habit's name in any panel (the Today
// list, the Habits panel, the Habits tab, a project's page, Plan my week, Insights) opens one
// dialog with the notes at the top and the settings below; the notes save as you type (the note
// editor, conflict-safe: a change made elsewhere meanwhile asks Keep mine / Use theirs / Keep
// both), and the plain text box with rich-editor off; 📝 shows on rows with notes, its tooltip the
// first line; the tick circle still ticks and Not today still works; Enter opens it from the
// keyboard; Back closes it on a phone; the habits flag off hides it. Light, dark and E-ink at 390
// and 1280 px. Needs a seeded server (seed.mjs); puts the habits and switches back.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/habit-notes.mjs
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
const shot = (page, name) => page.screenshot({ path: `${OUT}/habit-notes-${name}.png`, fullPage: true });
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };
/** Wait (in Node) until `check` answers true. */
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
const sideways = async (page, w, where) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= w + 1, `${where}: no sideways scroll`);

const features = await api.get('/features');
const was = (id) => features.find((f) => f.id === id)?.enabled;
const keep = ['desktop-pills', 'panel-restyle', 'rich-editor', 'habits'].map((id) => [id, was(id)]);
await api.put('/features/desktop-pills', { enabled: false });
for (const id of ['panel-restyle', 'rich-editor', 'habits']) await api.put(`/features/${id}`, { enabled: true });

const habits = await api.get('/habits');
const run = habits.find((h) => h.name === 'Run');
const stretch = habits.find((h) => h.name === 'Stretch');
const project = (await api.get('/projects')).find((p) => p.name === 'Focus Tracker v2');
const progressOf = async (id) => (await api.get('/habits/progress')).find((h) => h.id === id);
const notesOf = async (id) => (await api.get(`/habits/${id}`)).notes ?? '';
async function reset() {
  for (const h of [run, stretch]) {
    await api.call('PATCH', `/habits/${h.id}`, { notes: null, small_version: h.small_version ?? null, project_id: null });
    await api.post(`/habits/${h.id}/check`, { count: 0 });
    await api.post(`/habits/${h.id}/not-today`, { on: false });
  }
}
await reset();

const dialog = (page) => page.locator('dialog[open]:has(.habit-dialog)');
async function closeDialog(page) {
  await page.click('dialog[open] .sheet-head button[aria-label="Close"]');
  await dialog(page).waitFor({ state: 'detached' });
  await settle(page, 300);
}
async function opensFrom(page, loc, where) {
  await loc.first().scrollIntoViewIfNeeded();
  await loc.first().click();
  await dialog(page).waitFor();
  ok(true, `${where}: the habit's name opens the habit dialog`);
  await closeDialog(page);
}
const todayRow = (page, name) => page.locator(`.today-list .tl-row:has(.tl-title:text-is("${name}"))`).first();
async function today(page) {
  await page.goto(`${B}/#/today`);
  await page.waitForSelector('.today-list');
  await settle(page, 600);
}

async function desk() {
  const name = 'light-desk';
  const { page, ctx } = await open(browser, DESK, errors, { name });
  await today(page);

  // The Today list: the name opens the dialog, notes first, settings below.
  await todayRow(page, 'Run').locator('.tl-name').click();
  await dialog(page).waitFor();
  await settle(page);
  const d = dialog(page);
  ok((await d.locator('.sheet-head h2').textContent()).trim() === 'Run', `${name}: the dialog is titled with the habit's name`);
  const order = await d.evaluate((el) => {
    const n = el.querySelector('.habit-notes');
    const s = el.querySelector('.habit-settings');
    return !!n && !!s && !!(n.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  ok(order, `${name}: notes at the top, the settings below`);
  ok((await d.locator('.habit-settings input').first().inputValue()) === 'Run', `${name}: the settings show the habit (name Run)`);
  ok((await d.locator('.habit-settings button:has-text("Move up")').count()) === 0, `${name}: no move buttons away from the Habits tab`);
  await shot(page, `${name}-dialog-empty`);

  // Write notes: they save as you type.
  await d.locator('.habit-notes .ed-view').click();
  await page.waitForSelector('dialog[open] .habit-notes .ProseMirror');
  await page.keyboard.type('Kit: goggles and a towel');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Pool opens at 7');
  ok(await until(async () => (await notesOf(run.id)) === 'Kit: goggles and a towel\n\nPool opens at 7'), `${name}: the notes save as you type`);
  await shot(page, `${name}-dialog-editing`);
  await closeDialog(page);

  // 📝 on the row, its tooltip the first line.
  await todayRow(page, 'Run').locator('.habit-notes-mark').waitFor();
  ok((await todayRow(page, 'Run').locator('.habit-notes-mark').getAttribute('title')) === 'Kit: goggles and a towel', `${name}: 📝 on the Today row, tooltip the first line`);
  ok((await todayRow(page, 'Stretch').locator('.habit-notes-mark').count()) === 0, `${name}: no 📝 on a habit without notes`);

  // Reopen: the notes are shown, formatted.
  await todayRow(page, 'Run').locator('.tl-name').click();
  await dialog(page).waitFor();
  ok((await dialog(page).locator('.habit-notes .ed-view').textContent()).includes('Pool opens at 7'), `${name}: the notes show when the dialog opens again`);

  // A change made elsewhere while editing: the editor asks, nothing is lost.
  await dialog(page).locator('.habit-notes .ed-view').click();
  await page.waitForSelector('dialog[open] .habit-notes .ProseMirror');
  await settle(page, 600);
  await api.call('PATCH', `/habits/${run.id}`, { notes: 'Changed by Claude' });
  const before = errors.length;
  await page.keyboard.type(' (mine)');
  await page.waitForSelector('dialog[open] .ed-conflict', { timeout: 8000 });
  // The browser logs the server's 409 answer: that is this step's point, not an error.
  for (let i = errors.length - 1; i >= before; i--) if (errors[i].includes('409')) errors.splice(i, 1);
  ok(true, `${name}: a change made elsewhere meanwhile asks Keep mine / Use theirs / Keep both`);
  await page.click('dialog[open] .ed-conflict button:has-text("Keep both")');
  ok(await until(async () => {
    const n = await notesOf(run.id);
    return n.includes('Changed by Claude') && n.includes('(mine)');
  }), `${name}: Keep both keeps both texts`);
  await closeDialog(page);
  await api.call('PATCH', `/habits/${run.id}`, { notes: 'Kit: goggles and a towel\nPool opens at 7' });

  // The tick still ticks (no dialog); Not today still works.
  await today(page);
  await todayRow(page, 'Run').locator('.tl-tick').click();
  await settle(page, 700);
  ok((await progressOf(run.id)).done_today === 1 && !(await page.$('dialog[open]')), `${name}: the circle still checks in, no dialog`);
  await api.post(`/habits/${run.id}/check`, { count: 0 });
  await today(page);
  await todayRow(page, 'Stretch').locator('.tl-act:has-text("Not today")').click();
  await settle(page, 700);
  ok((await progressOf(stretch.id)).skipped_today && !(await page.$('dialog[open]')), `${name}: Not today still works`);
  await api.post(`/habits/${stretch.id}/not-today`, { on: false });

  // Keyboard: Tab to the name, Enter opens, Escape closes.
  await today(page);
  await todayRow(page, 'Run').locator('.tl-name').focus();
  await page.keyboard.press('Enter');
  await dialog(page).waitFor();
  ok(true, `${name}: Enter on the name opens the dialog`);
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  ok(true, `${name}: Escape closes it`);

  // Settings save from the dialog.
  await todayRow(page, 'Run').locator('.tl-name').click();
  await dialog(page).waitFor();
  const small = dialog(page).locator('label:has-text("Small version") input');
  await small.fill('Walk to the pool');
  await dialog(page).locator('button.primary:has-text("Save")').click();
  await dialog(page).waitFor({ state: 'detached' });
  ok(await until(async () => (await api.get(`/habits/${run.id}`)).small_version === 'Walk to the pool'), `${name}: Save in the settings changes the habit`);
  ok((await notesOf(run.id)).startsWith('Kit:'), `${name}: and keeps the notes`);

  // The Habits panel on Today.
  await today(page);
  await opensFrom(page, page.locator('[data-panel="habits"] .hr-row:has-text("Run") .tl-name'), `${name} Habits panel`);
  ok((await page.locator('[data-panel="habits"] .hr-row:has-text("Run") .habit-notes-mark').count()) === 1, `${name}: 📝 on the Habits panel row`);
  await page.locator('[data-panel="habits"] .hr-row:has-text("Stretch") .tl-tick').click();
  await settle(page, 700);
  ok((await progressOf(stretch.id)).done_today === 1 && !(await page.$('dialog[open]')), `${name}: the Habits panel's circle still checks in`);
  await api.post(`/habits/${stretch.id}/check`, { count: 0 });

  // The Habits tab: the name, and Edit (with the move buttons).
  await page.goto(`${B}/#/habits`);
  await page.waitForSelector('.habits-page');
  await settle(page);
  await opensFrom(page, page.locator('.habit-item .habit-name:has-text("Run")'), `${name} Habits tab`);
  await page.click('.habit-item button[aria-label="Edit Run"]');
  await dialog(page).waitFor();
  ok((await dialog(page).locator('.habit-notes').count()) === 1 && (await dialog(page).locator('button:has-text("Move up")').count()) === 1, `${name}: Edit opens the same dialog, with the move buttons`);
  await shot(page, `${name}-habits-tab-dialog`);
  await closeDialog(page);

  // A project's page: the linked habit's panel.
  await api.call('PATCH', `/habits/${run.id}`, { project_id: project.id });
  await page.goto(`${B}/#/p/${project.id}`);
  await page.waitForSelector('[data-panel="habits"] .hr-row', { timeout: 8000 });
  await opensFrom(page, page.locator('[data-panel="habits"] .hr-row:has-text("Run") .tl-name'), `${name} project page`);
  await api.call('PATCH', `/habits/${run.id}`, { project_id: null });

  // Plan my week: the planned habit's name on a day, and the chosen habit's line.
  const plan = await api.get('/plan');
  const day = plan.days.find((x) => !x.past)?.day ?? plan.days.at(-1).day;
  await api.post('/plan/sessions', { habit_id: run.id, day });
  await page.goto(`${B}/#/plan`);
  await page.waitForSelector('.plan-page');
  await settle(page);
  await opensFrom(page, page.locator('.plan-hname:has-text("Run")'), `${name} Plan my week`);
  await page.locator('.plan-chip', { hasText: 'Run' }).click();
  await opensFrom(page, page.locator('.plan-picker p .habit-name'), `${name} Plan my week (chosen habit)`);
  await api.post("/plan/sessions", { habit_id: run.id, day, count: 0 });

  // Insights: the week's habits and the Habits sub-tab.
  await page.goto(`${B}/#/insights`);
  await page.waitForSelector('.ins-habit-name', { timeout: 8000 });
  await opensFrom(page, page.locator('.ins-habit-name:has-text("Run")'), `${name} Insights week`);

  // The plain text box (rich-editor off) saves too.
  await api.put('/features/rich-editor', { enabled: false });
  await today(page);
  await page.reload();
  await page.waitForSelector('.today-list');
  await todayRow(page, 'Stretch').locator('.tl-name').click();
  await dialog(page).waitFor();
  await dialog(page).locator('.habit-notes .md-view').click();
  await dialog(page).locator('.habit-notes textarea').fill('Hamstrings first');
  await dialog(page).locator('.sheet-head h2').click();
  ok(await until(async () => (await notesOf(stretch.id)) === 'Hamstrings first'), `${name}: with rich-editor off, the plain text box saves the notes`);
  await closeDialog(page);
  await api.put('/features/rich-editor', { enabled: true });

  // The habits flag off: no habit names, no dialog.
  await api.put('/features/habits', { enabled: false });
  await page.reload();
  await page.waitForSelector('.today-list');
  await settle(page, 600);
  ok((await page.locator('.habit-name').count()) === 0, `${name}: habits off: no habit names to open`);
  await api.put('/features/habits', { enabled: true });
  await ctx.close();
}

async function look(theme, vname, vp, scheme) {
  const name = `${theme}-${vname}`;
  const phone = vp === PHONE;
  const { page, ctx } = await open(browser, vp, errors, { name, touch: phone, colorScheme: scheme, init: `try{localStorage.setItem('ft.theme','${theme}')}catch(e){}` });
  await today(page);
  ok((await todayRow(page, 'Run').locator('.habit-notes-mark').count()) === 1, `${name}: 📝 on the row`);
  await sideways(page, vp.width, `${name} today`);
  await shot(page, `${name}-today`);
  await todayRow(page, 'Run').locator('.tl-name').click();
  await dialog(page).waitFor();
  await settle(page, 600);
  await sideways(page, vp.width, `${name} dialog`);
  const box = await dialog(page).boundingBox();
  ok(box.width <= vp.width + 1, `${name}: the dialog fits the screen (${Math.round(box.width)} px)`);
  await shot(page, `${name}-dialog`);
  if (phone) {
    await page.goBack();
    await dialog(page).waitFor({ state: 'detached' });
    await settle(page, 400);
    ok((await page.evaluate(() => location.hash)) === '#/today', `${name}: Back closes the sheet and stays on Today`);
    // The tick still ticks on a phone.
    await todayRow(page, 'Stretch').locator('.tl-tick').tap();
    await settle(page, 700);
    ok((await progressOf(stretch.id)).done_today === 1 && !(await page.$('dialog[open]')), `${name}: tapping the circle checks in, no sheet`);
    await api.post(`/habits/${stretch.id}/check`, { count: 0 });
  } else await closeDialog(page);
  await ctx.close();
}

try {
  await desk();
  await look('light', 'phone', PHONE);
  await look('dark', 'desk', DESK, 'dark');
  for (const [v, vp] of [['phone', PHONE], ['desk', DESK]]) await look('eink', v, vp);
} finally {
  await reset();
  for (const [id, on] of keep) if (on !== undefined) await api.put(`/features/${id}`, { enabled: on });
  await browser.close();
}
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`ok: screenshots in ${OUT}`);
