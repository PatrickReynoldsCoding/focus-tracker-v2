// Where the app opens (per device, Settings → "When the app opens"):
//  - 'today' (default): Today, or the focus project's page while a session runs;
//  - 'last': the page I was on.
// Only an opening at Today (no address, or #/today, as the Android app and the
// installed app do) is redirected; a link to a page opens that page.

import { route } from '../../core/ui';
import { state } from './session';

export type OpenOn = 'today' | 'last';

function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function write(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export const openOn = (): OpenOn => (read('ft.openOn') === 'last' ? 'last' : 'today');
export const setOpenOn = (v: OpenOn) => write('ft.openOn', v);

const first = location.hash.slice(1);
const atToday = !first || first === '/today';

if (atToday && openOn() === 'last') {
  const last = read('ft.lastRoute');
  if (last && last.startsWith('/') && last !== '/today') location.hash = last;
}
route.subscribe((r) => write('ft.lastRoute', r));

// During a session, open on the focus project's page, unless you already moved.
if (atToday && openOn() === 'today') {
  const stop = state.subscribe((s) => {
    if (!s.data) return;
    stop();
    const id = s.data.session?.project_id;
    if (id && (route.value === '/today' || route.value === '')) location.hash = `/p/${id}`;
  });
}
