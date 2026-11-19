import { chromium } from 'playwright-core';
export const B = process.env.FT_URL ?? 'http://localhost:8787';
export const PASSWORD = 'test-password';
export const OUT = process.env.FT_SHOTS ?? '/tmp/ft-ui-shots';
export const launch = () => chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
export async function apiCtx(browser) {
  const c = await browser.newContext();
  await c.request.post(`${B}/auth/login`, { data: { password: PASSWORD } });
  const H = { 'X-FT-Client': 'seed', 'Content-Type': 'application/json' };
  const call = async (m, p, d) => {
    const r = await c.request.fetch(`${B}/api${p}`, { method: m, headers: H, data: d });
    const t = await r.text();
    if (!r.ok()) throw new Error(`${m} ${p} ${r.status()} ${t}`);
    return t ? JSON.parse(t) : null;
  };
  return { call, post: (p, d) => call('POST', p, d), put: (p, d) => call('PUT', p, d), get: (p) => call('GET', p) };
}
export async function open(browser, viewport, errors, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: !!opts.touch, isMobile: !!opts.touch, colorScheme: opts.colorScheme ?? 'light', reducedMotion: opts.reducedMotion });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${opts.name ?? ''}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${opts.name ?? ''}: ${e.message}`));
  await page.goto(B);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button.primary');
  await page.waitForSelector('.shell');
  return { page, ctx };
}
