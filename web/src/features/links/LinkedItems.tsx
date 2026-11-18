// "Linked items": an item's links grouped by how they read from it, Jira style, with "+ Link".
import { useEffect, useState } from 'preact/hooks';
import { del, get, HttpError, optimistic, post, say, undo, version } from '../../core/api';
import { Dialog, Loading, useData } from '../../core/ui';
import { BlockedBy, kindIcon, kindLabel, useOpener, type Item, type LinkType, type LinkView, type Relations } from './shared';

function Status({ s }: { s: Item['status'] }) {
  if (!s) return null;
  return <span class={`tag link-status ${s}`}>{s === 'done' ? 'Done' : 'Open'}</span>;
}

function ItemLine({ item }: { item: Item }) {
  return (
    <>
      <span class="kind-ico" title={kindLabel(item.kind)} aria-label={kindLabel(item.kind)}>
        {kindIcon(item)}
      </span>
      <span class="link-text">
        <span class={item.status === 'done' ? 'link-title done' : 'link-title'}>{item.title}</span>
        {item.context && <span class="muted small"> · {item.context}</span>}
      </span>
    </>
  );
}

/** The + Link dialog: choose how this item relates, find the other item, add a note if you like. */
function LinkDialog({ me, onClose }: { me: Item; onClose: () => void }) {
  const { data: types } = useData<LinkType[]>('/links/types');
  const [phrase, setPhrase] = useState('0');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [results, setResults] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState<Item | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q, exclude: `${me.kind}:${me.id}` });
      if (kind) params.set('kind', kind);
      get<Item[]>(`/links/search?${params}`)
        .then((r) => live && setResults(r))
        .catch(() => live && setResults([]));
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, kind]);

  if (!types) return null;
  // Every phrase once: "blocks", "is blocked by", "relates to" …
  const phrases = types.flatMap((t) => (t.inward === t.outward ? [{ t, text: t.outward, reversed: false }] : [{ t, text: t.outward, reversed: false }, { t, text: t.inward, reversed: true }]));
  const chosen = phrases[Number(phrase)] ?? phrases[0];

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!picked || busy) return;
    const other = picked;
    const [from, to] = chosen.reversed ? [other, me] : [me, other];
    setBusy(true);
    try {
      await post('/links', { from_kind: from.kind, from_id: from.id, to_kind: to.kind, to_id: to.id, type: chosen.t.id, note: note.trim() || undefined });
      version.value++;
      say(`Linked: ${me.title} ${chosen.text} ${other.title}`, 'info', { label: 'Undo', run: undo });
      onClose();
    } catch (x) {
      if (!(x instanceof HttpError && x.status === 401)) setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Link “${me.title}”`} onClose={onClose}>
      <form class="stack link-form" onSubmit={submit}>
        <label>
          This {kindLabel(me.kind).toLowerCase()}
          <select value={phrase} onChange={(e) => (setPhrase((e.target as HTMLSelectElement).value), setErr(''))}>
            {phrases.map((p, i) => (
              <option key={i} value={String(i)}>
                {p.text}
              </option>
            ))}
          </select>
        </label>
        {picked ? (
          <div class="link-picked">
            <ItemLine item={picked} />
            <button type="button" class="ghost small" onClick={() => (setPicked(null), setErr(''))}>
              Change
            </button>
          </div>
        ) : (
          <div class="stack tight">
            <div class="link-search">
              <input type="search" placeholder="Search projects, cards, to-dos…" value={q} autoFocus onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search for the item to link" />
              <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)} aria-label="Kind">
                <option value="">All</option>
                {['projects', 'tasks', 'todos', 'backlog', 'lists'].map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}s
                  </option>
                ))}
              </select>
            </div>
            {!results ? (
              <Loading />
            ) : results.length ? (
              <ul class="link-results">
                {results.map((r) => (
                  <li key={`${r.kind}:${r.id}`}>
                    <button type="button" onClick={() => (setPicked(r), setErr(''))}>
                      <ItemLine item={r} />
                      <Status s={r.status} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="muted small">Nothing found.</p>
            )}
          </div>
        )}
        <input placeholder="Note (optional)" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} aria-label="Note" />
        {err && <p class="error small">{err}</p>}
        <button class="primary" disabled={!picked || busy}>
          Link
        </button>
      </form>
    </Dialog>
  );
}

/** An item's linked items. `close` closes the dialog it sits in before going to another page. */
export function LinkedItems({ kind, id, heading = 'h2', showBlocked = true, close }: { kind: string; id: string; heading?: 'h2' | 'h3'; showBlocked?: boolean; close?: () => void }) {
  const { data, error, setData } = useData<Relations>(`/links/of/${kind}/${id}`);
  const [adding, setAdding] = useState(false);
  // The undo message sits in the section: a toast cannot be tapped while a dialog is open.
  const [removed, setRemoved] = useState<LinkView | null>(null);
  const { open, node } = useOpener(close);
  const H = heading;
  const groups: { phrase: string; links: LinkView[] }[] = [];
  for (const l of data?.links ?? []) {
    const g = groups.find((x) => x.phrase === l.phrase);
    if (g) g.links.push(l);
    else groups.push({ phrase: l.phrase, links: [l] });
  }
  const unlink = async (l: LinkView) => {
    const ok = await optimistic(
      () => {
        setData((d) => ({ ...d, links: d.links.filter((x) => x.id !== l.id) }));
        return () => setData((d) => ({ ...d, links: [...d.links, l] }));
      },
      () => del(`/links/${l.id}`),
    );
    if (ok) setRemoved(l);
  };
  return (
    <div class="linked">
      <div class="card-head">
        <H>Linked items</H>
        <button class="ghost small" onClick={() => setAdding(true)} disabled={!data}>
          + Link
        </button>
      </div>
      {!data ? (
        error ? <Loading error={error} /> : null
      ) : (
        <>
          {showBlocked && data.blocked_by.length > 0 && <BlockedBy items={data.blocked_by} open={open} />}
          {groups.map((g) => (
            <div key={g.phrase} class="link-group">
              <div class="link-phrase">{g.phrase}</div>
              <ul class="link-list">
                {g.links.map((l) => (
                  <li key={l.id}>
                    <button class="link-open" onClick={() => open(l.item)} title={l.note ?? undefined}>
                      <ItemLine item={l.item} />
                    </button>
                    <Status s={l.item.status} />
                    <button class="icon small" aria-label={`Remove link to ${l.item.title}`} onClick={() => unlink(l)}>
                      ✕
                    </button>
                    {l.note && <div class="link-note muted small">{l.note}</div>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {removed && (
            <p class="link-undo muted small" role="status">
              Link to “{removed.item.title}” removed.{' '}
              <button class="link-btn" onClick={() => (setRemoved(null), undo())}>
                Undo
              </button>
            </p>
          )}
        </>
      )}
      {adding && data && <LinkDialog me={data.item} onClose={() => setAdding(false)} />}
      {node}
    </div>
  );
}
