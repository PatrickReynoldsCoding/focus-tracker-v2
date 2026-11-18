const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** A short random id: 10 characters, 50 bits. Enough for one person's data. */
export function newId(len = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

/** Ids a client may choose itself (for showing a new card before the server answers). */
export const CLIENT_ID = /^[A-Za-z0-9_-]{6,40}$/;

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
