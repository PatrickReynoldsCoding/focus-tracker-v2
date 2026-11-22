// The Hono app: login, the REST API under /api and the /authorize page for Claude.
// Static files (the web app) are served by Workers Assets before this runs.

import { Hono } from 'hono';
import { ZodError } from 'zod';
import { authorizePage } from './authorize';
import { cookieHeader, makeSession, passwordOk, readCookie, SESSION_COOKIE, sessionOk, tokenOk } from './core/auth';
import { Ctx, type Env } from './core/ctx';
import { ApiError, bad } from './core/errors';
import { alias, allModules, entity, type AppEnv } from './core/registry';
import { kindOps } from './core/store';

export async function resolveMode(env: Env, requested: string | null | undefined): Promise<string> {
  const mode = requested || (await env.DB.prepare("SELECT value FROM settings WHERE mode = '' AND key = 'default_mode'").first<{ value: string }>())?.value || 'personal';
  const ok = await env.DB.prepare('SELECT 1 FROM modes WHERE id = ?').bind(mode).first();
  if (!ok) throw new ApiError(400, `No profile "${mode}" (it may have been deleted)`, 'unknown_mode');
  return mode;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) return Response.json({ ...err.data, error: err.message, code: err.code }, { status: err.status });
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
    ctx.client = c.req.query('client') ?? null;
    ctx.label = `${c.req.method} ${new URL(c.req.url).pathname.replace(/^\/api\//, '')}`;
    c.set('ctx', ctx);
    await next();
    if (MUTATING.has(c.req.method)) await ctx.flushUndo();
  });

  for (const m of allModules()) m.routes?.(api);

  // Generic routes for every kind of row, after the modules' own routes. An old kind kept as an
  // alias (todos, D40) answers through its module.
  api.get('/:kind', async (c) => {
    const kind = c.req.param('kind');
    const a = alias(kind);
    const filters = a ? Object.keys(a.fields) : (entity(kind).filters ?? []);
    const where: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c.req.queries())) {
      if (['limit', 'offset', 'mode'].includes(k)) continue;
      if (!filters.includes(k)) throw bad(`Cannot filter ${kind} by ${k}. Filters: ${filters.join(', ') || 'none'}`);
      where[k] = v[0] === '' || v[0] === 'null' ? null : v[0];
    }
    return c.json(await kindOps(kind).list(c.get('ctx'), { where, limit: Number(c.req.query('limit') ?? 500), offset: Number(c.req.query('offset') ?? 0) }));
  });
  api.post('/:kind', async (c) => c.json(await kindOps(c.req.param('kind')).create(c.get('ctx'), await c.req.json()), 201));
  api.get('/:kind/:id', async (c) => c.json(await kindOps(c.req.param('kind')).get(c.get('ctx'), c.req.param('id'))));
  api.patch('/:kind/:id', async (c) => c.json(await kindOps(c.req.param('kind')).update(c.get('ctx'), c.req.param('id'), await c.req.json())));
  api.delete('/:kind/:id', async (c) => {
    await kindOps(c.req.param('kind')).remove(c.get('ctx'), c.req.param('id'));
    return c.json({ deleted: c.req.param('id') });
  });
  api.post('/:kind/:id/move', async (c) => c.json(await kindOps(c.req.param('kind')).move(c.get('ctx'), c.req.param('id'), await c.req.json())));

  app.route('/api', api);
  app.notFound((c) => c.json({ error: 'Not found', code: 'not_found' }, 404));
  return app;
}

