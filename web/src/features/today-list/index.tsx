// The Today list (D30, flag `today-panel`): one "Today" panel with today's habits, to-dos and cards.
// It replaces "To do today" (a saved pill, grid place or window that names `todos` shows it) and
// covers "Habits" (left out of the usual Today pill, still there to add). Also here: a card's day
// (a section of the card dialog and a mark on its tile) and keeping Today fresh when the app
// comes back to the front.

import { useEffect } from 'preact/hooks';
import { version } from '../../core/api';
import { registerOverlay, registerPanel, type CardSectionProps, type CardTileProps } from '../../core/registry';
import { fmtDay, todayLocal } from '../../core/ui';
import { countOf, TodayList, type TodayData } from './TodayList';
import { isPlainItem } from '../board/CardDialog';
import { startTodayBadge } from './badge';
import './today-list.css';

startTodayBadge();

export const FLAG = 'today-panel';

registerPanel('today', {
  id: 'today-list',
  icon: '✓',
  title: 'Today',
  description: 'Everything for today in one list: habits, then to-dos and cards for today or left from earlier. Tick, add and open them.',
  order: 20,
  feature: FLAG,
  replaces: ['todos'],
  covers: ['habits'],
  count: ({ today }) => countOf(today as TodayData),
  render: ({ today, setToday }) => <TodayList today={today as TodayData} setToday={setToday} />,
});

// ---------- a card's day ----------

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function CardDay({ card, columns, save }: CardSectionProps) {
  const today = todayLocal();
  // A plain list's items have no day (D41): only a to-do's and a project's cards.
  if (isPlainItem(card, columns)) return null;
  const day: string | null = card.day ?? null;
  const set = (d: string | null) => save({ day: d, done: null });
  return (
    <div class="card-day">
      <label class="inline">
        In the Today list from
        <input type="date" value={day ?? ''} onChange={(e) => set((e.target as HTMLInputElement).value || null)} />
      </label>
      <div class="row">
        <button class={`small ${day === today ? 'primary' : ''}`} aria-pressed={day === today} onClick={() => set(today)}>
          Today
        </button>
        <button class={`small ${day === addDays(today, 1) ? 'primary' : ''}`} aria-pressed={day === addDays(today, 1)} onClick={() => set(addDays(today, 1))}>
          Tomorrow
        </button>
        {day && (
          <button class="ghost small" onClick={() => set(null)}>
            No day
          </button>
        )}
      </div>
      {day && card.done && <p class="muted small">Ticked off on {fmtDay(card.done)}.</p>}
    </div>
  );
}
registerPanel('card', { id: 'day', order: 25, feature: FLAG, render: (p) => <CardDay {...p} /> });

function DayMark({ card }: CardTileProps) {
  if (!card.day || card.done) return null;
  const today = todayLocal();
  const word = card.day === today ? 'Today' : card.day === addDays(today, 1) ? 'Tomorrow' : fmtDay(card.day);
  const late = card.day < today;
  return (
    <span class={`tag day-mark ${late ? 'late c-red' : ''}`} title={late ? `For ${fmtDay(card.day)}: still in the Today list` : `In the Today list from ${fmtDay(card.day)}`}>
      {word}
    </span>
  );
}
registerPanel('card-tile', { id: 'day', order: 20, feature: FLAG, render: ({ card }) => <DayMark card={card} /> });

// ---------- fresh when the app comes back ----------

/** Today reloads when the app comes back to the front after a minute or more, and every 5 minutes
 *  while it is on screen, so a change made elsewhere (the phone, Claude, the menu bar) shows. */
function KeepFresh({ route }: { route: string }) {
  const onToday = route === '/today' || route.startsWith('/today/') || route.startsWith('/today?');
  useEffect(() => {
    if (!onToday) return;
    let hiddenAt = 0;
    const vis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) version.value++;
    };
    const timer = window.setInterval(() => !document.hidden && version.value++, 5 * 60_000);
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      clearInterval(timer);
    };
  }, [onToday]);
  return null;
}
registerOverlay({ id: 'today-fresh', order: 90, feature: FLAG, render: ({ route }) => <KeepFresh route={route} /> });
