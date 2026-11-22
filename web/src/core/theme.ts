// The colour theme (DECISIONS D61). What is on screen comes from, in this order:
//   1. E-ink, when this device's E-ink switch is on (always wins);
//   2. the open profile's own theme (Manage profiles), if it has one;
//   3. "follow my phone" (this device): the light theme by day, the dark one by night;
//   4. the theme chosen on this device.
// The device's choices live in localStorage and web/index.html applies them before the first
// paint (keep the two in step). A theme is a set of CSS variables (web/src/themes, one file each),
// put on the page as one <style id="ft-theme"> rule for the current theme, and `data-theme` on <html>.

import { COLOUR_THEMES, themeById, themeCss } from '../themes';
import { mode } from './api';
import { signal, useSignal } from './signal';

export type Look = 'light' | 'dark' | 'eink';
export { COLOUR_THEMES, themeById };

const DEFAULT_LIGHT = 'paper';
const DEFAULT_DARK = 'midnight';

const get = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode or blocked storage: the choice lasts until the page closes */
  }
};

// Before this, the device chose Same as computer (no key), Light, Dark or E-ink in one key.
const legacy = get('ft.theme');
const chosen = (legacy === 'light' ? 'paper' : legacy === 'dark' ? 'midnight' : legacy) ?? null;
const kindOf = (id: string | null, kind: 'light' | 'dark', fallback: string) => (themeById(id)?.kind === kind ? (id as string) : fallback);

export const eink = signal<boolean>(get('ft.eink') === '1' || legacy === 'eink');
export const deviceTheme = signal<string>(themeById(chosen) ? (chosen as string) : DEFAULT_LIGHT);
export const followPhone = signal<boolean>(get('ft.follow') === '1' ? true : get('ft.follow') === '0' ? false : !themeById(chosen));
export const lightTheme = signal<string>(kindOf(get('ft.theme.light'), 'light', DEFAULT_LIGHT));
export const darkTheme = signal<string>(kindOf(get('ft.theme.dark'), 'dark', DEFAULT_DARK));
/** The open profile's own theme (null: the same as the app). */
export const profileTheme = signal<string | null>(null);

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** The theme id on screen now: a colour theme's id, or 'eink'. */
export function currentThemeId(): string {
  if (eink.value) return 'eink';
  const own = profileTheme.value;
  if (own && themeById(own)) return own;
  if (followPhone.value) return query?.matches ? darkTheme.value : lightTheme.value;
  return deviceTheme.value;
}
const lookOf = (id: string): Look => (id === 'eink' ? 'eink' : (themeById(id)?.kind ?? 'light'));

export const resolvedTheme = signal<Look>('light');
/** Whether the theme on screen uses the open profile's colour as its accent (Midnight, Paper) rather than its own. */
export const profileAccentOn = signal<boolean>(true);
export const isEink = () => resolvedTheme.value === 'eink';
export const useLook = () => useSignal(resolvedTheme);
export const useEink = () => useSignal(resolvedTheme) === 'eink';
export const useThemeId = () => useSignal(themeNow);
export const themeNow = signal<string>('paper');

const cached = (id: string) => `ft.tcss.${id}`;

function apply() {
  const id = currentThemeId();
  const el = document.documentElement;
  let style = document.getElementById('ft-theme') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'ft-theme';
    document.head.appendChild(style);
  }
  const def = themeById(id);
  style.textContent = def ? themeCss(def) : '';
  el.setAttribute('data-theme', id);
  el.setAttribute('data-kind', lookOf(id) === 'dark' ? 'dark' : 'light');
  themeNow.value = id;
  resolvedTheme.value = lookOf(id);
  profileAccentOn.value = !def || def.profileAccent === true;
  // The browser's and the Android app's bar colour follows the page.
  const bar = def?.vars['--bg'] ?? '#ffffff';
  for (const m of Array.from(document.querySelectorAll('meta[name="theme-color"]'))) m.setAttribute('content', bar);
}

// The profile's theme is kept per profile on this device too, so the first paint is right (web/index.html).
const profileKey = (m: string) => `ft.ptheme.${m}`;
export function setProfileTheme(id: string | null | undefined, m: string = mode.value) {
  const valid = id && themeById(id) ? id : null;
  set(profileKey(m), valid);
  if (m !== mode.value) return;
  if (valid !== profileTheme.value) {
    profileTheme.value = valid;
    apply();
  }
}
profileTheme.value = (() => {
  const v = get(profileKey(mode.value));
  return v && themeById(v) ? v : null;
})();

function save() {
  set('ft.theme', deviceTheme.value);
  set('ft.eink', eink.value ? '1' : null);
  set('ft.follow', followPhone.value ? '1' : '0');
  set('ft.theme.light', lightTheme.value);
  set('ft.theme.dark', darkTheme.value);
}

/** Pick a theme for this device at once (this turns "follow my phone" off). */
export function chooseTheme(id: string) {
  if (!themeById(id)) return;
  deviceTheme.value = id;
  followPhone.value = false;
  save();
  apply();
}
export function setFollowPhone(on: boolean) {
  followPhone.value = on;
  save();
  apply();
}
export function setFollowThemes(light: string | null, dark: string | null) {
  if (light) lightTheme.value = kindOf(light, 'light', DEFAULT_LIGHT);
  if (dark) darkTheme.value = kindOf(dark, 'dark', DEFAULT_DARK);
  save();
  apply();
}
export function setEink(on: boolean) {
  eink.value = on;
  save();
  apply();
}

query?.addEventListener?.('change', () => followPhone.value && apply());
mode.subscribe(() => {
  const v = get(profileKey(mode.value));
  profileTheme.value = v && themeById(v) ? v : null;
  apply();
});

if (typeof document !== 'undefined') {
  save();
  for (const t of COLOUR_THEMES) set(cached(t.id), themeCss(t));
  apply();
}
