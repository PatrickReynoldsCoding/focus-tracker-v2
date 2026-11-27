// The Today tab's red count (as in v1): what is left on the Today list (habits, to-dos and cards
// for today or from earlier) plus reminders due now. It shows from every tab, also with the side
// bar collapsed. With the Today list off (flag today-panel) only the reminders count.

import { get, mode, signedIn, version } from '../../core/api';
import { flags } from '../../core/features';
import { tabBadges } from '../../core/registry';
import { signal } from '../../core/signal';
import { dueReminders } from '../today-panels/banners';
import { listOf, type TodayData } from './TodayList';
/** The Today list's flag (features/today-list/index.tsx; not imported, as that file starts this one). */
const FLAG = 'today-panel';

const left = signal(0);
let started = false;

async function refresh() {
  if (signedIn.value !== true || !flags.value[FLAG]) return void (left.value = 0);
  try {
    left.value = listOf(await get<TodayData>('/today')).left;
  } catch {
    /* offline or signed out: keep the count shown */
  }
}

const show = () => (tabBadges.value = { ...tabBadges.value, today: left.value + dueReminders.value });

/** Count now, again when a change lands, the profile or flags change, the app comes back and every minute. */
export function startTodayBadge() {
  if (started) return;
  started = true;
  left.subscribe(show);
  dueReminders.subscribe(show);
  for (const s of [signedIn, version, mode, flags] as { subscribe: (f: () => void) => unknown }[]) s.subscribe(refresh);
  document.addEventListener('visibilitychange', () => !document.hidden && refresh());
  setInterval(refresh, 60_000);
  refresh();
}
