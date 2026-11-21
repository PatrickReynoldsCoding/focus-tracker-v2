// Worker entry. OAuthProvider sits in front: /mcp needs an OAuth access token
// (or an API token), everything else goes to the Hono app (src/api.ts).

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { buildApp } from './api';
import { tokenOk } from './core/auth';
import { Ctx, type Env } from './core/ctx';
import { ensureMigrated } from './core/migrate';
import { register } from './core/registry';
import { pruneUndo } from './core/store';
import { mcpFetch } from './mcp/server';
import { MODULES } from './modules';
import { dailyNudge, generate } from './modules/notifications';
import { purgeExpired } from './modules/profiles';

register(MODULES);
const app = buildApp();

const providers = new Map<string, OAuthProvider<Env>>();

/** One provider per public origin, so a self-hosted copy works on any domain without configuration. */
function providerFor(origin: string): OAuthProvider<Env> {
  let p = providers.get(origin);
  if (!p) {
    const resource = `${origin}/mcp`;
    p = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: { fetch: (req, env) => mcpFetch(req as Request, env as Env) },
      defaultHandler: { fetch: (req, env, ctx) => app.fetch(req as Request, env, ctx) },
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/register',
      scopesSupported: ['tracker'],
      requiredScopes: ['tracker'],
      resourceMetadata: { resource, authorization_servers: [origin], resource_name: 'Focus Tracker' },
      clientIdMetadataDocumentEnabled: true,
      refreshTokenTTL: 90 * 86400,
      refreshTokenIdleTTL: 30 * 86400,
      // Devices and Claude Code can also use an API token from Settings.
      resolveExternalToken: async ({ token, env }) => ((await tokenOk(env, token)) ? { props: { owner: true, token: true }, audience: resource } : null),
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await ensureMigrated(env.DB);
    const origin = env.PUBLIC_URL?.replace(/\/$/, '') || new URL(req.url).origin;
    let provider: OAuthProvider<Env>;
    try {
      provider = providerFor(origin);
    } catch (err) {
      // OAuth needs https (or localhost). On plain http elsewhere (a phone emulator reaching a dev
      // server, a LAN address) the app still works; only Claude's connector is off.
      const path = new URL(req.url).pathname;
      if (path === '/mcp' || path.startsWith('/oauth') || path === '/register' || path.startsWith('/.well-known/oauth')) {
        return Response.json({ error: `Claude's connector needs https: ${(err as Error).message}` }, { status: 503 });
      }
      return app.fetch(req, env, ctx);
    }
    return provider.fetch(req, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await ensureMigrated(env.DB);
    const modes = (await env.DB.prepare('SELECT id FROM modes').all<{ id: string }>()).results;
    for (const m of modes) {
      const ctx = new Ctx(env, m.id);
      await generate(ctx);
      await dailyNudge(ctx);
    }
    if (new Date().getUTCMinutes() < 5) {
      await pruneUndo(env.DB);
      await purgeExpired(env.DB);
    }
  },
} satisfies ExportedHandler<Env>;
