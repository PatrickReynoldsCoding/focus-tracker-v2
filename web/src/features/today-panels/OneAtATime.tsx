// "One at a time": a random item of a list as a quote card in the list's colour, its note under
// it. Moves on every N seconds, shuffled so nothing repeats until all were shown; ‹ › to skip.

import { useEffect, useRef, useState } from 'preact/hooks';
import { useEink } from '../../core/theme';
import { Markdown } from '../../core/ui';
import { ListTitle, type ListSettingsProps } from './ListDialog';

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

export function OneAtATime({ list, setList, items, onRemove }: { list: ListSettingsProps; setList: (fn: (l: any) => any) => void; items: QuoteItem[]; onRemove?: () => void }) {
  const { name, color, seconds } = list;
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
  const eink = useEink(); // E-ink: no rotating by itself (each change redraws the screen); the arrows still work
  useEffect(() => {
    if (order.length < 2 || eink) return;
    const t = setInterval(() => go(1), Math.max(5, seconds) * 1000);
    return () => clearInterval(t);
  }, [seconds, tick, ids, eink]);
  const item = items.find((i) => i.id === order[at]);
  return (
    <section class="card tp-quote" style={{ '--rot-c': color ? `var(--c-${color})` : 'var(--accent)' }}>
      <div class="card-head">
        <h2>
          <ListTitle list={list} setList={setList} prefix="✦ " quote />
        </h2>
        <span class="row tight">
          <span class="pos">{order.length ? `${at + 1} / ${order.length}` : ''}</span>
          {onRemove && (
            <button class="icon small" aria-label={`Remove ${name} from Today`} title="Remove from Today" onClick={onRemove}>
              ✕
            </button>
          )}
        </span>
      </div>
      {item ? (
        <div class="tp-quote-body" key={item.id} aria-live="polite">
          <blockquote>
            <span class="rq">{item.title}</span>
          </blockquote>
          {item.note && <Markdown text={item.note} class="tp-quote-note" />}
        </div>
      ) : (
        <p class="muted">Nothing on this list yet.</p>
      )}
      {order.length > 1 && (
        <div class="tp-quote-nav">
          <button class="icon" aria-label="Previous item" onClick={() => go(-1)}>
            ‹
          </button>
          <button class="icon" aria-label="Next item" onClick={() => go(1)}>
            ›
          </button>
        </div>
      )}
    </section>
  );
}
