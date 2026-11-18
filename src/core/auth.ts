// Single-owner auth (docs/DECISIONS.md D4):
// - the web app: the owner's password (Worker secret OWNER_PASSWORD) gives a signed session cookie;
// - devices (Android, SwiftBar, scripts): API tokens made in Settings, sent as "Authorization: Bearer ft_...";
// - Claude: OAuth through /authorize (password + consent), handled by workers-oauth-provider.

import type { Env } from './ctx';
import { sha256Hex } from './ids';

export const SESSION_COOKIE = 'ft_session';
const SESSION_DAYS = 30;

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function secretOf(env: Env): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters)');
  return env.SESSION_SECRET;
}

/** Compare a typed password with OWNER_PASSWORD without leaking timing. */
export async function passwordOk(env: Env, password: string): Promise<boolean> {
  if (!env.OWNER_PASSWORD) return false;
  const s = secretOf(env);
  return equal(await hmac(s, password), await hmac(s, env.OWNER_PASSWORD));
}

export async function makeSession(env: Env, now = Date.now()): Promise<{ value: string; maxAge: number }> {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  // The password's hash is part of the signature, so changing the password ends every session.
  const pw = (await sha256Hex(env.OWNER_PASSWORD)).slice(0, 16);
  return { value: `${exp}.${await hmac(secretOf(env), `owner.${exp}.${pw}`)}`, maxAge: SESSION_DAYS * 86400 };
}

export async function sessionOk(env: Env, value: string | undefined, now = Date.now()): Promise<boolean> {
  if (!value) return false;
  const [expText, sig] = value.split('.');
  const exp = Number(expText);
  if (!exp || !sig || exp * 1000 < now) return false;
  const pw = (await sha256Hex(env.OWNER_PASSWORD)).slice(0, 16);
  return equal(sig, await hmac(secretOf(env), `owner.${exp}.${pw}`));
}

/** An API token's row, if the token is valid. Updates last_used at most once an hour. */
export async function tokenOk(env: Env, token: string): Promise<{ id: string; name: string } | null> {
  if (!token.startsWith('ft_')) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT id, name, last_used FROM api_tokens WHERE hash = ?').bind(hash).first<{ id: string; name: string; last_used: string | null }>();
  if (!row) return null;
  const now = new Date();
  if (!row.last_used || now.getTime() - Date.parse(row.last_used) > 3600_000) {
    await env.DB.prepare('UPDATE api_tokens SET last_used = ? WHERE id = ?').bind(now.toISOString(), row.id).run();
  }
  return { id: row.id, name: row.name };
}

export function cookieHeader(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}
