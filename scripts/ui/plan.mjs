// Plan my week: the page (this and next week), the strip on Today and Habits, planning and unplanning
// a session, a to-do moved with "Put here" and by dragging, a to-do added into a day, the day's lead.
// Light and E-ink at 390 and 1280 px. Run seed.mjs first.
import { mkdirSync } from 'node:fs';
import { launch, open, apiCtx, OUT, B } from './lib.mjs';
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const errors = [];
const fail = (m) => { errors.push('ASSERT: ' + m); console.log('FAIL', m); };
const api = await apiCtx(browser);

// Some plan data: sessions on days, a to-do with no day, one from earlier, next Friday away.
const plan = await api.get('/plan');
const habits = plan.habits;
const run = habits.find((h) => h.name === 'Run');
if (!run) throw new Error('Run seed.mjs first');
const days = plan.days.filter((d) => !d.past);
for (const d of days.slice(0, 2)) await api.post('/plan/sessions', { habit_id: run.id, day: d.day });
// exactly one "Book the dentist", with no day (a run that stopped half-way may have left it on a day)
const dentists = [...plan.days.flatMap((d) => d.todos), ...plan.unscheduled].filter((t) => t.title === 'Book the dentist');
for (const t of dentists.slice(1)) await api.call('DELETE', `/todos/${t.id}`);
if (dentists[0]) await api.call('PATCH', `/todos/${dentists[0].id}`, { day: null });
else await api.post('/todos', { title: 'Book the dentist' });
const next = await api.get('/plan?week=next');
await api.put('/plan/lead', { day: next.days[4].day, value: 'away' });

const themes = [['light', 'light'], ['eink', 'eink']];
const views = [['phone', { width: 390, height: 844 }], ['desk', { width: 1280, height: 900 }]];
for (const [tname, theme] of themes) {
  for (const [vname, vp] of views) {
    const { page } = await open(browser, vp, errors, { name: `${tname}-${vname}`, init: `try{localStorage.setItem('ft.theme','${theme}')}catch(e){}` });
    const shot = (n, full = true) => page.screenshot({ path: `${OUT}/plan-${tname}-${vname}-${n}.png`, fullPage: full });
    const sideways = async (where) => { if ((await page.evaluate(() => document.documentElement.scrollWidth)) > vp.width + 1) fail(`${tname} ${vname} ${where}: sideways scroll`); };

    await page.goto(`${B}/#/today`);
    // On a phone Today shows one pill at a time (V1-GAPS 40): the week is the "This week" pill.
    await page.waitForSelector('.plan-strip, .pl-pill');
    if (await page.$('.pl-pill')) await page.click('.pl-pill:has-text("This week")');
    await page.waitForSelector('.plan-strip');
    await page.waitForTimeout(400);
    await shot('today');
    await sideways('today');
    await page.goto(`${B}/#/habits`);
    await page.waitForSelector('.plan-strip');
    await page.waitForTimeout(300);
    await shot('habits');
    await page.click('.plan-strip-card .card-head a');
    await page.waitForSelector('.plan-page');
    await page.waitForTimeout(400);
    await shot('this-week');
    await sideways('this week');
    if (tname === 'eink') {
      const small = await page.evaluate(() => [...document.querySelectorAll('.plan-page :is(button, select)')].map((el) => [el.textContent || el.getAttribute('aria-label'), el.getBoundingClientRect()]).filter(([, r]) => r.height && (r.height < 43.5 || r.width < 43.5)).map(([t, r]) => `${t} ${Math.round(r.width)}x${Math.round(r.height)}`));
      if (small.length) fail(`${tname} ${vname}: small tap targets ${small.slice(0, 5).join(', ')}`);
    }

    // Plan a session of Run on the last day, then take it off again.
    const last = page.locator('.plan-day').last();
    await page.locator('.plan-chip', { hasText: 'Run' }).click();
    const before = await last.locator('button.ring').count();
    await last.locator('.plan-add').click();
    await page.waitForTimeout(400);
    if ((await last.locator('button.ring').count()) !== before + 1) fail(`${tname} ${vname}: ring not added`);
    await shot('planned');
    await last.locator('button.ring').last().click();
    await page.waitForTimeout(400);
    if ((await last.locator('button.ring').count()) !== before) fail(`${tname} ${vname}: ring not removed`);

    // Move "Book the dentist" to the last day with Move / Put here, then back to anytime.
    const dentist = page.locator('.plan-loose .plan-todo', { hasText: 'Book the dentist' });
    if (await dentist.count()) {
      await dentist.locator('button').click();
      await page.waitForSelector('.plan-moving');
      await shot('moving', false);
      await last.locator('button.primary', { hasText: 'Put here' }).click();
      await page.waitForTimeout(500);
      if (!(await last.locator('.plan-todo', { hasText: 'Book the dentist' }).count())) fail(`${tname} ${vname}: Put here did not move the to-do`);
      if (vname === 'desk') {
        // and back by dragging onto Anytime
        // HTML5 drag events with one DataTransfer (a real mouse drag cannot scroll the page while dragging).
        await page.waitForTimeout(800);
        const dt = await page.evaluateHandle(() => new DataTransfer());
        await last.locator('.plan-todo', { hasText: 'Book the dentist' }).dispatchEvent('dragstart', { dataTransfer: dt });
        await page.locator('.plan-loose h2').dispatchEvent('dragover', { dataTransfer: dt });
        await page.locator('.plan-loose h2').dispatchEvent('drop', { dataTransfer: dt });
        await page.waitForTimeout(600);
        if (!(await page.locator('.plan-loose .plan-todo', { hasText: 'Book the dentist' }).count())) fail(`${tname} ${vname}: drag to anytime did not work`);
      } else {
        await last.locator('.plan-todo', { hasText: 'Book the dentist' }).locator('button').click();
        await page.locator('.plan-loose button.primary').click();
        await page.waitForTimeout(500);
      }
    } else fail('no Book the dentist to-do');

    // Add a to-do into the last day.
    if (tname === 'light') {
      await last.locator('.plan-add-todo').click();
      await last.locator('.add-input input').fill(`Pack bag ${vname}`);
      await last.locator('.add-input input').press('Enter');
      await page.waitForTimeout(500);
      if (!(await last.locator('.plan-todo', { hasText: `Pack bag ${vname}` }).count())) fail(`${tname} ${vname}: to-do not added`);
    }

    // Next week, with Friday away.
    await page.click('.plan-seg button:nth-child(2)');
    await page.waitForFunction(() => location.hash === '#/plan/next');
    await page.waitForSelector('.plan-day.away');
    await page.waitForTimeout(400);
    await shot('next-week');
    await sideways('next week');
    const fri = page.locator('.plan-day').nth(4);
    if ((await fri.locator('select').inputValue()) !== 'away') fail(`${tname} ${vname}: next Friday not away`);
    await fri.locator('select').selectOption('any');
    await page.waitForTimeout(500);
    if (await page.locator('.plan-day').nth(4).evaluate((e) => e.classList.contains('away'))) fail(`${tname} ${vname}: lead change not shown`);
    await fri.locator('select').selectOption('away');
    await page.waitForTimeout(400);
    await page.close();
  }
}
const after = await api.get('/plan');
console.log('this week planned:', JSON.stringify(after.habits.map((h) => [h.name, h.planned, h.target])));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors, all checks passed');
await browser.close();
process.exit(errors.length ? 1 : 0);
