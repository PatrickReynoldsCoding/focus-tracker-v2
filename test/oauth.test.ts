import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE } from './helpers';

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function cookiesFrom(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function startAuthorization() {
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  const reg = await SELF.fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  expect(reg.status).toBe(201);
  const client = await reg.json<any>();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    scope: 'tracker',
    resource: `${BASE}/mcp`,
  });
  const page = await SELF.fetch(`${BASE}/authorize?${q}`);
  expect(page.status).toBe(200);
  const html = await page.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)![1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return { client, verifier, redirect, html, handle, cookie: cookiesFrom(page) };
}

describe('OAuth for Claude', () => {
  it('shows the consent page with a password field and the client name escaped', async () => {
    const { html } = await startAuthorization();
    expect(html).toContain('Allow Claude to use Focus Tracker?');
    expect(html).toContain('type="password"');
    expect(html).toContain('claude.ai');
  });

  it('refuses a wrong password', async () => {
    const { handle, cookie } = await startAuthorization();
    const form = new URLSearchParams({ handle, decision: 'approve', password: 'wrong', scope: 'tracker' });
    const res = await SELF.fetch(`${BASE}/authorize`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Wrong password');
  });

  it('issues a token after the password, and the token works on /mcp', async () => {
    const { client, verifier, redirect, handle, cookie } = await startAuthorization();
    const form = new URLSearchParams({ handle, decision: 'approve', password: 'test-password', scope: 'tracker' });
    const res = await SELF.fetch(`${BASE}/authorize`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, redirect: 'manual' });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location')!);
    expect(loc.origin + loc.pathname).toBe(redirect);
    expect(loc.searchParams.get('state')).toBe('xyz');
    const code = loc.searchParams.get('code')!;
    const tok = await SELF.fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.client_id, code_verifier: verifier, resource: `${BASE}/mcp` }),
    });
    expect(tok.status).toBe(200);
    const { access_token, refresh_token } = await tok.json<any>();
    expect(refresh_token).toBeTruthy();
    const call = await SELF.fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_today', arguments: {} } }),
    });
    expect(call.status).toBe(200);
    const body = await call.json<any>();
    expect(body.result.isError).toBeFalsy();
    // The OAuth token is for /mcp only, not the REST API.
    const api = await SELF.fetch(`${BASE}/api/status`, { headers: { Authorization: `Bearer ${access_token}` } });
    expect(api.status).toBe(401);
  });

  it('denies cleanly', async () => {
    const { handle, cookie } = await startAuthorization();
    const res = await SELF.fetch(`${BASE}/authorize`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ handle, decision: 'deny' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('Location')!).searchParams.get('error')).toBe('access_denied');
  });
});

describe('connected apps', () => {
  it('lists Claude after it connects and can disconnect it', async () => {
    const { apiToken } = await import('./helpers');
    const H = { Authorization: `Bearer ${await apiToken()}`, 'Content-Type': 'application/json' };
    const before = await (await SELF.fetch(`${BASE}/api/connections`, { headers: H })).json<any[]>();
    // the previous test in this file connected one; connect another to be independent
    const { handle, cookie } = await startAuthorization();
    await SELF.fetch(`${BASE}/authorize`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ handle, decision: 'approve', password: 'test-password', scope: 'tracker' }),
      redirect: 'manual',
    });
    const after = await (await SELF.fetch(`${BASE}/api/connections`, { headers: H })).json<any[]>();
    expect(after.length).toBe(before.length + 1);
    expect(after[0].client).toBe('Claude');
    const res = await SELF.fetch(`${BASE}/api/connections/${after[0].id}`, { method: 'DELETE', headers: H });
    expect(res.status).toBe(200);
    const end = await (await SELF.fetch(`${BASE}/api/connections`, { headers: H })).json<any[]>();
    expect(end.length).toBe(before.length);
  });
});
