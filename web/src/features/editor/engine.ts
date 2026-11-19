// The ProseMirror side: commands for the toolbar, Markdown shortcuts as you type, keys,
// tickable checkboxes, Markdown on the clipboard. Loaded only when a note is edited.
import { baseKeymap, chainCommands, setBlockType, toggleMark, wrapIn, lift } from 'prosemirror-commands';
import { history, redo, undo, undoDepth, redoDepth } from 'prosemirror-history';
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Slice, type MarkType, type Node as PMNode, type NodeType } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { EditorState, Plugin, Selection, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown, serializeMarkdown } from './markdown';
import { schema } from './schema';

const n = schema.nodes;
const m = schema.marks;
export { undo, redo, parseMarkdown, serializeMarkdown };

// ---------- what the toolbar shows ----------

export type BlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote' | 'code';
export type ListKind = 'bullet' | 'ordered' | 'check' | null;

export function blockKind(state: EditorState): BlockKind {
  const { $from } = state.selection;
  const p = $from.parent;
  if (p.type === n.code_block) return 'code';
  if (p.type === n.heading) return p.attrs.level <= 3 ? (`h${p.attrs.level}` as BlockKind) : 'h4';
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === n.blockquote) return 'quote';
  return 'p';
}

function listAt(state: EditorState): { node: PMNode; pos: number; depth: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === n.bullet_list || node.type === n.ordered_list) return { node, pos: $from.before(d), depth: d };
  }
  return null;
}

function itemAt(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === n.list_item) return { node: $from.node(d), pos: $from.before(d) };
  return null;
}

export function listKind(state: EditorState): ListKind {
  const l = listAt(state);
  if (!l) return null;
  if (l.node.type === n.ordered_list) return 'ordered';
  return itemAt(state)?.node.attrs.checked != null ? 'check' : 'bullet';
}

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export const selectionAtEnd = (doc: PMNode) => Selection.atEnd(doc);
export const canUndo = (s: EditorState) => undoDepth(s) > 0;
export const canRedo = (s: EditorState) => redoDepth(s) > 0;

// ---------- commands ----------

const inQuote = (state: EditorState) => blockKind(state) === 'quote' || (() => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === n.blockquote) return true;
  return false;
})();

export function setBlock(kind: BlockKind): Command {
  return (state, dispatch) => {
    if (kind === 'quote') return inQuote(state) ? lift(state, dispatch) : wrapIn(n.blockquote)(state, dispatch);
    if (kind === 'code') return blockKind(state) === 'code' ? setBlockType(n.paragraph)(state, dispatch) : setBlockType(n.code_block)(state, dispatch);
    if (kind === 'p') return setBlockType(n.paragraph)(state, dispatch) || (inQuote(state) && lift(state, dispatch));
    const level = Number(kind.slice(1));
    const cur = state.selection.$from.parent;
    if (cur.type === n.heading && cur.attrs.level === level) return setBlockType(n.paragraph)(state, dispatch);
    return setBlockType(n.heading, { level })(state, dispatch);
  };
}

export const toggle = (type: MarkType): Command => toggleMark(type);

/** Make the lists in the selection a given kind, or take them out of the list when they are that kind already. */
export function setList(kind: Exclude<ListKind, null>): Command {
  return (state, dispatch) => {
    const type = kind === 'ordered' ? n.ordered_list : n.bullet_list;
    const l = listAt(state);
    if (l) {
      if (listKind(state) === kind) return liftListItem(n.list_item)(state, dispatch);
      if (dispatch) {
        const tr = state.tr.setNodeMarkup(l.pos, type, type === n.ordered_list ? { tight: l.node.attrs.tight } : { tight: l.node.attrs.tight });
        l.node.forEach((item, off) => {
          tr.setNodeMarkup(l.pos + 1 + off, undefined, { checked: kind === 'check' ? (item.attrs.checked ?? false) : null });
        });
        dispatch(tr);
      }
      return true;
    }
    return wrapInList(type)(state, (tr) => {
      if (kind === 'check') {
        const $pos = tr.selection.$from;
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d);
          if (node.type === n.bullet_list) {
            const start = $pos.before(d);
            node.forEach((_item, off) => tr.setNodeMarkup(start + 1 + off, undefined, { checked: false }));
            break;
          }
        }
      }
      dispatch?.(tr);
    });
  };
}

