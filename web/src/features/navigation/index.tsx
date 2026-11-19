// Moving around: the Back button in the header (history.ts) and swiping between tabs on a
// phone (swipe.tsx, flag `swipe-tabs`).

import { registerHeaderItem, registerOverlay } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { goBack, stack } from './history';
import { SwipeTabs } from './swipe';
import './navigation.css';

function BackButton() {
  const s = useSignal(stack);
  if (!s.length) return null;
  return (
    <button class="ghost back-btn" aria-label="Back" title="Back to the page before" onClick={() => void goBack()}>
      ←<span class="lbl"> Back</span>
    </button>
  );
}

registerHeaderItem({ id: 'back', order: 10, render: () => <BackButton /> });
registerOverlay({ id: 'swipe-tabs', order: 90, render: ({ route }) => <SwipeTabs route={route} /> });
