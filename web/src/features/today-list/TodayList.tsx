// The Today list (D30): everything for today in one slim checklist, as v1's "To do today" (mockup A,
// v1 docs/mockups/today-list-phone.html). Habits first, then to-dos and cards for today or left
// from an earlier day. A tick takes the line off at once; what was done folds into one line at the
// bottom, and "Show" opens it to take something back. The rules are shared with the server
// (src/core/today-list.ts); the data is Today's (GET /api/today), so every change here is the
// same optimistic change the other Today panels make, and waits offline like them.

import { useEffect, useState } from 'preact/hooks';
import { newId, optimistic, post } from '../../core/api';
import { ProjectLabel, type TodayPanelProps } from '../../core/registry';
import { useFlag } from '../../core/features';
import { AddInput, fmtDay, go, Linkify, useData } from '../../core/ui';
import { buildTodayList, type TodayItem, type TodayList as List } from '../../../../src/core/today-list';
import { record, type SetHabits } from '../habits/actions';
import { HabitCards } from '../habits/HabitRow';
import { HabitGroups } from '../habits/Groups';
import { NotesMark } from '../habits/HabitName';
import { openHabit } from '../habits/open';
import { HabitsPopup } from '../habits/Popup';
import type { Progress } from '../habits/types';
import { CardDialog, type Card, type Column } from '../board';

type Todo = { id: string; title: string; day: string | null; done: string | null; list_id?: string | null; project_id?: string | null };
type CardIn = { id: string; title: string; day: string | null; done: string | null; project_id: string | null; list_id: string | null; from: string | null; in_last: boolean };
export type TodayData = { subtasks?: Record<string, [number, number]>; day: string; todos: Todo[]; habits: Progress[]; cards?: CardIn[]; todo_lists?: Record<string, string>; todo_list_projects?: Record<string, string> };

/** The list for this Today data (also used for the pill's count). */
export function listOf(d: TodayData): List {
  const names = d.todo_lists ?? {};
  const projects = d.todo_list_projects ?? {};
  const list = buildTodayList(d.day, {
    habits: d.habits,
    // A to-do is from a project when it says so, or when its list belongs to one.
    todos: d.todos.map((t) => ({ ...t, list_name: (t.list_id && names[t.list_id]) || null, project_id: t.project_id || (t.list_id && projects[t.list_id]) || null })),
    cards: d.cards ?? [],
  });
  // Subtasks follow their to-do or card here as a count (D57).
  const subs = d.subtasks ?? {};
  return { ...list, items: list.items.map((x) => (subs[x.id] && x.kind !== 'habit' ? { ...x, subtasks: subs[x.id] } : x)) };
}