export const indent: Command = (s, d) => sinkListItem(n.list_item)(s, d);
export const outdent: Command = (s, d) => liftListItem(n.list_item)(s, d);

export const toggleCheck: Command = (state, dispatch) => {
  const it = itemAt(state);
  if (!it || it.node.attrs.checked == null) return false;
  dispatch?.(state.tr.setNodeMarkup(it.pos, undefined, { checked: !it.node.attrs.checked }));
  return true;
};

export const insertRule: Command = (state, dispatch) => {
  if (!dispatch) return true;
  const { $from } = state.selection;
  const tr = state.tr;
  if ($from.parent.type === n.paragraph && $from.parent.content.size === 0 && $from.depth === 1) {
    tr.replaceWith($from.before(), $from.after(), [n.horizontal_rule.create(), n.paragraph.create()]);
    tr.setSelection(TextSelection.create(tr.doc, $from.before() + 2));
  } else {
    tr.replaceSelectionWith(n.horizontal_rule.create());
    const after = tr.selection.$from;
    if (!after.nodeAfter || !after.nodeAfter.isTextblock) tr.insert(after.pos, n.paragraph.create()).setSelection(TextSelection.create(tr.doc, after.pos + 1));
  }
  dispatch(tr.scrollIntoView());
  return true;
};

/** The link at the cursor or selection: its href and the whole range it covers. */
export function linkAt(state: EditorState): { href: string; from: number; to: number } | null {
  const { $from, from, to } = state.selection;
  const mark = m.link.isInSet($from.marks()) ?? m.link.isInSet($from.nodeAfter?.marks ?? []);
  if (!mark) return null;
  let start = from;
  let end = to;
  const base = $from.start();
  $from.parent.forEach((child, off) => {
    if (!mark.isInSet(child.marks)) return;
    const a = base + off;
    const b = a + child.nodeSize;
    if (b >= start && a <= end) {
      start = Math.min(start, a);
      end = Math.max(end, b);
    }
  });
  return { href: mark.attrs.href, from: start, to: end };
}

export function setLink(href: string): Command {
  return (state, dispatch) => {
    const url = href.trim();
    const cur = linkAt(state);
    const tr = state.tr;
    if (!url) {
      if (!cur) return false;
      dispatch?.(tr.removeMark(cur.from, cur.to, m.link));
      return true;
    }
    const full = /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/') ? url : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? `mailto:${url}` : `https://${url}`;
    const mark = m.link.create({ href: full });
    if (cur) tr.removeMark(cur.from, cur.to, m.link).addMark(cur.from, cur.to, mark);
    else if (state.selection.empty) {
      const text = url;
      tr.insert(state.selection.from, schema.text(text, [mark, ...state.selection.$from.marks().filter((x) => x.type !== m.link)]));
      tr.removeStoredMark(m.link);
    } else tr.addMark(state.selection.from, state.selection.to, mark);
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

// ---------- Markdown as you type ----------

function markRule(re: RegExp, type: MarkType, delim: number, attrs?: Record<string, unknown>): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const lead = match[1] ?? '';
    const inner = match[2];
    const s = start + lead.length;
    const $s = state.doc.resolve(s);
    if ($s.parent.type.spec.code) return null;
    const tr = state.tr;
    // the closing delimiter typed so far is delim-1 characters before `end` (the last one is the key being pressed)
    if (delim > 1) tr.delete(end - (delim - 1), end);
    tr.delete(s, s + delim);
    tr.addMark(s, s + inner.length, type.create(attrs));
    tr.removeStoredMark(type);
    return tr;
  });
}

