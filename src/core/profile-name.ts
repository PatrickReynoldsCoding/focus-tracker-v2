// A profile as Claude names it (D54): its id ("work") or its name as the owner sees it ("My Work"),
// in any case. Used for every tool's `mode` and the profile tools' own id arguments, so the owner
// can say "add X to Y in my work profile". Unknown: an error listing the profiles.

import { ApiError } from './errors';

type Named = { id: string; label: string };

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The id of the profile `given` names, from `profiles`; null when none matches. An id wins over a
 *  name; "work profile" and "my work" also match a profile called Work when nothing else does. */
export function matchProfile(profiles: Named[], given: string): string | null {
  const g = norm(given);
  if (!g) return null;
  const exact = profiles.find((p) => p.id === given.trim()) ?? profiles.find((p) => p.id.toLowerCase() === g) ?? profiles.find((p) => norm(p.label) === g);
  if (exact) return exact.id;
  const loose = g.replace(/^(the|my)\s+/, '').replace(/\s+(profile|mode)$/, '');
  return profiles.find((p) => p.id.toLowerCase() === loose || norm(p.label) === loose)?.id ?? null;
}

export const profileListText = (profiles: Named[]) => profiles.map((p) => `${p.label} (${p.id})`).join(', ');

/** The id of a live profile given by id or name, or a 400 `unknown_mode` naming the profiles. */
export async function profileIdOf(db: D1Database, given: string): Promise<string> {
  const profiles = (await db.prepare('SELECT id, label FROM modes ORDER BY ord, id').all<Named>()).results;
  const id = matchProfile(profiles, given);
  if (id) return id;
  throw new ApiError(400, `No profile "${given}" (it may have been deleted). Profiles: ${profileListText(profiles)}. Give a profile's id or name`, 'unknown_mode');
}

/** The id of a deleted profile (restorable) given by id or name. */
export async function deletedProfileIdOf(db: D1Database, given: string): Promise<string> {
  const rows = (await db.prepare('SELECT id, row FROM deleted_modes ORDER BY deleted_at DESC').all<{ id: string; row: string }>()).results;
  const profiles = rows.map((r) => ({ id: r.id, label: String((JSON.parse(r.row) as { label?: unknown }).label ?? r.id) }));
  const id = matchProfile(profiles, given);
  if (id) return id;
  throw new ApiError(404, `No deleted profile "${given}"${profiles.length ? `. Deleted profiles: ${profileListText(profiles)}` : ' (none can be restored)'}`);
}
