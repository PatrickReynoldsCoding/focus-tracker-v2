// Sticky notes (V1-GAPS 38, D23, D62), flag 'stickies'. A project panel and a Today panel that draw
// a layer over the whole page (the page is the notes' frame: x is a percentage of its width). On
// Today the notes belong to the profile (no project). The "Sticky notes" panel is a small card
// with the same two buttons, for the Add panel list.
import { registerPanel } from '../../core/registry';
import { StickyLayer, STICKY_EVENT } from './Stickies';
import './stickies.css';

registerPanel('project', { id: 'stickies', title: 'Sticky notes', fixed: 'top', order: 0, feature: 'stickies', render: ({ project }) => <StickyLayer key={project.id} projectId={project.id} /> });
registerPanel('today', { id: 'stickies', title: 'Sticky notes', fixed: 'top', order: 0, feature: 'stickies', render: () => <StickyLayer projectId={null} /> });

const tell = (what: 'add' | 'toggle') => window.dispatchEvent(new CustomEvent(STICKY_EVENT, { detail: what }));
registerPanel('today', {
  id: 'sticky-notes',
  icon: '🗒',
  title: 'Sticky notes',
  description: 'Buttons for the free sticky notes that float over Today: add one, hide or show them.',
  order: 70,
  feature: 'stickies',
  render: () => (
    <section class="card sticky-card">
      <div class="card-head">
        <h2>Sticky notes</h2>
      </div>
      <p class="muted small">Notes float over this page. Drag one by its top strip, resize it from its corner.</p>
      <div class="row">
        <button onClick={() => tell('add')}>＋ Sticky</button>
        <button class="ghost" onClick={() => tell('toggle')}>
          Hide / show
        </button>
      </div>
    </section>
  ),
});
