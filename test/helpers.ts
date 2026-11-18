import { env, SELF } from 'cloudflare:test';

export const BASE = 'https://ft.example.com';
let token: string | null = null;

/** An API token, made directly in the test database. */
export async function apiToken(): Promise<string> {
  if (token) {
    const ok = await env.DB.prepare('SELECT 1 FROM api_tokens WHERE name = ?').bind('test').first();
    if (ok) return token;
  }
  token = 'ft_testtoken_' + Math.random().toString(36).slice(2);
  const data = new TextEncoder().encode(token);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO api_tokens (id, name, hash, created) VALUES (?, ?, ?, ?)').bind('tok' + Math.random().toString(36).slice(2, 8), 'test', hash, new Date().toISOString()).run();
  return token;
}

export async function call<T = any>(method: string, path: string, body?: unknown, opts: { mode?: string; expect?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await apiToken()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.mode) headers['X-Mode'] = opts.mode;
  const res = await SELF.fetch(`${BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  const expect = opts.expect ?? (method === 'POST' && /^\/[a-z_]+$/.test(path) && !['/undo', '/redo', '/tokens'].includes(path) ? 201 : 200);
  if (res.status !== expect) throw new Error(`${method} ${path} -> ${res.status} (expected ${expect}): ${text}`);
  return data as T;
}

export async function mcp<T = any>(method: string, params?: Record<string, unknown>, id: number | null = 1): Promise<T> {
  const res = await SELF.fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await apiToken()}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
  });
  if (id === null) return res.status as T;
  const data = (await res.json()) as any;
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result as T;
}

/** Call a tool and parse its JSON answer. Throws when the tool reports an error. */
export async function tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await mcp<any>('tools/call', { name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text) as T;
}

export async function toolError(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const r = await mcp<any>('tools/call', { name, arguments: args });
  if (!r.isError) throw new Error(`${name} should have failed`);
  return r.content[0].text;
}