const hrRule = new InputRule(/^(?:---|\*\*\*|___)$/, (state, _m, start) => {
  const $s = state.doc.resolve(start);
  if ($s.parent.type !== n.paragraph || $s.depth !== 1) return null;
  const tr = state.tr.replaceWith($s.before(), $s.after(), [n.horizontal_rule.create(), n.paragraph.create()]);
  return tr.setSelection(TextSelection.create(tr.doc, $s.before() + 2));
});
const checkRule = new InputRule(/^\[( |x|X)?\]\s$/, (state, match, start, end) => {
  const checked = (match[1] ?? ' ').toLowerCase() === 'x';
  const $s = state.doc.resolve(start);
  if ($s.parent.type !== n.paragraph) return null;
  const item = $s.depth >= 2 ? $s.node($s.depth - 1) : null;
  if (item?.type === n.list_item && $s.index($s.depth - 1) === 0) {
    return state.tr.delete(start, end).setNodeMarkup($s.before($s.depth - 1), undefined, { checked });
  }
  let tr: Transaction | null = null;
  const st = state.apply(state.tr.delete(start, end));
  wrapInList(n.bullet_list)(st, (t) => (tr = t));
  if (!tr) return null;
  const out = state.tr.delete(start, end);
  (tr as Transaction).steps.forEach((step) => out.step(step));
  const $p = out.selection.$from;
  for (let d = $p.depth; d > 0; d--)
    if ($p.node(d).type === n.list_item) {
      out.setNodeMarkup($p.before(d), undefined, { checked });
      break;
    }
  return out;
});

