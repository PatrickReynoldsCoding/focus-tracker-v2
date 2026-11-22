// "One at a time": a random item of a list as a quote card in the list's colour, its note under
// it. Moves on every N seconds, shuffled so nothing repeats until all were shown; ‹ › to skip.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useEink } from '../../core/theme';
import { ProjectLabel } from '../../core/registry';
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
  const body = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  useFit(body, text, item?.id, item?.title, item?.note);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || order.length < 2) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) return go(dx < 0 ? 1 : -1);
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || (e.target as HTMLElement).closest('a, button')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    go(e.clientX - r.left < r.width / 2 ? -1 : 1);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else return;
    e.preventDefault();
  };
  return (
    <section class="card tp-quote" style={{ '--rot-c': color ? `var(--c-${color})` : 'var(--accent)' }}>
      <div class="card-head">
        <h2>
          <ListTitle list={list} setList={setList} prefix="✦ " quote />
          <ProjectLabel projectId={list.project_id} />
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
        <div
          class="tp-quote-body"
          ref={body}
          tabIndex={order.length > 1 ? 0 : undefined}
          role="group"
          aria-roledescription="carousel"
          aria-label={`${name}: swipe, tap the left or right side, or use the arrow keys`}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => (swipe.current = null)}
          onKeyDown={onKey}
        >
          <div class="tp-quote-fit" ref={text} key={item.id} aria-live="polite">
            <blockquote>
              <span class="rq">{item.title}</span>
            </blockquote>
            {item.note && <Markdown text={item.note} class="tp-quote-note" />}
          </div>
        </div>
      ) : (
        <p class="muted">Nothing on this list yet.</p>
      )}
      {order.length > 1 && (
        <div class="tp-quote-foot">
          <button class="sr-nav" aria-label="Previous item" onClick={() => go(-1)} />
          <span class="tp-dots" aria-hidden="true">
            {dotsFor(at, order.length).map((d) => (
              <i key={d.i} class={d.i === at ? 'on' : d.edge ? 'edge' : ''} />
            ))}
          </span>
          <button class="sr-nav" aria-label="Next item" onClick={() => go(1)} />
        </div>
      )}
    </section>
  );
}

const MAX_DOTS = 9;

/** The dots to draw: all of them, or a window of nine around the current one (the ends smaller). */
export function dotsFor(at: number, n: number): { i: number; edge: boolean }[] {
  if (n <= MAX_DOTS) return Array.from({ length: n }, (_, i) => ({ i, edge: false }));
  const from = Math.max(0, Math.min(n - MAX_DOTS, at - Math.floor(MAX_DOTS / 2)));
  return Array.from({ length: MAX_DOTS }, (_, k) => {
    const i = from + k;
    return { i, edge: (k === 0 && from > 0) || (k === MAX_DOTS - 1 && from + MAX_DOTS < n) };
  });
}

const MIN_SIZE = 13;
const MAX_SIZE = 72;

/** Sizes the quote so the text fills its box: big for a short one, smaller for a long one. */
function useFit(box: { current: HTMLDivElement | null }, text: { current: HTMLDivElement | null }, ...deps: unknown[]) {
  useLayoutEffect(() => {
    const b = box.current;
    const t = text.current;
    if (!b || !t) return;
    const fit = () => {
      const w = b.clientWidth;
      const h = b.clientHeight;
      if (!w || !h) return;
      let lo = MIN_SIZE;
      let hi = MAX_SIZE;
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2;
        t.style.setProperty('--q', `${mid}px`);
        if (t.scrollHeight <= h && t.scrollWidth <= w) lo = mid;
        else hi = mid;
      }
      t.style.setProperty('--q', `${lo}px`);
    };
    fit();
    if (document.fonts?.ready) document.fonts.ready.then(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, deps);
}
