import { useState } from 'preact/hooks';
import { change, patch, post } from '../../core/api';
import { Dialog, useData } from '../../core/ui';
import { formatLevel, formatSize, stepsToGoal, suggestStart, type Level } from '../../../../src/core/habit-levels';
import type { Habit } from './types';

type Category = { id: string; label: string };

/** The numbers behind a level, as text boxes. */
type Draft = { sessions: string; size: string };

const toLevel = (d: Draft, per: 'day' | 'week', unit: string): Level => ({
  sessions: d.sessions === '' ? null : Math.max(1, Math.round(Number(d.sessions))),
  per,
  size: d.size === '' || !(Number(d.size) > 0) ? null : Number(d.size),
  unit: unit.trim() || null,
});

const PACES = [1, 2, 3, 4];

/**
 * Three steps: (1) name, why, category; (2) goal, then a start level lower than the goal, size and a small version;
 * (3) how often to be asked about stepping up, with the steps drawn. `habit` is an aspiring habit being started.
 */
export function NewHabitDialog({ habit, onClose }: { habit?: Habit | null; onClose: () => void }) {
  const { data: cats } = useData<Category[]>('/categories');
  const { data: projects } = useData<{ id: string; name: string; status: string }[]>('/projects');
  const [project, setProject] = useState(habit?.project_id ?? '');
  const [step, setStep] = useState(1);
  const [name, setName] = useState(habit?.name ?? '');
  const [why, setWhy] = useState(habit?.intention ?? habit?.description ?? '');
  const [category, setCategory] = useState(habit?.category_id ?? '');
  const [per, setPer] = useState<'day' | 'week'>('week');
  const [unit, setUnit] = useState('min');
  const [goal, setGoal] = useState<Draft>({ sessions: '3', size: '30' });
  const [start, setStart] = useState<Draft | null>(null);
  const [small, setSmall] = useState('');
  const [every, setEvery] = useState(2);
  const [prompts, setPrompts] = useState(true);

  const goalLevel = toLevel(goal, per, unit);
  // Until the owner types a start level, it follows the goal (a third of the sessions, half the size).
  const suggestion = suggestStart(goalLevel);
  const startDraft: Draft = start ?? { sessions: suggestion.sessions == null ? '' : String(suggestion.sessions), size: suggestion.size == null ? '' : String(suggestion.size) };
  const startLevel = toLevel(startDraft, per, unit);
  const path = startLevel.sessions != null && goalLevel.sessions != null ? stepsToGoal(startLevel, goalLevel) : [startLevel];
  const startAboveGoal = (startLevel.sessions ?? 0) > (goalLevel.sessions ?? Infinity) || (startLevel.size ?? 0) > (goalLevel.size ?? Infinity);

  const finish = () => {
    const fields = {
      name: name.trim(),
      intention: why.trim() || null,
      category_id: category || null,
      project_id: project || null,
      sessions: startLevel.sessions,
      per,
      size: formatSize(startLevel.size, startLevel.unit) || null,
      goal: formatLevel(goalLevel) || null,
      small_version: small.trim() || null,
      step_up_every: `${every} ${every === 1 ? 'week' : 'weeks'}`,
      prompts: prompts ? 'on' : 'off',
      status: 'active',
    };
    onClose();
    change(() => (habit?.id ? patch(`/habits/${habit.id}`, fields) : post('/habits', fields)), habit?.id ? 'Habit started' : 'Habit added');
  };

  return (
    <Dialog title={habit?.id ? `Start: ${habit.name}` : 'New habit'} onClose={onClose}>
      <p class="muted small" aria-live="polite">
        Step {step} of 3
      </p>
      {step === 1 && (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) setStep(2);
          }}
        >
          <label>
            What is the habit?
            <input required value={name} placeholder="Job hunting, stretching, a walk…" onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus />
          </label>
          <label>
            Why? (your intention)
            <input value={why} placeholder="So I can climb stairs without puffing" onInput={(e) => setWhy((e.target as HTMLInputElement).value)} />
          </label>
          <label>
            Category (optional)
            <select value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>
              <option value="">None</option>
              {(cats ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project (optional)
            <select value={project} onChange={(e) => setProject((e.target as HTMLSelectElement).value)}>
              <option value="">None</option>
              {(projects ?? [])
                .filter((p) => p.status === 'active')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <div class="row">
            <button class="primary" disabled={!name.trim()}>
              Next
            </button>
          </div>
        </form>
      )}
      {step === 2 && (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(3);
          }}
        >
          <fieldset class="group">
            <legend>Where do you want to get to?</legend>
            <div class="row">
              <label>
                Sessions
                <input type="number" min={1} value={goal.sessions} onInput={(e) => setGoal({ ...goal, sessions: (e.target as HTMLInputElement).value })} />
              </label>
              <label>
                a
                <select value={per} onChange={(e) => setPer((e.target as HTMLSelectElement).value as 'day' | 'week')}>
                  <option value="day">day</option>
                  <option value="week">week</option>
                </select>
              </label>
            </div>
            <div class="row">
              <label>
                Size of one session
                <input type="number" min={0} value={goal.size} placeholder="optional" onInput={(e) => setGoal({ ...goal, size: (e.target as HTMLInputElement).value })} />
              </label>
              <label>
                Unit
                <input value={unit} placeholder="min, km, pages" onInput={(e) => setUnit((e.target as HTMLInputElement).value)} />
              </label>
            </div>
          </fieldset>
          <fieldset class="group">
            <legend>Start lower than you think</legend>
            <p class="muted small">You can always add more. A third of the sessions and half the size is a good start.</p>
            <div class="row">
              <label>
                Sessions
                <input type="number" min={1} value={startDraft.sessions} onInput={(e) => setStart({ ...startDraft, sessions: (e.target as HTMLInputElement).value })} />
              </label>
              <label>
                Size ({unit || 'units'})
                <input type="number" min={0} value={startDraft.size} onInput={(e) => setStart({ ...startDraft, size: (e.target as HTMLInputElement).value })} />
              </label>
            </div>
            <div class="row">
              <button type="button" class="small" onClick={() => setStart(null)}>
                Suggest: {formatLevel(suggestion) || '—'}
              </button>
            </div>
            {startAboveGoal && <p class="error small">The start is above the goal. Check the numbers.</p>}
          </fieldset>
          <label>
            Small version for bad days (counts as a session)
            <input value={small} placeholder="5 minutes, or just put the trainers on" onInput={(e) => setSmall((e.target as HTMLInputElement).value)} />
          </label>
          <div class="row spread">
            <button type="button" onClick={() => setStep(1)}>
              Back
            </button>
            <button class="primary" disabled={startLevel.sessions == null || startAboveGoal}>
              Next
            </button>
          </div>
        </form>
      )}
      {step === 3 && (
        <div class="stack">
          <label class="inline">
            <input type="checkbox" checked={prompts} onChange={(e) => setPrompts((e.target as HTMLInputElement).checked)} />
            Ask me when it is time to step up
          </label>
          <label>
            How often to consider it
            <select value={every} disabled={!prompts} onChange={(e) => setEvery(Number((e.target as HTMLSelectElement).value))}>
              {PACES.map((n) => (
                <option key={n} value={n}>
                  Every {n} {n === 1 ? 'week' : 'weeks'}
                  {n === 2 ? ' (suggested)' : ''}
                </option>
              ))}
            </select>
          </label>
          <p class="muted small">I only ask when you have done about 80 % of the sessions, one small step at a time. Give a habit about two months before judging it.</p>
          <div>
            <h3>The steps</h3>
            <ol class="steps" aria-label="Steps from the start to the goal">
              {path.map((l, i) => (
                <li key={i}>
                  <span class={`step ${i === 0 ? 'first' : i === path.length - 1 ? 'last' : ''}`}>{formatLevel(l)}</span>
                </li>
              ))}
            </ol>
            <p class="muted small">
              {path.length > 1 ? `${path.length - 1} ${path.length === 2 ? 'step' : 'steps'}, ${prompts ? `about ${(path.length - 1) * every} weeks if every prompt is met.` : 'when you choose to.'}` : 'You start at your goal.'}
            </p>
          </div>
          <div class="row spread">
            <button type="button" onClick={() => setStep(2)}>
              Back
            </button>
            <button class="primary" onClick={finish}>
              {habit?.id ? 'Start habit' : 'Add habit'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
