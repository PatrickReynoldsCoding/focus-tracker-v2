// Sticky notes on project pages (V1-GAPS 38), flag 'stickies'. A project panel that draws a layer
// over the whole project page (the page is the notes' frame: x is a percentage of its width).
import { registerPanel } from '../../core/registry';
import { StickyLayer } from './Stickies';
import './stickies.css';

registerPanel('project', { id: 'stickies', order: 0, feature: 'stickies', render: ({ project }) => <StickyLayer key={project.id} projectId={project.id} /> });