const rules = inputRules({
  rules: [
    textblockTypeInputRule(/^(#{1,6})\s$/, n.heading, (mt) => ({ level: mt[1].length })),
    wrappingInputRule(/^\s*([-+*])\s$/, n.bullet_list, (mt) => ({ bullet: mt[1] })),
    wrappingInputRule(/^(\d+)([.)])\s$/, n.ordered_list, (mt) => ({ start: +mt[1], delim: mt[2] }), (mt, node) => node.childCount + node.attrs.start === +mt[1]),
    wrappingInputRule(/^\s*>\s$/, n.blockquote),
    textblockTypeInputRule(/^```([\w+-]*)\s$/, n.code_block, (mt) => ({ lang: mt[1] })),
    checkRule,
    hrRule,
    markRule(/(^|[^*\w])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, m.strong, 2),
    markRule(/(^|[^_\w])__([^_\s](?:[^_]*[^_\s])?)__$/, m.strong, 2, { markup: '__' }),
    markRule(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, m.em, 1),
    markRule(/(^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, m.em, 1, { markup: '_' }),
    markRule(/(^|[^~])~~([^~\s](?:[^~]*[^~\s])?)~~$/, m.strike, 2),
    markRule(/(^|[^`])`([^`]+)`$/, m.code, 1),
  ],
});

// ---------- keys ----------

const enterInList: Command = (state, dispatch) => {
  const it = itemAt(state);
  if (!it) return false;
  return splitListItem(n.list_item, it.node.attrs.checked != null ? { checked: false } : undefined)(state, dispatch);
};

const backspaceAtStart: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor || $cursor.parentOffset > 0) return false;
  if ($cursor.parent.type === n.heading || $cursor.parent.type === n.code_block) return setBlockType(n.paragraph)(state, dispatch);
  const it = itemAt(state);
  if (it && $cursor.index($cursor.depth - 1) === 0 && $cursor.node($cursor.depth - 1).type === n.list_item) {
    if (it.node.attrs.checked != null) {
      dispatch?.(state.tr.setNodeMarkup(it.pos, undefined, { checked: null }));
      return true;
    }
    return liftListItem(n.list_item)(state, dispatch);
  }
  return false;
};

const hardBreak: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type.spec.code) return false;
  dispatch?.(state.tr.replaceSelectionWith(n.hard_break.create()).scrollIntoView());
  return true;
};

export interface Hooks {
  onLink: () => void;
}

function keys(h: Hooks) {
  return keymap({
    'Mod-z': undo,
    'Shift-Mod-z': redo,
    'Mod-y': redo,
    'Mod-b': toggleMark(m.strong),
    'Mod-i': toggleMark(m.em),
    'Mod-Shift-x': toggleMark(m.strike),
    'Mod-e': toggleMark(m.code),
    'Mod-k': () => (h.onLink(), true),
    'Mod-Alt-0': setBlock('p'),
    'Mod-Alt-1': setBlock('h1'),
    'Mod-Alt-2': setBlock('h2'),
    'Mod-Alt-3': setBlock('h3'),
    'Mod-Shift-7': setList('ordered'),
    'Mod-Shift-8': setList('bullet'),
    'Mod-Shift-9': setList('check'),
    'Mod-Enter': toggleCheck,
    'Shift-Enter': hardBreak,
    Enter: enterInList,
    Tab: indent,
    'Shift-Tab': outdent,
    Backspace: chainCommands(undoInputRule, backspaceAtStart),
  });
}

// ---------- checkboxes, clipboard ----------

const checkboxes = new Plugin({
  props: {
    handleDOMEvents: {
      mousedown(view, e) {
        const box = (e.target as HTMLElement).closest?.('.ed-check');
        if (!box) return false;
        e.preventDefault();
        const li = box.parentElement!;
        const pos = view.posAtDOM(li, 0);
        const $pos = view.state.doc.resolve(pos);
        for (let d = $pos.depth; d >= 0; d--) {
          const node = $pos.node(d);
          if (node.type === n.list_item) {
            view.dispatch(view.state.tr.setNodeMarkup($pos.before(d), undefined, { checked: !node.attrs.checked }));
            return true;
          }
        }
        // posAtDOM(li, 0) may land just before the item
        const after = $pos.nodeAfter;
        if (after?.type === n.list_item) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { checked: !after.attrs.checked }));
        return true;
      },
    },
  },
});

function sliceToMarkdown(slice: Slice): string {
  try {
    let content = slice.content;
    if (content.firstChild?.isInline) content = Fragment.from(n.paragraph.create(null, content));
    return serializeMarkdown(n.doc.create(null, content));
  } catch {
    return slice.content.textBetween(0, slice.content.size, '\n\n');
  }
}

// ---------- the view ----------

// Escape is left to the editor's shell (leave full screen, stop editing), not "select the parent node".
const { Escape: _escape, ...baseKeys } = baseKeymap;

export interface Editor {
  view: EditorView;
  markdown(): string;
  setMarkdown(md: string, opts?: { history?: boolean }): void;
  run(cmd: Command): boolean;
  destroy(): void;
}

export function createEditor(
  place: HTMLElement,
  md: string,
  opts: { placeholder?: string; label?: string; onChange: (docChanged: boolean) => void; hooks: Hooks },
): Editor {
  const makeState = (doc: PMNode) =>
    EditorState.create({
      doc,
      plugins: [rules, keys(opts.hooks), keymap(baseKeys), history(), checkboxes, placeholderPlugin(opts.placeholder ?? '')],
    });
  const view: EditorView = new EditorView(place, {
    state: makeState(parseMarkdown(md)),
    attributes: { class: 'ed-doc md', role: 'textbox', 'aria-multiline': 'true', 'aria-label': opts.label ?? 'Note', spellcheck: 'true' },
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      opts.onChange(tr.docChanged && tr.getMeta('addToHistory') !== false);
    },
    clipboardTextSerializer: sliceToMarkdown,
    clipboardTextParser(text, $context, plain) {
      if (plain || $context.parent.type.spec.code) return new Slice(Fragment.from(schema.text(text.replace(/\r\n?/g, '\n'))), 0, 0);
      const doc = parseMarkdown(text);
      return Slice.maxOpen(doc.content);
    },
  });
  return {
    view,
    markdown: () => serializeMarkdown(view.state.doc),
    setMarkdown(text, o) {
      const doc = parseMarkdown(text);
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
      if (o?.history === false) tr.setMeta('addToHistory', false);
      view.dispatch(tr);
    },
    run(cmd) {
      const ok = cmd(view.state, view.dispatch, view);
      view.focus();
      return ok;
    },
    destroy: () => view.destroy(),
  };
}

function placeholderPlugin(text: string) {
  return new Plugin({
    props: {
      attributes(state): Record<string, string> {
        const d = state.doc;
        const empty = d.childCount === 1 && d.firstChild!.type === n.paragraph && d.firstChild!.content.size === 0;
        return empty && text ? { 'data-placeholder': text, class: 'ed-empty' } : {};
      },
    },
  });
}

export type { Command, NodeType };
