// A profile's colour: a few to choose from, or any colour from the system picker.
import { useLook } from '../../core/theme';
import { shownColour } from './accent';
import { PROFILE_COLOURS } from './colours';

const NAMES = ['Green', 'Blue', 'Purple', 'Pink', 'Orange', 'Gold', 'Leaf', 'Slate'];

export function ColourChoice({ value, onPick, label }: { value: string; onPick: (c: string) => void; label: string }) {
  useLook();
  const own = !PROFILE_COLOURS.includes(value.toLowerCase());
  return (
    <div class="swatches profile-swatches" role="radiogroup" aria-label={label}>
      {PROFILE_COLOURS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={NAMES[i]}
          title={NAMES[i]}
          class={`swatch ${value.toLowerCase() === c ? 'on' : ''}`}
          style={{ background: shownColour(c) }}
          onClick={() => onPick(c)}
        />
      ))}
      <label class={`profile-own ${own ? 'on' : ''}`} title="Another colour" style={own ? { background: shownColour(value) } : undefined}>
        {!own && <span aria-hidden="true">+</span>}
        <input type="color" aria-label="Another colour" value={value} onChange={(e) => onPick((e.target as HTMLInputElement).value)} />
      </label>
    </div>
  );
}
