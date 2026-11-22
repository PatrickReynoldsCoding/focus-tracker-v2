// A profile's own theme (DECISIONS D61): the open profile's theme is read from the profile list
// and applied at once when the profile changes (core/theme.ts keeps a copy per profile on the
// device, so the first paint after a reload is right too).

import { mode } from '../../core/api';
import { profiles } from '../../core/profiles';
import { setProfileTheme } from '../../core/theme';

function fromList() {
  const list = profiles.value;
  if (!list) return;
  const mine = list.profiles.find((p) => p.id === mode.value);
  if (mine) setProfileTheme(mine.theme ?? null);
}
profiles.subscribe(fromList);
mode.subscribe(fromList);
fromList();
