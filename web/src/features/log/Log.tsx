import { useState } from 'preact/hooks';
import { change, del, patch } from '../../core/api';
import './log.css';
import { Dialog, Linkify, Loading, fmtDay, fmtMinutes, useData } from '../../core/ui';

type Entry = { id: string; date: string; project_id: string | null; minutes: number | null; where_stopped: string | null };

function EditEntry({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [date, setDate] = useState(entry.date);
  const [where, setWhere] = useState(entry.where_stopped ?? '');
  const [minutes, setMinutes] = useState(entry.minutes == null ? '' : String(entry.minutes));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && (minutes === '' || /^\d+$/.test(minutes));
  return (
    <Dialog title="Edit log line" onClose={onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onClose();
          change(() => patch(`/log/${entry.id}`, { date, where_stopped: where, minutes: minutes === '' ? null : Number(minutes) }), 'Log line saved');
        }}
      >
        <label>
          Date
          <input type="date" value={date} required onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          Where you stopped
          <input value={where} onInput={(e) => setWhere((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          Minutes
          <input type="number" min="0" inputMode="numeric" value={minutes} onInput={(e) => setMinutes((e.target as HTMLInputElement).value)} />
        </label>
        <div class="row">
          <button class="primary" disabled={!valid}>
            Save
          </button>
          <button type="button" class="ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Log() {
  const { data, error } = useData<Entry[]>('/log?limit=200');
  const { data: projects } = useData<{ id: string; name: string }[]>('/projects?limit=2000');
  const [editing, setEditing] = useState<Entry | null>(null);
  if (!data) return <Loading error={error} />;
  const name = (id: string | null) => projects?.find((p) => p.id === id)?.name ?? '';
  const days = [...new Set(data.map((e) => e.date))];
  const week = data.filter((e) => Date.parse(e.date) > Date.now() - 7 * 86400000).reduce((n, e) => n + (e.minutes ?? 0), 0);
  return (
    <div class="stack">
      <div class="page-head">
        <h1>Log</h1>
        <p class="muted">Last 7 days: {fmtMinutes(week)}</p>
      </div>
      {days.map((d) => (
        <section class="card" key={d}>
          <h2>{fmtDay(d)}</h2>
          <ul class="plain log">
            {data
              .filter((e) => e.date === d)
              .map((e) => (
                <li key={e.id} class="log-line">
                  <div class="log-text">
                    <a href={e.project_id ? `#/p/${e.project_id}` : undefined}>{name(e.project_id) || 'No project'}</a>
                    {e.minutes ? <span class="muted"> · {fmtMinutes(e.minutes)}</span> : null}
                    {e.where_stopped && (
                      <div class="small">
                        Stopped: <Linkify text={e.where_stopped} />
                      </div>
                    )}
                  </div>
                  <span class="row tight">
                    <button class="icon small" aria-label="Edit log line" onClick={() => setEditing(e)}>
                      ✎
                    </button>
                    <button class="icon small" aria-label="Delete log line" onClick={() => change(() => del(`/log/${e.id}`), 'Log line deleted')}>
                      ✕
                    </button>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {!data.length && <p class="empty">No sessions logged yet.</p>}
      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

import { registerTab } from '../../core/registry';
registerTab({ id: 'log', path: '/log', label: 'Log', icon: '⏱', order: 50, render: () => <Log /> });
