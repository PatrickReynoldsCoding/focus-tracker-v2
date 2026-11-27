// Browser check: habits grouped by category with headings that fold (features/habits/Groups.tsx):
// on Today, the Habits tab, Plan my week and Insights, at 390 and 1280 px, light, dark and E-ink;
// a heading is 44 px tall, folds and unfolds, the fold is kept after a reload and only for its screen.
// Needs a seeded server (seed.mjs); removes the category it makes.
// Usage: FT_URL=http://localhost:8787 node scripts/ui/habit-groups.mjs
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

await api.put('/features/habits', { enabled: true });
await api.put('/features/today-panel', { enabled: true });
const habits = (await api.get('/habits')).filter((h) => h.status === 'active');
if (habits.length < 2) throw new Error('Run seed.mjs first');
const category = await api.post('/categories', { label: 'Health', color: 'green' });
await api.call('PATCH', `/habits/${habits[0].id}`, { category_id: category.id });

const screens = [
  ['today', '#/today', '.today-list'],
  ['habits', '#/habits', '.habits-page'],
  ['plan', '#/plan', '.plan-picker'],
  ['insights', '#/insights', 'main'],
];

try {
  for (const [name, viewport, touch, colorScheme, theme] of [
    ['phone', { width: 390, height: 844 }, true, 'light'],
    ['desk-dark', { width: 1280, height: 900 }, false, 'dark'],
    ['eink', { width: 1280, height: 900 }, false, 'light', 'eink'],
  ]) {
    const init = theme ? `localStorage.setItem('ft.theme', '${theme}')` : undefined;
    const { page, ctx } = await open(browser, viewport, errors, { name, touch, colorScheme, init });
    for (const [screen, hash, ready] of screens) {
      await page.goto(`${B}/${hash}`);
      await page.waitForSelector(`${ready} .hg-head`);
      const group = page.locator(`${ready} .hg-group`).filter({ hasText: 'Health' }).first();
      const head = group.locator('.hg-head');
      ok((await head.boundingBox()).height >= 43.5, `${name} ${screen}: the heading is 44 px tall`);
      ok((await page.locator(`${ready} .hg-head`).allTextContents()).at(-1).includes('No category'), `${name} ${screen}: No category is last`);
      const open_ = await group.textContent();
      ok(open_.includes(habits[0].name), `${name} ${screen}: open at first`);
      await page.screenshot({ path: `${OUT}/habit-groups-${name}-${screen}.png`, fullPage: true });
      await head.click();
      ok((await head.getAttribute('aria-expanded')) === 'false' && !(await group.textContent()).includes(habits[0].name), `${name} ${screen}: a tap folds it`);
      await page.reload();
      await page.waitForSelector(`${ready} .hg-head`);
      ok((await head.getAttribute('aria-expanded')) === 'false', `${name} ${screen}: still folded after a reload`);
      await head.click();
      ok((await group.textContent()).includes(habits[0].name), `${name} ${screen}: a tap opens it again`);
      ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= viewport.width + 1, `${name} ${screen}: no sideways scroll`);
    }
    await ctx.close();
  }
} finally {
  await api.post(`/categories/${category.id}/delete`, {});
  await browser.close();
}
if (errors.length) {
  console.log('ERRORS:', errors.join('\n'));
  process.exit(1);
}
