// The page Claude's connector opens to get access: the owner types the
// password (unless already signed in to the web app) and allows or denies.

import { AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { passwordOk, readCookie, SESSION_COOKIE, sessionOk } from './core/auth';
import type { Env } from './core/ctx';

const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(title: string, body: string, headers = new Headers()): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'");
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e2e2dc;--accent:#2f6fed;--warn:#a15c00}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ececea;--muted:#a3a39d;--card:#20201e;--line:#34342f;--accent:#7aa2ff;--warn:#f0b35a}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;max-width:420px;width:100%}
h1{font-size:1.25rem;margin:0 0 12px}p{margin:8px 0}.muted{color:var(--muted);font-size:.9rem}.warn{color:var(--warn)}
input[type=password]{width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;margin:8px 0}
.row{display:flex;gap:8px;margin-top:16px}button{flex:1;padding:10px;border-radius:8px;border:1px solid var(--line);font:inherit;cursor:pointer;background:var(--bg);color:var(--fg)}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
</style><main>${body}</main></html>`,
    { headers },
  );
}

function consentHtml(d: ConsentDescription, handle: string, signedIn: boolean, error?: string): string {
  const who = d.clientDomain ? `published by <strong>${esc(d.clientDomain)}</strong>` : 'an app that registered itself (its name is not verified)';
  return `<h1>Allow ${esc(d.clientName)} to use Focus Tracker?</h1>
<p>${esc(d.clientName)} is ${who}. It will be able to read and change all your Focus Tracker data.</p>
<p class="muted">Access goes to <strong>${esc(d.redirectHost)}</strong>.</p>
${d.redirectIsLoopback ? '<p class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>' : ''}
${error ? `<p class="warn">${esc(error)}</p>` : ''}
<form method="post">
<input type="hidden" name="handle" value="${esc(handle)}">
${d.scope.map((s) => `<input type="hidden" name="scope" value="${esc(s)}">`).join('')}
${signedIn ? '' : '<label>Your Focus Tracker password<input type="password" name="password" autocomplete="current-password" required autofocus></label>'}
<div class="row"><button name="decision" value="deny" formnovalidate>Deny</button><button class="primary" name="decision" value="approve">Allow</button></div>
</form>`;
}

export async function authorizePage(req: Request, env: Env & { OAUTH_PROVIDER?: OAuthHelpers }): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) return new Response('OAuth is not set up', { status: 500 });
  const signedIn = await sessionOk(env, readCookie(req.headers.get('Cookie'), SESSION_COOKIE));
  try {
    if (req.method === 'GET') {
      const request = await oauth.parseAuthRequest(req);
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      return page('Connect Focus Tracker', consentHtml(details, consent.handle, signedIn), consent.headers);
    }
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const form = await req.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(req, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    if (!signedIn && !(await passwordOk(env, String(form.get('password') ?? '')))) {
      await new Promise((r) => setTimeout(r, 400));
      // The handle works once, so start the authorization again from the client.
      return page('Wrong password', '<h1>Wrong password</h1><p>Go back to Claude and connect again.</p>');
    }
    const approved = await oauth.approveConsent(req, handle, { scope: form.getAll('scope').map(String) });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: 'owner',
      metadata: { label: 'Claude' },
      scope: approved.request.scope,
      props: { owner: true },
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : 'This app could not be verified.';
      return page('Cannot connect', `<h1>Cannot connect</h1><p>${esc(message ?? 'The request is not valid.')}</p><p class="muted">Start connecting again from Claude.</p>`);
    }
    throw error;
  }
}
