// Plan my week (flag plan-week): the page at #/plan (this week) and #/plan/next, and a small view of the
// week on Today and at the top of the Habits tab that opens it.
import { registerPanel, registerRoute } from '../../core/registry';
import { PlanWeek } from './PlanWeek';
import { WeekStrip } from './WeekStrip';

const FLAG = 'plan-week';

registerRoute({ id: 'plan', prefix: '/plan', tab: 'today', feature: FLAG, render: ({ params }) => <PlanWeek key={params[0] ?? 'this'} which={params[0] === 'next' ? 'next' : 'this'} /> });
registerPanel('today', { id: 'plan-week', title: 'This week', order: 35, feature: FLAG, render: () => <WeekStrip title="This week" /> });
registerPanel('habits', { id: 'plan-week', order: 10, feature: FLAG, render: () => <WeekStrip title="This week" /> });
