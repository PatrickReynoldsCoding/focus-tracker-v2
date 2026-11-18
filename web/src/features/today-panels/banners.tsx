// Due reminders and other notifications as banners at the top of Today, with a count on the
// Today tab so they show from other tabs too.

import { change, get, mode, optimistic, post, put, signedIn, version } from '../../core/api';
import { tabBadges, type TodayPanelProps } from '../../core/registry';
import { signal, useSignal } from '../../core/signal';

export type Banner = { id: string; kind: string; title: string; body: string | null; due: string; project_id: string | null; project_name: string | null };

const banners = signal<Banner[]>([]);
let started = false;

async function refresh() {
  if (signedIn.value !== true) return;
  try {
    banners.value = await get<Banner[]>('/today-panels/banners');
  } catch {
    /* offline or signed out: keep what is shown */
  }
}

/** Load the banners now, again when a change lands, the mode changes, the tab is shown again and every minute. */
export function startBanners() {
  if (started) return;
  started = true;
  banners.subscribe((list) => (tabBadges.value = { ...tabBadges.value, today: list.length }));
  signedIn.subscribe(refresh);
  version.subscribe(refresh);
  mode.subscribe(refresh);
  document.addEventListener('visibilitychange', () => !document.hidden && refresh());
  setInterval(refresh, 60_000);
  refresh();
}

export function Banners({ today }: TodayPanelProps) {
  const list = useSignal(banners);
  if (!list.length) return null;
  const remove = (b: Banner) =>
    optimistic(
      () => {
        const before = banners.value;
        banners.value = before.filter((x) => x.id !== b.id);
        return () => (banners.value = before);
      },
      () => post(`/notifications/${b.id}/dismiss`),
    );
  const focus = async (b: Banner) => {
    // Dismissing finishes the reminder; the focus change comes first so a refusal keeps the banner.
    const ok = await change(() => put('/focus', { project_id: b.project_id }), `Focus: ${b.project_name}`);
    if (ok) remove(b);
  };
  return (
    <div class="tp-banners" role="region" aria-label="Reminders">
      {list.map((b) => (
        <section key={b.id} class="tp-banner">
          <div class="tp-banner-text">
            <strong>{b.project_id ? <a href={`#/p/${b.project_id}`}>{b.title}</a> : b.title}</strong>
            {b.body && <span>{b.body}</span>}
          </div>
          <div class="row">
            {b.project_id && today.focus?.id !== b.project_id && (
              <button class="primary small" onClick={() => focus(b)}>
                Make it today’s focus
              </button>
            )}
            <button class="ghost small" onClick={() => remove(b)}>
              Dismiss
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
