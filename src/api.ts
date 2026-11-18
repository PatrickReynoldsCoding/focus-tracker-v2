// The Hono app: login, the REST API under /api and the /authorize page for Claude.
// Static files (the web app) are served by Workers Assets before this runs.

import { Hono } from 'hono';
import { ZodError } from 'zod';
import { authorizePage } from './authorize';
import { cookieHeader, makeSession, passwordOk, readCookie, SESSION_COOKIE, sessionOk, tokenOk } from './core/auth';
import { Ctx, type Env } from './core/ctx';
import { ApiError, bad } from './core/errors';
import { allModules, entity, type AppEnv } from './core/registry';
import { create, get, list, move, remove, update } from './core/store';

export async function resolveMode(env: Env, requested: string | null | undefined): Promise<string> {
  const mode = requested || (await env.DB.prepare("SELECT value FROM settings WHERE mode = '' AND key = 'default_mode'").first<{ value: string }>())?.value || 'personal';
  const ok = await env.DB.prepare('SELECT 1 FROM modes WHERE id = ?').bind(mode).first();
  if (!ok) throw bad(`No mode "${mode}"`);
  return mode;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof ZodError) return Response.json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), code: 'bad_request' }, { status: 400 });
  if (err instanceof SyntaxError) return Response.json({ error: 'The request body is not valid JSON', code: 'bad_request' }, { status: 400 });
  console.error(err);
  return Response.json({ error: 'Something went wrong on the server', code: 'server_error' }, { status: 500 });
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function buildApp() {
  const app = new Hono<AppEnv>();
  app.onError((err) => errorResponse(err));

  app.get('/health', (c) => c.json({ ok: true, app: 'focus-tracker', version: 2 }));

  // ---- login for the web app ----
  app.post('/auth/login', async (c) => {
    if (!c.env.OWNER_PASSWORD || (c.env.SESSION_SECRET ?? '').length < 32) {
      throw new ApiError(503, 'This tracker is not set up yet: set the OWNER_PASSWORD and SESSION_SECRET secrets (see docs/self-hosting.md).', 'not_set_up');
    }
    const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
    if (!body.password || !(await passwordOk(c.env, body.password))) {
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing a little
      throw new ApiError(401, 'Wrong password');
    }
    const s = await makeSession(c.env);
    c.header('Set-Cookie', cookieHeader(SESSION_COOKIE, s.value, s.maxAge, new URL(c.req.url).protocol === 'https:'));
    return c.json({ ok: true });
  });
  app.post('/auth/logout', (c) => {
    c.header('Set-Cookie', cookieHeader(SESSION_COOKIE, '', 0, new URL(c.req.url).protocol === 'https:'));
    return c.json({ ok: true });
  });
  app.get('/auth/me', async (c) => c.json({ signed_in: await sessionOk(c.env, readCookie(c.req.header('Cookie'), SESSION_COOKIE)) }));

  // ---- Claude's OAuth consent page ----
  app.all('/authorize', (c) => authorizePage(c.req.raw, c.env));

  // ---- the API ----
  const api = new Hono<AppEnv>();
  api.use('*', async (c, next) => {
    const auth = c.req.header('Authorization');
    let ok = false;
    if (auth?.startsWith('Bearer ')) ok = !!(await tokenOk(c.env, auth.slice(7).trim()));
    else if (await sessionOk(c.env, readCookie(c.req.header('Cookie'), SESSION_COOKIE))) {
      // Cookie sign-in: a changing request must carry X-FT-Client, which a form on another site cannot send.
      if (MUTATING.has(c.req.method) && !c.req.header('X-FT-Client')) throw new ApiError(403, 'Missing X-FT-Client header', 'forbidden');
      ok = true;
    }
    if (!ok) throw new ApiError(401, 'Sign in, or send an API token');
    const ctx = new Ctx(c.env, await resolveMode(c.env, c.req.header('X-Mode') ?? c.req.query('mode')));
    ctx.label = `${c.req.method} ${new URL(c.req.url).pathname.replace(/^\/api\//, '')}`;
    c.set('ctx', ctx);
    await next();
    if (MUTATING.has(c.req.method)) await ctx.flushUndo();
  });

  for (const m of allModules()) m.routes?.(api);

  // Generic routes for every kind of row, after the modules' own routes.
  api.get('/:kind', async (c) => {
    const e = entity(c.req.param('kind'));
    const q = c.req.queries();
    const where: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(q)) {
      if (['limit', 'offset', 'mode'].includes(k)) continue;
      if (!(e.filters ?? []).includes(k)) throw bad(`Cannot filter ${e.name} by ${k}. Filters: ${(e.filters ?? []).join(', ') || 'none'}`);
      where[k] = v[0] === '' || v[0] === 'null' ? null : v[0];
    }
    return c.json(await list(c.get('ctx'), e, { where, limit: Number(c.req.query('limit') ?? 500), offset: Number(c.req.query('offset') ?? 0) }));
  });
  api.post('/:kind', async (c) => {
    const e = writable(c.req.param('kind'));
    return c.json(await create(c.get('ctx'), e, await c.req.json()), 201);
  });
  api.get('/:kind/:id', async (c) => c.json(await get(c.get('ctx'), entity(c.req.param('kind')), c.req.param('id'))));
  api.patch('/:kind/:id', async (c) => c.json(await update(c.get('ctx'), writable(c.req.param('kind')), c.req.param('id'), await c.req.json())));
  api.delete('/:kind/:id', async (c) => {
    await remove(c.get('ctx'), writable(c.req.param('kind')), c.req.param('id'));
    return c.json({ deleted: c.req.param('id') });
  });
  api.post('/:kind/:id/move', async (c) => c.json(await move(c.get('ctx'), writable(c.req.param('kind')), c.req.param('id'), await c.req.json())));

  app.route('/api', api);
  app.notFound((c) => c.json({ error: 'Not found', code: 'not_found' }, 404));
  return app;
}

function writable(kind: string) {
  const e = entity(kind);
  if (e.internal) throw bad(`${kind} cannot be changed directly`);
  return e;
}
