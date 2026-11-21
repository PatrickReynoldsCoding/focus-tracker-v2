// Shared bits: data loading, routing, dialogs, Markdown, colours.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { get, HttpError, mode, version } from './api';
import { noteHtml } from './blank-lines';
import * as offline from './offline';
import { useMarkdownEditor, type MarkdownEditorProps } from './registry';
import { signal, useSignal } from './signal';

// ---------- routing (hash based: #/today, #/p/<id> ...) ----------

export const route = signal(location.hash.slice(1) || '/today');
window.addEventListener('hashchange', () => (route.value = location.hash.slice(1) || '/today'));
export const go = (path: string) => (location.hash = path);

/** The page a redirect left (replaceRoute), so the Back history does not count it as a step. */
let replacedFrom: string | null = null;
/** Go to another page in place of this one (an old address that now lives elsewhere): no new
 *  browser history entry, and the in-app Back button skips the page left. */
export function replaceRoute(path: string) {
  replacedFrom = route.value;
  location.replace(`#${path}`);
}
/** Whether `from` was left by replaceRoute (asked once, by the Back history). */
export function wasReplaced(from: string): boolean {
  const yes = replacedFrom === from;
  replacedFrom = null;
  return yes;
}

/** Run `fn` once a closing dialog has taken its history entry back (see Dialog), so a dialog or page
 *  opened straight after another dialog closes is not undone by that step back. */
export function afterDialog(fn: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', run);
    fn();
  };
  window.addEventListener('popstate', run);
  setTimeout(run, 400);
}

// ---------- loading ----------

/** Load a path, again whenever the mode changes or a change lands. The saved copy on this device
 *  (core/offline.ts) shows at once while the fresh one loads; changes made with setData are kept
 *  in it, so they still show offline and after a reload. */
export function useData<T>(path: string | null): { data: T | undefined; error: string | null; reload: () => void; setData: (fn: (d: T) => T) => void } {
  const v = useSignal(version);
  const m = useSignal(mode);
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let fresh = false;
    let counted = false;
    const uncount = () => {
      if (counted) offline.updating(-1);
      counted = false;
    };
    // A new page (not a reload of the same one): the saved copy first.
    if (shown.current !== `${m}|${path}` && offline.enabled()) {
      offline.readCopy(m, path).then((c) => {
        if (!live || fresh || !c) return;
        setData(c.data as T);
        setError(null);
        if (offline.status.value.online && !offline.waiting()) {
          counted = true;
          offline.updating(1);
        }
      });
    }
    shown.current = `${m}|${path}`;
    get<T>(path)
      .then((d) => {
        fresh = true;
        if (live) (setData(d), setError(null));
      })
      .catch((e: Error) => live && !(e instanceof HttpError && e.status === 401) && setError(e.message))
      .finally(uncount);
    return () => {
      live = false;
      uncount();
    };
  }, [path, v, m, n]);
  return {
    data,
    error,
    reload: () => setN((x) => x + 1),
    setData: (fn) =>
      setData((d) => {
        if (d === undefined) return d;
        const next = fn(d);
        if (path) offline.saveCopy(m, path, next);
        return next;
      }),
  };
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <p class="empty error">{error}</p> : <p class="empty">Loading…</p>;
}

// ---------- dialog (a sheet from the bottom on a phone) ----------

/** How many dialogs are open, so the back button closes only the top one when they are nested. */
let openDialogs = 0;

