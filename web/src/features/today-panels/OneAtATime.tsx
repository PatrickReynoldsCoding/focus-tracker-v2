// "One at a time": a random item of a list as a quote card in the list's colour, its note under
// it. Moves on every N seconds, shuffled so nothing repeats until all were shown; ‹ › to skip.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Markdown } from '../../core/ui';

export type QuoteItem = { id: string; title: string; note?: string | null };

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The order to show items in. Keeps the order already dealt when items come and go. */
export function deal(ids: string[], dealt: string[], current: string | undefined): string[] {
  const live = new Set(ids);
  const kept = dealt.filter((id) => live.has(id));
  const fresh = ids.filter((id) => !kept.includes(id));
  if (!fresh.length) return kept;
  // New items go after the one on screen, mixed with the ones not shown yet.
  const at = current ? kept.indexOf(current) + 1 : 0;
  const ahead = shuffle([...kept.slice(at), ...fresh]);
  return [...kept.slice(0, at), ...ahead];
}

export function OneAtATime({ name, color, seconds, items, href, onRemove }: { name: string; color?: string | null; seconds: number; items: QuoteItem[]; href: string; onRemove?: () => void }) {
  const ids = items.map((i) => i.id).join(',');
  const dealt = useRef<string[]>([]);
  const [pos, setPos] = useState(0);
  const [tick, setTick] = useState(0); // restarts the timer after a manual skip
  dealt.current = deal(
    items.map((i) => i.id),
    dealt.current.length ? dealt.current : shuffle(items.map((i) => i.id)),
    dealt.current[pos],
  );
  const order = dealt.current;
  const at = order.length ? Math.min(pos, order.length - 1) : 0;
  const go = (by: 1 | -1) => {
    if (order.length < 2) return;
    let next = at + by;
    if (next >= order.length) {
      // Dealt them all: shuffle again, but never start with the one just shown.
      const again = shuffle(order);
      if (again[0] === order[at]) again.push(again.shift()!);
      dealt.current = again;
      next = 0;
    } else if (next < 0) next = order.length - 1;
    setPos(next);
    setTick((n) => n + 1);
  };
  useEffect(() => {
    if (order.length < 2) return;
    const t = setInterval(() => go(1), Math.max(5, seconds) * 1000);
    return () => clearInterval(t);
  }, [seconds, tick, ids]);
  const item = items.find((i) => i.id === order[at]);
  return (
    <section class={`card tp-quote c-${color || 'none'}`}>
      <div class="card-head">
        <h2>
          <a href={href}>{name}</a>
        </h2>
        <span class="row tight">
          <span class="muted small">{order.length ? `${at + 1} of ${order.length}` : ''}</span>
          {onRemove && (
            <button class="icon small" aria-label={`Remove ${name} from Today`} title="Remove from Today" onClick={onRemove}>
              ✕
            </button>
          )}
        </span>
      </div>
      {item ? (
        <div class="tp-quote-body" aria-live="polite">
          <blockquote>{item.title}</blockquote>
          {item.note && <Markdown text={item.note} class="tp-quote-note" />}
        </div>
      ) : (
        <p class="muted">Nothing on this list yet.</p>
      )}
      {order.length > 1 && (
        <div class="tp-quote-nav">
          <button class="icon" aria-label="Previous" onClick={() => go(-1)}>
            ‹
          </button>
          <button class="icon" aria-label="Next" onClick={() => go(1)}>
            ›
          </button>
        </div>
      )}
    </section>
  );
}
