// The Desktop page (DECISIONS D64, flag `desktop-page`): #/desktop, a bare page of panels for a
// window that stays behind the others on a computer. See Desktop.tsx.
import { registerRoute } from '../../core/registry';
import { keepOnDesktop } from './app';
import { Desktop } from './Desktop';
import './desktop.css';

registerRoute({ id: 'desktop', prefix: '/desktop', tab: 'today', feature: 'desktop-page', bare: true, render: () => <Desktop /> });

// Inside the Focus Tracker Desktop app (clients/gnome/app) other pages open in the full app.
keepOnDesktop();
