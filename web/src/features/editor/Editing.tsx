// The editor while editing (loaded on first use): toolbar with fold-out menus, saving with
// drafts on the device and conflict choices, full screen on a phone, resizable on a desktop.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useSignal } from '../../core/signal';
import { getDraft, getHeight, paper, PAPERS, setDraft, setHeight, setPaper } from './device';
import * as E from './engine';
import { Menu, type MenuEntry } from './Menu';
import { schema } from './schema';
import { Conflict, type Target } from './targets';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';

export interface EditingProps {
  /** What to show first, what it was based on and that text's version (undefined: ask the server).
   *  `clash`: an offline save that was refused; save at once so the choice shows. */
  start: { text: string; baseText: string; base: string | null | undefined; clash?: boolean };
  target: Target;
  placeholder?: string;
  rows: number;
  phone: boolean;
  paperOn: boolean;
  /** Editing ended; the text now saved (or kept as a draft). */
  onDone: (text: string) => void;
}

type Status = 'idle' | 'saving' | 'saved' | 'error' | 'copied';

const SAVE_PAUSE = 1200;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    t.dataset.edCopy = '1';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

export default function Editing({ start, target, placeholder, rows, phone, paperOn, onDone }: EditingProps) {
  const shell = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const ed = useRef<E.Editor | null>(null);
  const [, setTick] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [full, setFull] = useState(phone);
  const paperId = useSignal(paper);

  // Saving state lives in refs: it must survive renders and be read in event handlers.
  const s = useRef({
    seq: start.text === start.baseText ? 0 : 1, // changes made
    savedSeq: 0, // changes saved
    base: (start.base ?? null) as string | null | undefined, // undefined: unknown (offline, never read)
    savedText: start.baseText,
    stale: null as Conflict | null, // the server had something else when editing began
    saving: null as Promise<void> | null,
    again: false,
    conflict: null as Conflict | null,
    source: null as string | null,
    done: false,
    timer: 0,
    draftTimer: 0,
  }).current;

  const text = () => s.source ?? ed.current?.markdown() ?? s.savedText;
  const dirty = () => s.seq !== s.savedSeq;

  const writeDraft = () => {
    clearTimeout(s.draftTimer);
    if (!target.key) return;
    // (A clash draft, left by an offline save that was refused while editing, stays until a choice is made.)
    if (!dirty()) return getDraft(target.key)?.clash ? undefined : setDraft(target.key, null);
    setDraft(target.key, { text: text(), baseText: s.savedText, base: s.base ?? null, at: Date.now() });
  };

  const save = async (keepalive = false): Promise<void> => {
    clearTimeout(s.timer);
    if (s.conflict) return;
    if (!dirty()) return writeDraft();
    if (s.saving) {
      s.again = true;
      return s.saving;
    }
    if (s.stale) {
      const c = s.stale;
      s.stale = null;
      if (c.text !== text()) return showConflict(c);
      s.base = c.version;
    }
    const body = text();
    const seq = s.seq;
    writeDraft();
    s.saving = (async () => {
      setStatus('saving');
      try {
        const r = await target.write(body, s.base, keepalive);
        s.base = r.version;
        s.savedText = body;
        s.savedSeq = seq;
        if (!dirty()) writeDraft();
        setStatus('saved');
      } catch (e) {
        if (e instanceof Conflict) {
          // The server's text is the one we started from: not a real conflict (we just did not know its version).
          if (e.text === s.savedText) {
            s.base = e.version;
            s.again = true;
          } else showConflict(e);
        } else setStatus('error');
      } finally {
        s.saving = null;
      }
    })();
    await s.saving;
    if (s.again) {
      s.again = false;
      return save(keepalive);
    }
  };

  const showConflict = (c: Conflict) => {
    s.conflict = c;
    setConflict(c);
    setStatus('idle');
  };

  const changed = () => {
    s.seq++;
    setStatus('idle');
    clearTimeout(s.timer);
    clearTimeout(s.draftTimer);
    s.timer = window.setTimeout(() => save(), SAVE_PAUSE);
    s.draftTimer = window.setTimeout(writeDraft, 300);
  };

  const finish = async () => {
    if (s.done) return;
    await save();
    if (s.conflict) return; // the choice must be made first
    s.done = true;
    onDone(dirty() ? text() : s.savedText);
  };

  // ---------- the editor ----------

  useLayoutEffect(() => {
    const editor = E.createEditor(mount.current!, start.text, {
      placeholder,
      onChange: (docChanged) => {
        if (docChanged) changed();
        setTick((t) => t + 1);
      },
      hooks: {
        onLink: () => openLink(),
      },
    });
    ed.current = editor;
    editor.view.focus();
    // put the cursor at the end
    editor.view.dispatch(editor.view.state.tr.setSelection(E.selectionAtEnd(editor.view.state.doc)));
    if (start.clash) {
      setDraft(target.key, null); // the choice is made here now
      save();
    }
    else if (start.base === undefined)
      target
        .read()
        .then((r) => {
          if (r.text === s.savedText) s.base = r.version;
          else if (s.seq === 0) {
            editor.setMarkdown(r.text, { history: false });
            s.savedText = r.text;
            s.base = r.version;
          } else s.stale = new Conflict(r.text, r.version);
        })
        .catch(() => {
          // Offline and never read on this device: the version is unknown, so the save cannot be checked.
          if (s.base === null && s.seq === 0) s.base = undefined;
        });
    return () => {
      clearTimeout(s.timer);
      writeDraft();
      if (dirty() && !s.conflict) save(true);
      editor.destroy();
    };
  }, []);

  // ---------- leaving, page hide, back online ----------

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        writeDraft();
        save(true);
      }
    };
    const pagehide = () => {
      writeDraft();
      save(true);
    };
    const online = () => save();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('online', online);
    // Leaving the editor (a tap or focus elsewhere) saves and shows the note again.
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!shell.current || shell.current.contains(t) || (t as HTMLElement).dataset?.edCopy) return;
      if (s.conflict) return;
      finish();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('online', online);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
    };
  }, []);

  // ---------- full screen (a phone always; a desktop from the ⋯ menu) ----------

  useEffect(() => {
    const el = shell.current!;
    if (!full) return;
    el.setAttribute('popover', 'manual');
    try {
      el.showPopover();
    } catch {
      el.classList.add('ed-fixed'); // no popover support: plain fixed position
    }
    const vv = window.visualViewport;
    const fit = () => {
      if (!vv) return;
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
    };
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    // The phone's back button leaves full screen (and editing) instead of the page or dialog.
    let popped = false;
    const pop = () => {
      if (history.state?.editor) return;
      popped = true;
      if (phone) finish();
      else setFull(false);
    };
    history.pushState({ ...(history.state ?? {}), editor: true }, '');
    window.addEventListener('popstate', pop);
    ed.current?.view.focus();
    return () => {
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      window.removeEventListener('popstate', pop);
      if (!popped && history.state?.editor) history.back();
      try {
        el.hidePopover();
      } catch {
        /* not shown */
      }
      el.removeAttribute('popover');
      el.classList.remove('ed-fixed');
      el.style.top = '';
      el.style.height = '';
    };
  }, [full]);

  // ---------- commands ----------

  const run = (cmd: E.Command) => {
    if (s.source !== null) return;
    ed.current?.run(cmd);
  };
  const openLink = () => {
    const st = ed.current?.view.state;
    setLink(st ? (E.linkAt(st)?.href ?? '') : '');
  };
  const applyLink = (href: string) => {
    setLink(null);
    ed.current?.run(E.setLink(href));
  };

  const toggleSource = () => {
    if (s.source === null) {
      s.source = ed.current!.markdown();
      setSource(s.source);
    } else {
      const md = s.source;
      s.source = null;
      setSource(null);
      ed.current!.setMarkdown(md);
      ed.current!.view.focus();
    }
  };

  const resolve = (how: 'mine' | 'theirs' | 'both') => {
    const c = s.conflict!;
    s.conflict = null;
    setConflict(null);
    requestAnimationFrame(() => ed.current?.view.focus());
    const mine = text();
    if (how === 'theirs') {
      s.source = null;
      setSource(null);
      ed.current!.setMarkdown(c.text); // undo brings yours back
      s.savedSeq = s.seq;
      s.savedText = c.text;
      s.base = c.version;
      writeDraft();
      setStatus('saved');
      return;
    }
    s.base = c.version;
    if (how === 'both') {
      const when = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const merged = `${c.text.trimEnd()}\n\n---\n\n**My copy (this device, ${when}):**\n\n${mine}`;
      if (s.source !== null) {
        s.source = merged;
        setSource(merged);
        s.seq++;
      } else ed.current!.setMarkdown(merged);
    } else s.seq++;
    save();
  };

  // ---------- desktop height ----------

  const [height, setH] = useState<number | null>(() => (phone ? null : getHeight(target.place)));
  const drag = useRef<{ y: number; h: number } | null>(null);
  const sizeBy = (dh: number) => {
    const h = Math.max(120, Math.min(window.innerHeight * 0.9, (scroller.current?.offsetHeight ?? 300) + dh));
    setH(h);
    setHeight(target.place, h);
  };

  // ---------- toolbar ----------

  const st = ed.current?.view.state;
  const block = st ? E.blockKind(st) : 'p';
  const list = st ? E.listKind(st) : null;
  const has = (t: keyof typeof schema.marks) => (st ? E.markActive(st, schema.marks[t]) : false);
  const off = source !== null;

  const textItems: MenuEntry[] = [
    { label: 'Text', kind: 'radio', checked: block === 'p', hint: `${MOD}+${ALT}+0`, run: () => run(E.setBlock('p')) },
    { label: <span class="ed-l-h1">Heading 1</span>, text: 'Heading 1', kind: 'radio', checked: block === 'h1', hint: `${MOD}+${ALT}+1`, run: () => run(E.setBlock('h1')) },
    { label: <span class="ed-l-h2">Heading 2</span>, text: 'Heading 2', kind: 'radio', checked: block === 'h2', hint: `${MOD}+${ALT}+2`, run: () => run(E.setBlock('h2')) },
    { label: <span class="ed-l-h3">Heading 3</span>, text: 'Heading 3', kind: 'radio', checked: block === 'h3', hint: `${MOD}+${ALT}+3`, run: () => run(E.setBlock('h3')) },
    { label: <span class="ed-l-quote">Quote</span>, text: 'Quote', kind: 'radio', checked: block === 'quote', hint: '> ', run: () => run(E.setBlock('quote')) },
    { label: <span class="ed-l-code">Code block</span>, text: 'Code block', kind: 'radio', checked: block === 'code', hint: '``` ', run: () => run(E.setBlock('code')) },
  ];
  const listItems: MenuEntry[] = [
    { label: '•  Bullet list', text: 'Bullet list', kind: 'radio', checked: list === 'bullet', hint: '- ', run: () => run(E.setList('bullet')) },
    { label: '1. Numbered list', text: 'Numbered list', kind: 'radio', checked: list === 'ordered', hint: '1. ', run: () => run(E.setList('ordered')) },
    { label: '☐  Checklist', text: 'Checklist', kind: 'radio', checked: list === 'check', hint: '[ ] ', run: () => run(E.setList('check')) },
    'sep',
    { label: 'Indent', hint: 'Tab', disabled: !list, run: () => run(E.indent) },
    { label: 'Outdent', hint: '⇧+Tab', disabled: !list, run: () => run(E.outdent) },
  ];
  const insertItems: MenuEntry[] = [
    { label: 'Link…', hint: `${MOD}+K`, run: openLink },
    { label: 'Checklist', hint: '[ ] ', run: () => run(E.setList('check')) },
    { label: 'Divider line', hint: '---', run: () => run(E.insertRule) },
    { label: 'Code block', hint: '``` ', run: () => run(E.setBlock('code')) },
    { label: <code>Inline code</code>, text: 'Inline code', hint: `${MOD}+E`, run: () => run(E.toggle(schema.marks.code)) },
  ];
  const moreItems: MenuEntry[] = [
    {
      label: 'Copy as Markdown',
      run: async () => {
        const ok = await copyText(text());
        setStatus(ok ? 'copied' : 'error');
        ed.current?.view.focus();
      },
    },
    { label: 'Edit Markdown source', kind: 'check', checked: source !== null, run: toggleSource },
    ...(paperOn ? (['sep', { heading: 'Paper' }, ...PAPERS.map((p) => ({ label: p.label, kind: 'radio' as const, checked: paperId === p.id, run: () => (setPaper(p.id), ed.current?.view.focus()) }))] as MenuEntry[]) : []),
    ...(!phone ? (['sep', { label: 'Full screen', kind: 'check', checked: full, hint: full ? 'Esc' : undefined, run: () => setFull(!full) }] as MenuEntry[]) : []),
  ];

  const blockLabel = { p: 'Text', h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', quote: 'Quote', code: 'Code' }[block];
  const markBtn = (t: 'strong' | 'em' | 'strike', label: string, title: string, cls: string) => (
    <button type="button" class={`ed-tb ${cls}`} aria-pressed={has(t)} title={title} aria-label={title} disabled={off} onClick={() => run(E.toggle(schema.marks[t]))}>
      {label}
    </button>
  );
  const undoBtns = (
    <>
      <button type="button" class="ed-tb" title={`Undo (${MOD}+Z)`} aria-label="Undo" disabled={off || !st || !E.canUndo(st)} onClick={() => run(E.undo)}>
        ↶
      </button>
      <button type="button" class="ed-tb" title={`Redo (${MOD}+⇧+Z)`} aria-label="Redo" disabled={off || !st || !E.canRedo(st)} onClick={() => run(E.redo)}>
        ↷
      </button>
    </>
  );
  const statusText =
    status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'copied' ? 'Copied as Markdown' : status === 'error' ? 'Not saved yet: kept on this device' : dirty() ? 'Editing…' : '';

  const toolbar = (
    <div
      class="ed-bar"
      role="toolbar"
      aria-label="Formatting"
      onMouseDown={(e) => (e.target as HTMLElement).closest('button') && e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if ((e.target as HTMLElement).closest('[role=menu]')) return;
        const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button:not([disabled]), :scope > .ed-menu > button')];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (i < 0) return;
        e.preventDefault();
        btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length].focus();
      }}
    >
      <Menu id="ed-text" label={<span class="ed-block-label">{blockLabel}</span>} title="Text style" items={textItems} open={menu} setOpen={setMenu} up={phone} class={off ? 'off' : ''} />
      {markBtn('strong', 'B', `Bold (${MOD}+B)`, 'ed-b')}
      {markBtn('em', 'I', `Italic (${MOD}+I)`, 'ed-i')}
      {markBtn('strike', 'S', `Strikethrough (${MOD}+⇧+X)`, 'ed-s')}
      <Menu id="ed-lists" label="Lists" title="Lists" items={listItems} open={menu} setOpen={setMenu} up={phone} class={off ? 'off' : ''} />
      <Menu id="ed-insert" label="Insert" title="Insert" items={insertItems} open={menu} setOpen={setMenu} up={phone} class={off ? 'off' : ''} />
      <span class="ed-gap" />
      {!phone && undoBtns}
      <Menu id="ed-more" label="⋯" title="More" items={moreItems} open={menu} setOpen={setMenu} up={phone} align="end" class="ed-more" />
    </div>
  );

  return (
    <div
      ref={shell}
      class={`ed is-editing paper-${paperOn ? paperId : 'plain'} ${full ? 'is-full' : ''} ${phone ? 'is-phone' : ''}`}
      onKeyDown={(e) => {
        // Escape that a menu or the link form did not take (they stop it): leave full screen on a
        // desktop, else stop editing. (ProseMirror always marks Escape as handled, so that is not checked.)
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        if (menu) return setMenu(null);
        if (full && !phone) setFull(false);
        else finish();
      }}
    >
      {phone && (
        <div class="ed-head">
          <button type="button" class="primary small" onClick={finish}>
            Done
          </button>
          <span class="ed-status" role="status">
            {statusText}
          </span>
          {undoBtns}
        </div>
      )}
      {!phone && toolbar}
      {link !== null && <LinkForm href={link} onApply={applyLink} onCancel={() => (setLink(null), ed.current?.view.focus())} />}
      {conflict && <ConflictBox theirs={conflict.text} onPick={resolve} />}
      <div
        ref={scroller}
        class={`ed-scroll ${height && !full && !phone ? 'has-height' : ''}`}
        style={!full && !phone ? (height ? { height: `${height}px` } : { minHeight: `${rows * 1.75 + 1}rem` }) : undefined}
        onMouseDown={(e) => {
          // a click below the text puts the cursor at the end
          if (e.target === scroller.current && ed.current) {
            e.preventDefault();
            const v = ed.current.view;
            v.dispatch(v.state.tr.setSelection(E.selectionAtEnd(v.state.doc)));
            v.focus();
          }
        }}
      >
        <div ref={mount} class="ed-mount" hidden={source !== null} />
        {source !== null && (
          <textarea
            class="ed-source"
            aria-label="Markdown source"
            value={source}
            autoFocus
            onInput={(e) => {
              s.source = (e.target as HTMLTextAreaElement).value;
              setSource(s.source);
              changed();
            }}
          />
        )}
      </div>
      {phone && toolbar}
      {!phone && (
        <div class="ed-foot">
          <span class="ed-status" role="status">
            {statusText}
          </span>
          {!full && (
            <div
              class="ed-grip"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the editor (↑ ↓; double-click to reset)"
              tabIndex={0}
              title="Drag to resize; double-click to reset"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                drag.current = { y: e.clientY, h: scroller.current!.offsetHeight };
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                setH(Math.max(120, Math.min(window.innerHeight * 0.9, drag.current.h + e.clientY - drag.current.y)));
              }}
              onPointerUp={() => {
                if (drag.current) setHeight(target.place, scroller.current!.offsetHeight);
                drag.current = null;
              }}
              onDblClick={() => (setH(null), setHeight(target.place, null))}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  sizeBy(e.key === 'ArrowDown' ? 40 : -40);
                }
              }}
            />
          )}
          <button type="button" class="small" onClick={finish}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function LinkForm({ href, onApply, onCancel }: { href: string; onApply: (h: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(href);
  return (
    <form
      class="ed-link"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <input type="text" inputMode="url" value={v} autoFocus placeholder="Paste or type a link" aria-label="Link address" onInput={(e) => setV((e.target as HTMLInputElement).value)} />
      <button type="submit" class="small primary">
        {href ? 'Change' : 'Add link'}
      </button>
      {href && (
        <button type="button" class="small" onClick={() => onApply('')}>
          Remove
        </button>
      )}
      <button type="button" class="small ghost" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function ConflictBox({ theirs, onPick }: { theirs: string; onPick: (how: 'mine' | 'theirs' | 'both') => void }) {
  const [show, setShow] = useState(false);
  return (
    <div class="ed-conflict" role="alertdialog" aria-labelledby="ed-conflict-title" aria-describedby="ed-conflict-text">
      <strong id="ed-conflict-title">This note changed somewhere else</strong>
      <p id="ed-conflict-text">
        Another device or Claude saved it while you were editing. Your text is safe. Which version should be kept?
      </p>
      <div class="row">
        <button type="button" class="small primary" onClick={() => onPick('mine')}>
          Keep mine
        </button>
        <button type="button" class="small" onClick={() => onPick('theirs')}>
          Use theirs
        </button>
        <button type="button" class="small" onClick={() => onPick('both')}>
          Keep both
        </button>
        <button type="button" class="small ghost" aria-expanded={show} onClick={() => setShow(!show)}>
          {show ? 'Hide theirs' : 'Show theirs'}
        </button>
      </div>
      {show && <pre class="ed-theirs">{theirs || '(empty)'}</pre>}
    </div>
  );
}
