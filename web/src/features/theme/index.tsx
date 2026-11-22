// Settings → Appearance: the colour theme for this device (a swatch to tap), "follow my phone" with
// the light and dark theme to use, and the separate E-ink switch. DECISIONS D61.
// The choice lives in localStorage (core/theme.ts); index.html applies it before the first paint.
// A profile can have its own theme (Manage profiles, profile-theme.tsx here). E-ink's look is in
// eink.css; every other theme is a set of CSS variables in web/src/themes.

import { registerPanel } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { chooseTheme, COLOUR_THEMES, darkTheme, deviceTheme, eink, followPhone, lightTheme, profileTheme, setEink, setFollowPhone, setFollowThemes, themeById, themeNow } from '../../core/theme';
import './eink.css';
import './profile-theme';
import './theme.css';

const light = COLOUR_THEMES.filter((t) => t.kind === 'light');
const dark = COLOUR_THEMES.filter((t) => t.kind === 'dark');

function Appearance() {
  const now = useSignal(themeNow);
  const mine = useSignal(deviceTheme);
  const follow = useSignal(followPhone);
  const inkOn = useSignal(eink);
  const day = useSignal(lightTheme);
  const night = useSignal(darkTheme);
  const own = useSignal(profileTheme);
  return (
    <section class="card appearance">
      <h2>Appearance</h2>
      <p class="muted small">Chosen for this device only. Each device keeps its own. A profile can have its own look too (Manage profiles).</p>
      <div class="theme-swatches" role="radiogroup" aria-label="Colour theme">
        {COLOUR_THEMES.map((t) => {
          const on = !follow && !inkOn && mine === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-theme-id={t.id}
              class={`theme-swatch-btn ${on ? 'on' : ''}`}
              style={{ background: t.vars['--bg'], color: t.vars['--fg'], '--sw-line': t.vars['--line'] }}
              onClick={() => chooseTheme(t.id)}
            >
              <span class="sw-bar" style={{ background: t.vars['--accent'] }} />
              <span class="sw-panel" style={{ background: t.vars['--surface'], borderColor: t.vars['--line'] }} />
              <span class="sw-name">{t.label}</span>
            </button>
          );
        })}
      </div>
      <label class="inline theme-follow">
        <input type="checkbox" checked={follow} onChange={(e) => setFollowPhone((e.target as HTMLInputElement).checked)} />
        <span>Follow my phone: light theme by day, dark by night</span>
      </label>
      {follow && (
        <div class="row theme-follow-pick">
          <label>
            Light theme (day)
            <select value={day} onChange={(e) => setFollowThemes((e.target as HTMLSelectElement).value, null)}>
              {light.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dark theme (night)
            <select value={night} onChange={(e) => setFollowThemes(null, (e.target as HTMLSelectElement).value)}>
              {dark.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label class="inline theme-eink">
        <input type="checkbox" checked={inkOn} onChange={(e) => setEink((e.target as HTMLInputElement).checked)} />
        <span>
          E-ink screen
          <span class="muted small" style="display:block">Black on white, thick borders, patterns for colours, no motion. For e-ink screens; it overrides the themes above.</span>
        </span>
      </label>
      {own && !inkOn && (
        <p class="muted small theme-profile-note">
          This profile has its own theme ({themeById(own)?.label}), so it shows instead of the choice above. Change it in Manage profiles.
        </p>
      )}
      <p class="muted small">
        Showing now: <strong>{now === 'eink' ? 'E-ink' : (themeById(now)?.label ?? now)}</strong>
      </p>
    </section>
  );
}

registerPanel('settings', {
  id: 'appearance',
  order: 12,
  scope: 'device',
  icon: '🎨',
  summary: () => {
    const id = useSignal(themeNow);
    const follow = useSignal(followPhone);
    const inkOn = useSignal(eink);
    if (inkOn) return 'E-ink';
    return `${themeById(id)?.label ?? id} · follows phone ${follow ? 'on' : 'off'}`;
  },
  render: () => <Appearance /> });
