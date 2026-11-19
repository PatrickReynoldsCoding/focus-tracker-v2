// The Insights page: four sub-tabs. Loaded on demand (index.tsx), so the charts stay out of the main bundle.
import { ChartDefs } from './charts';
import { HabitsTab } from './HabitsTab';
import { LogsTab } from './LogsTab';
import { usePref } from './prefs';
import { ProjectsTab } from './ProjectsTab';
import { Week } from './Week';
import './insights.css';

const SUBS = [
  ['week', 'Week'],
  ['habits', 'Habits'],
  ['projects', 'Projects'],
  ['logs', 'Logs'],
] as const;
type Sub = (typeof SUBS)[number][0];

export function Insights({ open }: { open?: Sub }) {
  const [saved, setSub] = usePref<Sub>('sub', SUBS.map((s) => s[0]), 'week');
  const sub = open ?? saved;
  return (
    <div class="stack insights">
      <ChartDefs />
      <div class="page-head">
        <h1>Insights</h1>
      </div>
      <div class="subtabs" role="tablist" aria-label="Insights">
        {SUBS.map(([id, label]) => (
          <button key={id} role="tab" id={`ins-tab-${id}`} aria-selected={sub === id} aria-controls="ins-panel" class={sub === id ? 'on' : ''} onClick={() => setSub(id)}>
            {label}
          </button>
        ))}
      </div>
      <div id="ins-panel" role="tabpanel" aria-labelledby={`ins-tab-${sub}`} key={sub}>
        {sub === 'week' && <Week />}
        {sub === 'habits' && <HabitsTab />}
        {sub === 'projects' && <ProjectsTab />}
        {sub === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}
