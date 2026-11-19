// Choose or swap today's focus: projects ranked like Today's suggestions
// (today's rotation category first, least recently touched first, locked ones
// or blocked ones left out), and when swapping, an optional reminder about the skipped project.

import { useState } from 'preact/hooks';
import { change, put } from '../../core/api';
import { daysAgo, Dialog, Loading, useData } from '../../core/ui';
import { useBlocked } from '../links/shared';

type Candidate = { id: string; name: string; last_touched: string | null; in_rotation: boolean };

const REMIND: [number | null, string][] = [
  [1, 'Tomorrow'],
  [3, 'In 3 days'],
  [7, 'Next week'],
  [null, 'No reminder'],
];

export function SwapDialog({ current, day, onClose }: { current: { id: string; name: string } | null; day: string; onClose: () => void }) {
  const { data, error } = useData<{ projects: Candidate[] }>('/focus/candidates');
  const [remind, setRemind] = useState<number | null>(1);
  const blocked = useBlocked(); // issue links: a blocked project is not offered (the server leaves them out too)
  const list = blocked ? data?.projects.filter((p) => p.id !== current?.id && !blocked.projects?.[p.id]) : undefined;
  return (
    <Dialog title={current ? 'Swap focus' : 'Choose today’s focus'} onClose={onClose}>
      {current && (
        <fieldset class="remind">
          <legend class="small muted">Remind me about {current.name}</legend>
          <div class="chips" role="radiogroup">
            {REMIND.map(([d, label]) => (
              <button key={label} type="button" role="radio" aria-checked={remind === d} class={`chip ${remind === d ? 'on' : ''}`} onClick={() => setRemind(d)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {!list ? (
        <Loading error={error} />
      ) : list.length ? (
        <ul class="pick">
          {list.map((p) => (
            <li key={p.id}>
              <button
                onClick={async () => {
                  onClose();
                  await change(() => put('/focus', current ? { project_id: p.id, remind_in_days: remind } : { project_id: p.id }), `Focus: ${p.name}`);
                }}
              >
                <strong>{p.name}</strong>
                <span class="muted small">
                  {p.in_rotation && <span class="tag">today’s rotation</span>} touched {daysAgo(p.last_touched, day)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No other active projects. Locked ones are left out.</p>
      )}
    </Dialog>
  );
}
