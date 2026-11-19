// The in-app Back button's history: the pages you came from, newest last, kept per mode in
// localStorage so it survives a reload. A page you opened and then deleted is skipped.
// The phone's own back button is not touched: it works on the browser's history as before
// (dialogs and the full-screen editor close first). Back here replaces the current page
// (no new browser history entry), so the two do not pile up.

import { get, HttpError, mode } from '../../core/api';
import { signal } from '../../core/signal';
import { route } from '../../core/ui';

const MAX = 30;
const key = () => `ft.nav.${mode.value}`;

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key()) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.startsWith('/')).slice(-MAX) : [];
  } catch {
    return [];
  }
}
function save(s: string[]) {
  try {
    localStorage.setItem(key(), JSON.stringify(s));
  } catch {
    /* private mode or blocked storage: the history lasts until the page closes */
  }
}

/** The pages to go back to, newest last. */
export const stack = signal<string[]>(load());
function set(s: string[]) {
  stack.value = s;
  save(s);
}

/** Routes that point at one row: `/p/<id>` is a project and so on. A 404 for the row means the page is gone. */
const ROW_KINDS: Record<string, string> = { p: 'projects', n: 'lists', w: 'whiteboards' };
async function exists(path: string): Promise<boolean> {
  const [, head, id] = path.split('/');
  const kind = ROW_KINDS[head];
  if (!kind || !id) return true;
  try {
    await get(`/${kind}/${id}`);
    return true;
  } catch (e) {
    return !(e instanceof HttpError && e.status === 404);
  }
}

/** Drop pages from the top that no longer exist, so the button only shows when there is somewhere to go. */
let pruning = false;
async function prune() {
  if (pruning) return;
  pruning = true;
  try {
    for (let guard = 0; guard < MAX; guard++) {
      const top = stack.value[stack.value.length - 1];
      if (top === undefined) break;
      if (top === route.value || !(await exists(top))) set(stack.value.slice(0, -1));
      else break;
    }
  } finally {
    pruning = false;
  }
}

let prev = route.value;
let going: string | null = null; // the page Back is taking us to (not a new step in the history)

route.subscribe((r) => {
  const from = prev;
  prev = r;
  if (going !== null) {
    if (r === going) going = null;
    return;
  }
  if (r === from) return;
  const s = stack.value;
  // Back by another way (the phone's back button, a "← Projects" link): the page is the one we came from.
  if (s[s.length - 1] === r) set(s.slice(0, -1));
  else if (from && s[s.length - 1] !== from) set([...s, from].slice(-MAX));
  void prune();
});

// Each mode has its own history.
mode.subscribe(() => {
  stack.value = load();
  void prune();
});
void prune();

/** Go to the page before this one, skipping pages that were deleted. */
export async function goBack(): Promise<void> {
  for (let guard = 0; guard < MAX; guard++) {
    const s = stack.value;
    const target = s[s.length - 1];
    if (target === undefined) return;
    set(s.slice(0, -1));
    if (target === route.value || !(await exists(target))) continue;
    going = target;
    location.replace(`#${target}`);
    return;
  }
}
