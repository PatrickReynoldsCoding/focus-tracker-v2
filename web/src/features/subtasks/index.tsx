// Subtasks (D57, flag `subtasks`): a checklist on a card or to-do. Server: src/modules/subtasks.ts.
import { registerPanel } from '../../core/registry';
import { CardSubtasks, SubtasksSection } from './Subtasks';
import { SubtasksSettings } from './Settings';
import './subtasks.css';

registerPanel('card-extra', { id: 'subtasks', order: 10, feature: 'subtasks', render: ({ card, b, view }: { card: any; b: any; view: 'board' | 'list' }) => <CardSubtasks card={card} b={b} view={view} /> });
registerPanel('card', { id: 'subtasks', order: 12, feature: 'subtasks', render: ({ card, update }) => <SubtasksSection card={card} update={update} /> });
registerPanel('settings', { id: 'subtasks', order: 17, scope: 'profile', feature: 'subtasks', render: () => <SubtasksSettings /> });
