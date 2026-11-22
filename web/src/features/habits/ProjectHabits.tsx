// The habits linked to a project, on its page: the same slim rows as Today's Habits panel (tap to check in).
import { registerPanel } from '../../core/registry';
import { Loading, useData } from '../../core/ui';
import { HabitLine } from './HabitRow';
import { HabitRows, useRestyle } from './HabitRows';
import type { Progress } from './types';
import './habits.css';

function ProjectHabits({ projectId }: { projectId: string }) {
  const restyle = useRestyle();
  const { data, setData } = useData<Progress[]>('/habits/progress');
  if (!data) return <Loading />;
  const mine = data.filter((h) => h.project_id === projectId);
  if (!mine.length) return null;
  const set = (fn: (l: Progress[]) => Progress[]) => setData((all) => fn(all));
  if (restyle)
    return (
      <section class="card habits-panel habits-slim">
        <div class="card-head">
          <h2>Habits</h2>
          <a href="#/habits" class="muted small">
            All
          </a>
        </div>
        <HabitRows habits={mine} set={set} />
      </section>
    );
  return (
    <section class="card habits-panel">
      <div class="card-head">
        <h2>Habits</h2>
        <a href="#/habits" class="muted">
          All
        </a>
      </div>
      <ul class="habit-list">
        {mine.map((h) => (
          <li key={h.id}>
            <HabitLine h={h} set={set} strip="toggle" />
          </li>
        ))}
      </ul>
    </section>
  );
}

registerPanel('project', {
  id: 'habits',
  feature: 'habits',
  icon: '◎',
  title: 'Habits',
  description: 'The habits linked to this project, with check-in.',
  order: 35,
  render: ({ project }) => <ProjectHabits projectId={project.id} />,
});
