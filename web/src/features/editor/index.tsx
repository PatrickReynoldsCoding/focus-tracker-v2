// The note editor: notes shown formatted (as before), tap to edit them as formatted text.
// The editing part (ProseMirror, toolbar) is a separate chunk loaded on first use, so the
// app's first load stays small. Flags: 'rich-editor' (off: the plain Markdown box) and
// 'paper-themes'. Notes stay Markdown (DECISIONS D5).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { mode, say, version } from '../../core/api';
import * as offline from '../../core/offline';
import { useFlag } from '../../core/features';
import { registerMarkdownEditor, registerPanel, type MarkdownEditorProps } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { Markdown, MarkdownEditor } from '../../core/ui';
import { getDraft, paper, setDraft, type Draft } from './device';
import type { EditingProps } from './Editing';
import { cardTarget, noteTarget, plainTarget, type Target } from './targets';
import './editor.css';

type EditingComp = (p: EditingProps) => any;
let loaded: EditingComp | null = null;
let loading: Promise<EditingComp> | null = null;
const loadEditing = () => (loading ??= import('./Editing').then((m) => (loaded = m.default as EditingComp)));

const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 699px)').matches;

/** Tick the i-th "[ ]" / "[x]" of a Markdown text (outside code blocks). null if they cannot be matched up. */
export function toggleTask(md: string, i: number, boxes: number): string | null {
  const lines = md.split('\n');
  let fence: string | null = null;
  const found: number[] = [];
  lines.forEach((line, k) => {
    const body = line.replace(/^(?:[ \t]*>[ \t]?)*[ \t]*/, '');
    const f = /^(`{3,}|~{3,})/.exec(body);
    if (f) {
      if (!fence) fence = f[1];
      else if (body.startsWith(fence)) fence = null;
      return;
    }
    if (!fence && /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+\[[ xX]\](?:[ \t]|$)/.test(line)) found.push(k);
  });
  if (found.length !== boxes || i >= found.length) return null;
  const k = found[i];
  lines[k] = lines[k].replace(/\[([ xX])\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function NoteEditor(props: MarkdownEditorProps) {
  const { value, placeholder, rows = 8, note } = props;
  const paperOn = useFlag('paper-themes');
  const paperId = useSignal(paper);
  const live = useRef(props);
  live.current = props;
  const target: Target = useMemo(
    () =>
      (props.target as Target | undefined) ??
      (note ? noteTarget(note.kind, note.id) : plainTarget(() => live.current.value, (v) => live.current.onSave(v), props.draftKey)),
    [props.target, note?.kind, note?.id, props.draftKey],
  );
  const key = props.draftKey ?? target.key;

  const [editing, setEditing] = useState<EditingProps['start'] | null>(null);
  const [Comp, setComp] = useState<EditingComp | null>(() => loaded);
  // A save made offline that is still waiting shows instead of the (older) saved copy.
  const net = useSignal(offline.status);
  const m = useSignal(mode);
  const waitingText = note ? offline.queuedBody(m, `/notes/of/${note.kind}/${note.id}`)?.body : undefined;
  const latest = typeof waitingText === 'string' ? waitingText : value;
  const [shown, setShown] = useState(latest);
  const [draft, setDraftState] = useState<Draft | null>(() => getDraft(key));
  const view = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) setShown(latest);
  }, [latest, net.waiting]);
  // A draft that matches the note is already saved.
  useEffect(() => {
    const d = getDraft(key);
    if (d && d.text === value) {
      setDraft(key, null);
      setDraftState(null);
    } else setDraftState(d);
  }, [key, value]);
  // A note's version, read once while online, so an edit made offline later can be checked.
  useEffect(() => {
    if (note && !offline.waiting()) target.read().catch(() => {});
  }, [note?.kind, note?.id]);
  // Fetch the editing chunk when the browser is idle, so the first tap opens at once.
  useEffect(() => {
    if (loaded) return;
    const ric = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
    ric(() => loadEditing(), { timeout: 4000 });
  }, []);

  const open = (start: EditingProps['start']) => {
    setEditing(start);
    if (!loaded) loadEditing().then((c) => setComp(() => c), () => (setEditing(null), say('Could not load the editor. Are you offline?', 'error')));
    else setComp(() => loaded);
  };

  const done = (text: string) => {
    setEditing(null);
    setShown(text);
    setDraftState(getDraft(key));
    if (note) version.value++; // views showing this note reload
  };

  // Ticking a checkbox in the formatted note saves at once.
  useEffect(() => {
    view.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((b, i) => {
      b.disabled = false;
      b.dataset.i = String(i);
      b.setAttribute('aria-label', b.checked ? 'Done' : 'Not done');
    });
  });
  const tick = async (i: number) => {
    const boxes = view.current?.querySelectorAll('input[type=checkbox]').length ?? 0;
    const before = shown;
    const next = toggleTask(before, i, boxes);
    if (next === null) return open({ text: before, baseText: before, base: undefined });
    setShown(next);
    try {
      if (target.versioned) {
        const r = await target.read();
        if (r.text !== before) {
          setShown(r.text);
          say('This note changed somewhere else; here is the latest. Tick again if needed.');
          return;
        }
        await target.write(next, r.version);
      } else await target.write(next, null);
      if (note) version.value++;
    } catch (e) {
      setShown(before);
      say(`Not saved: ${(e as Error).message}`, 'error');
    }
  };

  const paperCls = `paper-${paperOn ? paperId : 'plain'}`;
  if (editing && Comp)
    return <Comp start={editing} target={{ ...target, key }} placeholder={placeholder} rows={rows} phone={isPhone()} paperOn={paperOn} onDone={done} />;

  return (
    <div class="ed-wrap">
      {draft && draft.text !== shown && !editing && (
        <div class="ed-draft" role="status">
          <span>{draft.clash ? `Your change from ${when(draft.at)}, made offline, was not saved: the note was changed somewhere else too.` : `Unsaved changes from ${when(draft.at)} on this device.`}</span>
          <button type="button" class="small primary" onClick={() => open({ text: draft.text, baseText: draft.baseText, base: draft.base, clash: draft.clash })}>
            {draft.clash ? 'Choose…' : 'Restore'}
          </button>
          <button
            type="button"
            class="small ghost"
            onClick={() => {
              setDraft(key, null);
              setDraftState(null);
            }}
          >
            Discard
          </button>
        </div>
      )}
      <div
        ref={view}
        class={`ed ed-view ${paperCls} ${editing ? 'is-loading' : ''}`}
        tabIndex={0}
        aria-label={shown ? 'Note. Press Enter to edit.' : placeholder ?? 'Empty note. Press Enter to write.'}
        onPointerEnter={() => loadEditing()}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t instanceof HTMLInputElement && t.type === 'checkbox') {
            e.preventDefault();
            tick(Number(t.dataset.i));
            return;
          }
          if (t.closest('a') || getSelection()?.toString()) return;
          open({ text: shown, baseText: shown, base: undefined });
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            open({ text: shown, baseText: shown, base: undefined });
          }
        }}
      >
        {shown ? <Markdown class="ed-doc" text={shown} /> : <p class="ed-doc ed-placeholder">{placeholder ?? 'Tap to write…'}</p>}
        <span class="ed-edit-hint" aria-hidden="true">
          {editing ? 'Opening…' : '✎ Edit'}
        </span>
      </div>
    </div>
  );
}

registerMarkdownEditor({ id: 'rich', feature: 'rich-editor', component: NoteEditor });

// A note or card note saved offline and refused on sending (changed elsewhere since): keep it as a
// draft that opens with the usual choice (Keep mine, Use theirs, Keep both).
offline.registerConflictHandler((e) => {
  const note = /^\/notes\/of\/(project|list)\/([\w-]+)$/.exec(e.path);
  const card = /^\/tasks\/([\w-]+)$/.exec(e.path);
  const text = note ? e.body?.body : card ? e.body?.note : undefined;
  if (e.method === 'GET' || typeof text !== 'string') return null;
  const key = note ? `note:${note[1]}:${note[2]}` : `card:${card![1]}`;
  const base = (note ? e.body?.base : e.body?.base_updated_at) as string | null | undefined;
  setDraft(key, { text, baseText: '\u0000', base: base ?? null, at: e.at, clash: true });
  return `Not applied: your offline change to ${e.label}. It was changed on another device too. Open it and choose: Keep mine, Use theirs or Keep both.`;
});

// The card dialog's note, with a conflict check (replaces the projects feature's plain one).
registerPanel('card', {
  id: 'note',
  order: 10,
  override: true,
  render: ({ card, save, update }) => (
    <MarkdownEditor
      value={card.note ?? ''}
      placeholder="Add a note…"
      onSave={(note) => save({ note })}
      target={cardTarget(card.id, (note) => update({ note }))}
    />
  ),
});
