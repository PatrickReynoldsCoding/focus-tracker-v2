// Settings → Appearance: the theme for this device (Same as computer, Light, Dark, E-ink).
// The choice lives in localStorage (core/theme.ts); index.html applies it before the first paint.
// E-ink's look is in eink.css; the rest of the app reads the tokens in styles.css.

import { registerPanel } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { setTheme, themeChoice, THEMES } from '../../core/theme';
import './eink.css';
import './theme.css';

function Appearance() {
  const choice = useSignal(themeChoice);
  return (
    <section class="card appearance">
      <h2>Appearance</h2>
      <p class="muted small">Chosen for this device only. Each device keeps its own.</p>
      <div class="theme-options" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <label key={t.id} class={`theme-option ${choice === t.id ? 'on' : ''}`}>
            <input type="radio" name="theme" value={t.id} checked={choice === t.id} onChange={() => setTheme(t.id)} />
            <span class="theme-text">
              <strong>{t.label}</strong>
              <span class="muted small">{t.hint}</span>
            </span>
            <span class={`theme-swatch sw-${t.id}`} aria-hidden="true">
              Aa
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

registerPanel('settings', { id: 'appearance', order: 12, scope: 'device', render: () => <Appearance /> });