export function Dialog({ title, onClose, children, wide }: { title: ComponentChildren; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    // The phone's back button closes the dialog (the top one, when one opened from another).
    const depth = ++openDialogs;
    history.pushState({ dialog: depth }, '');
    const pop = () => {
      if (!(Number(history.state?.dialog) >= depth)) onClose();
    };
    window.addEventListener('popstate', pop);
    return () => {
      openDialogs--;
      window.removeEventListener('popstate', pop);
      if (history.state?.dialog === depth) history.back();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      class={wide ? 'sheet wide' : 'sheet'}
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div class="sheet-inner">
        <header class="sheet-head">
          <h2>{title}</h2>
          <button class="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

// ---------- Markdown ----------

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text, class: cls, blankLines }: { text: string; class?: string; blankLines?: boolean }) {
  const html = blankLines ? noteHtml(text) : DOMPurify.sanitize(marked.parse(text || '', { async: false }) as string);
  return <div class={`md ${cls ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A Markdown text: shown formatted, tap to edit. Uses the registered editor (features/editor, flag
 *  'rich-editor'); without one, the plain text box below. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const impl = useMarkdownEditor();
  const Impl = impl?.component ?? PlainMarkdownEditor;
  return <Impl {...props} />;
}

/** The plain editor: a Markdown text box that saves when you leave it. */
export function PlainMarkdownEditor({ value, onSave, placeholder, rows = 8 }: MarkdownEditorProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  if (!editing)
    return (
      <div class="md-view" tabIndex={0} onClick={(e) => (e.target as HTMLElement).tagName !== 'A' && setEditing(true)} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}>
        {value ? <Markdown text={value} /> : <p class="muted">{placeholder ?? 'Tap to write…'}</p>}
      </div>
    );
  return (
    <textarea
      class="md-edit"
      rows={Math.max(rows, text.split('\n').length + 1)}
      value={text}
      autoFocus
      placeholder={placeholder}
      onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      onBlur={() => {
        setEditing(false);
        if (text !== value) onSave(text);
      }}
    />
  );
}

// ---------- colours ----------

export const COLORS = ['', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'];

export function ColorPicker({ value, onPick }: { value?: string | null; onPick: (c: string | null) => void }) {
  return (
    <div class="swatches" role="radiogroup" aria-label="Colour">
      {COLORS.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={(value ?? '') === c}
          aria-label={c || 'No colour'}
          class={`swatch c-${c || 'none'} ${(value ?? '') === c ? 'on' : ''}`}
          onClick={() => onPick(c || null)}
        />
      ))}
    </div>
  );
}

// ---------- small inputs ----------

/** A one-line input that adds something on Enter and stays open for the next one. */
export function AddInput({ placeholder, onAdd, autoFocus }: { placeholder: string; onAdd: (text: string) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  return (
    <form
      class="add-input"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (t) onAdd(t);
        setText('');
      }}
    >
      <input value={text} placeholder={placeholder} autoFocus={autoFocus} onInput={(e) => setText((e.target as HTMLInputElement).value)} aria-label={placeholder} />
      <button type="submit" class="icon" aria-label="Add" disabled={!text.trim()}>
        +
      </button>
    </form>
  );
}

/** Text that turns into an input when tapped. */
export function InlineEdit({ value, onSave, class: cls, placeholder }: { value: string; onSave: (v: string) => void; class?: string; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <span class={`inline-edit ${cls ?? ''}`} tabIndex={0} onClick={() => setEditing(true)} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}>
        {value || <span class="muted">{placeholder}</span>}
      </span>
    );
  return (
    <input
      class={`inline-input ${cls ?? ''}`}
      defaultValue={value}
      ref={(el) => {
        if (el && document.activeElement !== el) {
          el.focus();
          el.select();
        }
      }}
      onBlur={(e) => {
        setEditing(false);
        const v = (e.target as HTMLInputElement).value.trim();
        if (v !== value) onSave(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

export function fmtMinutes(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`;
}

export function fmtDay(day: string | null | undefined): string {
  if (!day) return '';
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function daysAgo(day: string | null | undefined, today: string): string {
  if (!day) return 'never';
  const n = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86400000);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

export const todayLocal = () => new Date().toLocaleDateString('en-CA');

// ---------- web addresses in plain text ----------

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi;

/** Plain text with its web addresses turned into links. A click on a link opens the link, never the card around it. */
export function Linkify({ text }: { text: string | null | undefined }) {
  const s = text ?? '';
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(s.slice(last, at));
    const href = /^www\./i.test(m[1]) ? `https://${m[1]}` : m[1];
    out.push(
      <a key={at} href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {m[1]}
      </a>,
    );
    last = at + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return <>{out}</>;
}

/** The first lines of a Markdown text as plain text (marks removed), for a preview. */
export function plainPreview(md: string | null | undefined, maxLines = 2, maxChars = 140): string {
  const lines = (md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
        .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, (_m, t, u) => t || u)
        .replace(/[*_~`]+/g, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, maxLines);
  const text = lines.join(' · ');
  return text.length > maxChars ? text.slice(0, maxChars - 1).trimEnd() + '…' : text;
}

/** A file type's icon: a glyph in a small square tinted with a colour token ('yellow', 'green' ...),
 *  as the Files tab and file pickers show it (styles in styles.css). */
export function FileGlyph({ tint, children, size = 24 }: { tint: string; children: ComponentChildren; size?: number }) {
  return (
    <span class="file-glyph" data-tint={tint} style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.58)}px` }} aria-hidden="true">
      {children}
    </span>
  );
}
