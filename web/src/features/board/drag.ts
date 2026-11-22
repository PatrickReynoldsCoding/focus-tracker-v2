// Dragging cards between columns (Board view) or groups (List view), and within one. A mouse drags
// at once; a finger presses and holds a moment first (as the project board always did), so a
// swipe still scrolls. The card lists carry `.ub-drag`, which the phone's long press to arrange
// panels leaves alone (features/layout/stack.tsx).

import Sortable from 'sortablejs';
import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

let lastDrop = 0;
/** True just after a drag ended, so the click a finger's drop can make is not taken as a tap. */
export const justDragged = () => Date.now() - lastDrop < 400;

/** `filter`: what never starts a drag (a tick; in a panel also its checkboxes and buttons). */
export function useCardDrag(list: RefObject<HTMLElement | null>, group: string, onDrop: (cardId: string, toCol: string, index: number) => void, on = true, filter = '.ub-tick') {
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => {
    if (!on || !list.current) return;
    const s = Sortable.create(list.current, {
      group,
      animation: 150,
      delay: 220,
      delayOnTouchOnly: true,
      ghostClass: 'drag-ghost',
      dataIdAttr: 'data-id',
      // A tick is a tap, never the start of a drag.
      filter,
      preventOnFilter: false,
      // An empty group, or the folded Done, takes a card dropped near it.
      emptyInsertThreshold: 28,
      onEnd: (evt) => {
        lastDrop = Date.now();
        const cardId = evt.item.dataset.id!;
        const toCol = (evt.to as HTMLElement).dataset.col!;
        const index = evt.newIndex ?? 0;
        // Put the DOM back; Preact draws the new order from state.
        evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex ?? 0] ?? null);
        if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
        drop.current(cardId, toCol, index);
      },
    });
    return () => s.destroy();
  }, [on, group, filter]);
}