/** "3 left", ✓ when all is done, nothing when there is nothing today. */
export const countOf = (d: TodayData) => {
  const l = listOf(d);
  return l.left ? `${l.left} left` : l.items.length ? '✓' : null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function TodayList({ today, setToday }: { today: TodayData; setToday: TodayPanelProps['setToday'] }) {
  const [showDone, setShowDone] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const list = listOf(today);
  const open = list.items.filter((x) => x.state === 'open');
  const done = list.items.filter((x) => x.state !== 'open');
  const habits = new Map(today.habits.map((h) => [h.id, h]));
  const setHabits: SetHabits = (fn) => setToday((d: TodayData) => ({ ...d, habits: fn(d.habits) }));
  const setTodos = (fn: (l: Todo[]) => Todo[]) => setToday((d: TodayData) => ({ ...d, todos: fn(d.todos) }));
  const setCards = (fn: (l: CardIn[]) => CardIn[]) => setToday((d: TodayData) => ({ ...d, cards: fn(d.cards ?? []) }));
  useEffect(() => {
    if (!done.length) setShowDone(false);
  }, [done.length]);

  // ---------- changes (each shows at once, is sent behind, and can wait offline) ----------
  const habitSession = (x: TodayItem, add: 1 | -1) => {
    const h = habits.get(x.id);
    if (h) record(setHabits, h, h.day, add);
  };
  const notToday = (x: TodayItem, on: boolean) => {
    const h = habits.get(x.id);
    if (!h) return;
    optimistic(
      () => {
        setHabits((l) => l.map((y) => (y.id === h.id ? { ...y, skipped_today: on, left: on || y.target == null ? 0 : Math.max(0, y.target - y.done_this_period) } : y)));
        return () => setHabits((l) => l.map((y) => (y.id === h.id ? h : y)));
      },
      () => post(`/habits/${h.id}/not-today`, { on }),
    );
  };
  const tickTodo = (x: TodayItem, on: boolean) => {
    const before = today.todos.find((t) => t.id === x.id);
    if (!before) return;
    optimistic(
      () => {
        setTodos((l) => l.map((t) => (t.id === x.id ? { ...t, done: on ? today.day : null } : t)));
        return () => setTodos((l) => l.map((t) => (t.id === x.id ? before : t)));
      },
      () => post(`/todos/${x.id}/tick`, { done: on }),
    );
  };
  const tickCard = (x: TodayItem, on: boolean) => {
    const before = today.cards?.find((c) => c.id === x.id);
    if (!before) return;
    optimistic(
      () => {
        setCards((l) => l.map((c) => (c.id === x.id ? { ...c, done: on ? today.day : null, in_last: false } : c)));
        return () => setCards((l) => l.map((c) => (c.id === x.id ? before : c)));
      },
      () => post(`/tasks/${x.id}/tick`, { done: on }),
    );
  };
  const tick = (x: TodayItem) => (x.kind === 'habit' ? habitSession(x, 1) : x.kind === 'todo' ? tickTodo(x, true) : tickCard(x, true));
  const takeBack = (x: TodayItem) => {
    if (x.kind === 'habit') return x.state === 'skipped' ? notToday(x, false) : habitSession(x, -1);
    return x.kind === 'todo' ? tickTodo(x, false) : tickCard(x, false);
  };
  const add = (title: string) => {
    const id = newId();
    optimistic(
      () => {
        setTodos((l) => [...l, { id, title, day: today.day, done: null }]);
        return () => setTodos((l) => l.filter((t) => t.id !== id));
      },
      () => post('/todos', { id, title, day: today.day }),
    );
  };
  const openItem = (x: TodayItem) => {
    if (x.kind === 'card') return setCard(x.id);
    if (x.kind === 'habit') return openHabit(x.id);
    go(x.list_id ? `/n/${x.list_id}` : '/notes');
  };

  // ---------- drawing ----------
  const notesOf = (x: TodayItem) => (x.kind === 'habit' ? habits.get(x.id)?.notes : null);
  const prompts = today.habits.filter((h) => h.pending?.due || h.step_up || h.ask_stop);
  const openHabits = open.filter((x) => x.kind === 'habit');
  const openThings = open.filter((x) => x.kind !== 'habit');
  const doneWord = plural(done.length, 'thing', 'things');
  const toggle = done.length > 0 && (
    <button class="link small tl-show" aria-expanded={showDone} aria-controls="tl-done" onClick={() => setShowDone(!showDone)}>
      {showDone ? 'Hide' : 'Show'}
    </button>
  );
  return (
    <section class="card today-list" aria-label="Today">
      <div class="card-head">
        <h2>Today</h2>
        <span class="muted small tl-left" aria-live="polite">
          {open.length ? `${open.length} left` : done.length ? '✓' : ''}
        </span>
      </div>
      {prompts.map((h) => (
        <HabitCards key={h.id} h={h} set={setHabits} />
      ))}
      {openHabits.length > 0 && <Section label="Habits" items={openHabits} tick={tick} notToday={notToday} open={openItem} notesOf={notesOf} />}
      {openThings.length > 0 && <Section label="To-dos" items={openThings} tick={tick} notToday={notToday} open={openItem} notesOf={notesOf} />}
      {!list.items.length && <p class="muted small tl-empty">Nothing for today yet. Add a to-do here, or give a card a day.</p>}
      {done.length > 0 &&
        (open.length ? (
          <div class="tl-foot">
            <span>✓ {done.length} done</span>
            {toggle}
          </div>
        ) : (
          <div class="tl-foot tl-all">
            <span>
              <strong>✓ All done for today.</strong> {doneWord}.
            </span>
            {toggle}
          </div>
        ))}
      {showDone && done.length > 0 && (
        <ul class="tl-rows tl-done" id="tl-done" aria-label="Done today">
          {done.map((x) => (
            <li key={x.key} class="tl-row done">
              <span class={`tl-tick on ${x.kind === 'habit' ? '' : 'sq'}`} aria-hidden="true">
                {x.state === 'skipped' ? '–' : '✓'}
              </span>
              <Name x={x} open={openItem} notes={notesOf(x)} />
              <span class="tl-meta">{x.state === 'skipped' ? 'not today' : x.progress ?? ''}</span>
              <button class="link small tl-act" aria-label={`${x.state === 'skipped' ? 'Back on today’s list' : 'Not done'}: ${x.title}`} onClick={() => takeBack(x)}>
                {x.state === 'skipped' ? 'Back' : 'Undo'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <AddInput placeholder="Add a to-do for today" onAdd={add} />
      {card && <OpenCard id={card} onClose={() => setCard(null)} />}
    </section>
  );
}

function Section({ label, items, tick, notToday, open, notesOf }: { label: string; items: TodayItem[]; tick: (x: TodayItem) => void; notToday: (x: TodayItem, on: boolean) => void; open: (x: TodayItem) => void; notesOf: (x: TodayItem) => string | null | undefined }) {
  // With project labels a card's project shows as its label, not as plain text too.
  const labels = useFlag('project-labels');
  const habitsOn = useFlag('habits');
  const [popup, setPopup] = useState(false);
  const list = (rows: TodayItem[]) => (
    <ul class="tl-rows">
      {rows.map((x) => (
        <li key={x.key} class="tl-row">
          <button class={`tl-tick ${x.kind === 'habit' ? '' : 'sq'}`} aria-label={x.kind === 'habit' ? `Done a session of ${x.title}` : `Done: ${x.title}`} onClick={() => tick(x)} />
          <Name x={x} open={open} notes={notesOf(x)} />
          <span class="tl-meta">
            {x.planned && <span class="tag">planned</span>}
            {x.late && (
              <span class="tag late c-red" title={`For ${fmtDay(x.late)}`}>
                {fmtDay(x.late)}
              </span>
            )}
            {x.project_id && <ProjectLabel projectId={x.project_id} />}
            {x.from && !(labels && x.kind === 'card' && x.project_id) && (
              <span class="tl-from" title={x.from}>
                {x.from}
              </span>
            )}
            {x.progress}
            {x.subtasks && <span class="tag" title="Subtasks done">☑ {x.subtasks[0]}/{x.subtasks[1]}</span>}
          </span>
          {x.can_skip && (
            <button class="link small tl-act" aria-label={`Not today: ${x.title}`} onClick={() => notToday(x, true)}>
              Not today
            </button>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <div class="tl-sec">
      {label === 'Habits' && habitsOn ? (
        <>
          <button class="tl-label tl-label-btn" aria-haspopup="dialog" title="Open the Habits page" onClick={() => setPopup(true)}>
            {label} <span aria-hidden="true">↗</span>
          </button>
          {popup && <HabitsPopup onClose={() => setPopup(false)} />}
        </>
      ) : (
        <div class="tl-label">{label}</div>
      )}
      {label === 'Habits' ? (
        <HabitGroups place="today-list" items={items} habitId={(x) => x.id} summary={(group) => `${group.length} left`}>
          {list}
        </HabitGroups>
      ) : (
        list(items)
      )}
    </div>
  );
}

/** The item's name: a tap opens it (its list, its card, a habit's notes and settings, D56); links in it still work. */
function Name({ x, open, notes }: { x: TodayItem; open: (x: TodayItem) => void; notes?: string | null }) {
  const where = x.kind === 'card' ? 'Open the card' : x.kind === 'habit' ? 'Open its notes and settings' : 'Open its list';
  return (
    <span
      class="tl-name"
      role="button"
      tabIndex={0}
      title={where}
      aria-label={`${x.title}. ${where}`}
      onClick={(e) => !(e.target as Element).closest('a') && open(x)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(x))}
    >
      <span class="tl-title">
        <Linkify text={x.title} />
      </span>
      {x.size && <small> · {x.size}</small>}
      {x.kind === 'habit' && <NotesMark notes={notes} />}
    </span>
  );
}

/** A card opened from the list: its own card dialog, over Today. */
function OpenCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: card, error, setData } = useData<Card & { project_id: string | null; list_id: string | null }>(`/tasks/${id}`);
  const owner = card ? (card.project_id ? `project_id=${card.project_id}` : `list_id=${card.list_id}`) : null;
  const { data: columns } = useData<Column[]>(owner ? `/columns?${owner}` : null);
  useEffect(() => {
    if (error) onClose();
  }, [error]);
  if (!card || !columns) return null;
  return <CardDialog card={card} columns={columns} onClose={onClose} onChange={(p) => (p === null ? onClose() : setData((c) => ({ ...c, ...p })))} />;
}
