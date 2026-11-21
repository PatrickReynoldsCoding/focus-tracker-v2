// A profile's colour as a small dot (beside its name, so the colour never carries meaning alone).
import { useLook } from '../../core/theme';
import { shownColour } from './accent';
import type { Profile } from '../../core/profiles';
import { USUAL_COLOUR } from './colours';

export function ProfileDot({ p }: { p?: Pick<Profile, 'color'> | null }) {
  useLook(); // the shade follows Light and Dark
  return <span class="profile-dot" aria-hidden="true" style={{ background: shownColour(p?.color || USUAL_COLOUR) }} />;
}
