// Markdown ⇄ editor document. Parsing uses `marked` (the same reader that shows notes in the
// app, with the same options), so the editor shows what the note view shows. Writing is our
// own: it keeps the author's choices (bullet character, * or _, fences) so opening and
// saving a note does not rewrite it, and each block is checked by reading it back; if the
// light escaping was not enough, that block is written again with full escaping.
import { Lexer, type Token, type Tokens } from 'marked';
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';

const n = schema.nodes;
const m = schema.marks;

// ---------- Markdown → document ----------

const lex = (src: string): Token[] => new Lexer({ gfm: true, breaks: true }).lex(src.replace(/\r\n?/g, '\n'));

export function parseMarkdown(src: string): PMNode {
  const blocks = parseBlocks(lex(src || ''));
  return n.doc.create(null, blocks.length ? blocks : [n.paragraph.create()]);
}

function parseBlocks(tokens: Token[]): PMNode[] {
  const out: PMNode[] = [];
  for (const t of tokens) {
    const b = parseBlock(t);
    if (b) out.push(b);
  }
  return out;
}

const fenceOf = (raw: string) => {
  const f = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
  return f ? f[1] : '';
};

function parseBlock(t: Token): PMNode | null {
  switch (t.type) {
    case 'space':
      return null;
    case 'paragraph':
    case 'text':
      return n.paragraph.create(null, inline((t as Tokens.Paragraph).tokens ?? [{ type: 'text', raw: t.raw, text: (t as Tokens.Text).text } as Token]));
    case 'heading':
      return n.heading.create({ level: (t as Tokens.Heading).depth }, inline((t as Tokens.Heading).tokens));
    case 'code': {
      const c = t as Tokens.Code;
      return n.code_block.create({ lang: (c.lang ?? '').trim(), fence: fenceOf(c.raw) }, c.text ? schema.text(c.text) : null);
    }
    case 'hr':
      return n.horizontal_rule.create({ markup: t.raw.trim() });
    case 'blockquote': {
      const inner = parseBlocks((t as Tokens.Blockquote).tokens);
      return n.blockquote.create(null, inner.length ? inner : [n.paragraph.create()]);
    }
    case 'list': {
      const l = t as Tokens.List;
      const items = l.items.map(parseItem);
      if (l.ordered) {
        const delim = /^\s*\d+([.)])/.exec(l.raw)?.[1] ?? '.';
        return n.ordered_list.create({ tight: !l.loose, start: Number(l.start) || (l.start === 0 ? 0 : 1), delim }, items);
      }
      const bullet = /^\s*([-+*])/.exec(l.raw)?.[1] ?? '-';
      return n.bullet_list.create({ tight: !l.loose, bullet }, items);
    }
    default:
      // table, html, def and anything newer: keep the source exactly.
      return n.raw_block.create({ text: t.raw.replace(/\n+$/, ''), kind: t.type });
  }
}

function parseItem(item: Tokens.ListItem): PMNode {
  let checked: boolean | null = item.task ? !!item.checked : null;
  const tokens = item.tokens.filter((x) => x.type !== 'checkbox');
  let blocks = parseBlocks(tokens);
  // "- [ ]" with nothing after it is an empty checklist item (marked reads it as text).
  if (checked === null && blocks.length === 1 && blocks[0].type === n.paragraph) {
    const box = /^\[( |x|X)\]\s*$/.exec(blocks[0].textContent);
    if (box && blocks[0].childCount <= 1) {
      checked = box[1] !== ' ';
      blocks = [n.paragraph.create()];
    }
  }
  if (!blocks.length || blocks[0].type !== n.paragraph) blocks.unshift(n.paragraph.create());
  return n.list_item.create({ checked }, blocks);
}

function inline(tokens: Token[], marks: readonly Mark[] = []): PMNode[] {
  const out: PMNode[] = [];
  const text = (s: string, ms: readonly Mark[] = marks) => s && out.push(schema.text(s, ms));
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
      case 'escape':
        if ((t as Tokens.Text).tokens?.length) out.push(...inline((t as Tokens.Text).tokens!, marks));
        else text((t as Tokens.Text).text);
        break;
      case 'strong':
        out.push(...inline((t as Tokens.Strong).tokens, m.strong.create({ markup: t.raw.slice(0, 2) }).addToSet(marks)));
        break;
      case 'em':
        out.push(...inline((t as Tokens.Em).tokens, m.em.create({ markup: t.raw[0] }).addToSet(marks)));
        break;
      case 'del':
        out.push(...inline((t as Tokens.Del).tokens, m.strike.create({ markup: t.raw.startsWith('~~') ? '~~' : '~' }).addToSet(marks)));
        break;
      case 'codespan':
        text((t as Tokens.Codespan).text, m.code.create().addToSet(marks));
        break;
      case 'br':
        out.push(n.hard_break.create(null, null, marks));
        break;
      case 'link': {
        const l = t as Tokens.Link;
        const auto = l.raw.startsWith('<') ? 'angle' : l.raw.startsWith('[') ? '' : 'bare';
        out.push(...inline(l.tokens, m.link.create({ href: l.href, title: l.title ?? null, auto }).addToSet(marks)));
        break;
      }
      case 'image': {
        const i = t as Tokens.Image;
        out.push(n.image.create({ src: i.href, alt: i.text ?? '', title: i.title ?? null }, null, marks));
        break;
      }
      case 'checkbox':
        break;
      case 'html':
        out.push(n.raw_inline.create({ text: t.raw }, null, marks));
        break;
      default:
        text(t.raw);
    }
  }
  return out;
}

// ---------- document → Markdown ----------

export function serializeMarkdown(doc: PMNode): string {
  const parts: string[] = [];
  let prev: PMNode | null = null;
  doc.forEach((block) => {
    if (isEmptyPara(block)) return;
    block = separateLists(prev, block);
    parts.push(verifiedBlock(block));
    prev = block;
  });
  return parts.join('\n\n');
}

const isEmptyPara = (b: PMNode) => b.type === n.paragraph && b.childCount === 0;

/** Two lists in a row of the same kind would read back as one; switch the marker of the second. */
function separateLists(prev: PMNode | null, b: PMNode): PMNode {
  if (!prev || prev.type !== b.type) return b;
  if (b.type === n.bullet_list && prev.attrs.bullet === b.attrs.bullet) return b.type.create({ ...b.attrs, bullet: b.attrs.bullet === '-' ? '*' : '-' }, b.content);
  if (b.type === n.ordered_list && prev.attrs.delim === b.attrs.delim) return b.type.create({ ...b.attrs, delim: b.attrs.delim === '.' ? ')' : '.' }, b.content);
  return b;
}

/** Write one top-level block, read it back, and use full escaping if the light one changed it. */
function verifiedBlock(b: PMNode): string {
  const light = block(b, false);
  if (b.type === n.raw_block || b.type === n.code_block || b.type === n.horizontal_rule) return light;
  const want = canon(Fragment.from(b));
  if (canon(parseMarkdown(light).content) === want) return light;
  const full = block(b, true);
  return canon(parseMarkdown(full).content) === want ? full : light;
}

/** A comparable form of a fragment: ignores the author's marker choices and bare links (which Markdown makes by itself). */
function canon(f: Fragment): string {
  const IGNORE = new Set(['markup', 'bullet', 'delim', 'fence', 'auto']);
  const walk = (node: PMNode): unknown => {
    const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([k]) => !IGNORE.has(k)));
    const marks = node.marks
      .filter((mk) => !(mk.type === m.link && mk.attrs.auto === 'bare'))
      .map((mk) => [mk.type.name, mk.type === m.link ? mk.attrs.href : null]);
    if (node.isText) return [node.text, marks];
    const kids: unknown[] = [];
    node.forEach((c) => {
      if (c.type === n.paragraph && c.childCount === 0 && node.type !== n.list_item) return;
      kids.push(walk(c));
    });
    return [node.type.name, attrs, marks, mergeText(kids)];
  };
  const out: unknown[] = [];
  f.forEach((c) => {
    if (!isEmptyPara(c)) out.push(walk(c));
  });
  return JSON.stringify(out);
}

/** Adjacent text with the same marks compares equal however it was split. */
function mergeText(kids: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const k of kids) {
    const last = out[out.length - 1];
    if (Array.isArray(k) && typeof k[0] === 'string' && k.length === 2 && Array.isArray(last) && typeof last[0] === 'string' && last.length === 2 && JSON.stringify(last[1]) === JSON.stringify(k[1]))
      out[out.length - 1] = [last[0] + k[0], k[1]];
    else out.push(k);
  }
  return out;
}

function block(b: PMNode, full: boolean): string {
  switch (b.type) {
    case n.paragraph:
      return inlineMd(b, full);
    case n.heading: {
      let text = inlineMd(b, full, true).replace(/\n/g, ' ');
      if (/(^|\s)#+\s*$/.test(text)) text = text.replace(/(#+)(\s*)$/, (_, h, s) => `${h.replace(/#/g, '\\#')}${s}`);
      return `${'#'.repeat(b.attrs.level)}${text ? ' ' + text : ''}`;
    }
    case n.code_block: {
      const longest = Math.max(0, ...(b.textContent.match(/`+/g) ?? []).map((s) => s.length));
      const tildes = String(b.attrs.fence).startsWith('~') && !/^~{3,}/m.test(b.textContent);
      const fence = tildes ? b.attrs.fence : '`'.repeat(Math.max(3, longest + 1, String(b.attrs.fence).startsWith('`') ? b.attrs.fence.length : 0));
      return `${fence}${b.attrs.lang}\n${b.textContent}${b.textContent ? '\n' : ''}${fence}`;
    }
    case n.horizontal_rule:
      return /^([-*_])( *\1){2,} *$/.test(b.attrs.markup) ? b.attrs.markup : '---';
    case n.raw_block:
      return b.attrs.text;
    case n.blockquote:
      return prefix(children(b, full, false, false), '> ', '> ', '>');
    case n.bullet_list:
    case n.ordered_list: {
      const items: string[] = [];
      b.forEach((item, _o, i) => {
        const marker = b.type === n.bullet_list ? `${b.attrs.bullet} ` : `${b.attrs.start + i}${b.attrs.delim} `;
        let body = children(item, full, b.attrs.tight, true);
        if (item.attrs.checked != null) body = `[${item.attrs.checked ? 'x' : ' '}]${body ? ' ' + body : ''}`;
        else if (/^\[( |x|X)\]/.test(body)) body = '\\' + body; // text that only looks like a checkbox
        items.push(prefix(body, marker, ' '.repeat(marker.length), ''));
      });
      return items.join(b.attrs.tight ? '\n' : '\n\n');
    }
    default:
      return b.textContent;
  }
}

/** The blocks inside a quote or list item. */
function children(b: PMNode, full: boolean, tight: boolean, keepFirst: boolean): string {
  const parts: string[] = [];
  let prev: PMNode | null = null;
  b.forEach((c, _o, i) => {
    if (isEmptyPara(c) && !(keepFirst && i === 0)) return;
    c = separateLists(prev, c);
    const md = block(c, full);
    if (parts.length) parts.push(tight && !(prev?.type === n.paragraph && c.type === n.paragraph) ? '\n' : '\n\n');
    parts.push(md);
    prev = c;
  });
  return parts.join('');
}

/** Put `first` before the first line and `rest` before the others (`empty` for empty lines). */
function prefix(text: string, first: string, rest: string, empty: string): string {
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? (line ? first + line : first.trimEnd()) : line ? rest + line : empty))
    .join('\n');
}

// ---------- inline ----------

const PUNCT = /[!-/:-@[-`{-~]/;
const isWs = (c: string | undefined) => c === undefined || /\s/.test(c);
const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

function escapeText(s: string, full: boolean, before: string | undefined, after: string | undefined): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = i ? s[i - 1] : before;
    const next = i + 1 < s.length ? s[i + 1] : after;
    let esc = false;
    if (c === '\\') esc = full || next === undefined || PUNCT.test(next) || next === '\n';
    else if (c === '`') esc = true;
    else if (c === '*') esc = full || !(isWs(prev) && isWs(next));
    else if (c === '_') esc = full || !((isAlnum(prev) && isAlnum(next)) || (isWs(prev) && isWs(next)));
    else if (c === '~') esc = full || next === '~' || prev === '~';
    else if (c === '<') esc = full || (next !== undefined && /[A-Za-z/!?]/.test(next));
    else if (c === '[' || c === ']' || c === '|') esc = full;
    else if (c === '&') esc = full && /^&(#\d+|#x[\da-f]+|\w+);/i.test(s.slice(i));
    out += esc ? '\\' + c : c;
  }
  return out;
}

/** Markdown that would start a block if it began a line. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)(#{1,6})(?=\s|$)/, (_, s, h) => `${s}\\${h}`)
    .replace(/^(\s*)([-+*])(?=\s|$)/, '$1\\$2')
    .replace(/^(\s*)(>)/, '$1\\$2')
    .replace(/^(\s*)(\d{1,9})([.)])(?=\s|$)/, '$1$2\\$3')
    .replace(/^(\s*)([-=])(?=[-=]*\s*$)/, '$1\\$2')
    .replace(/^(\s*)(~~~)/, '$1\\$2');
}

type Run = { node: PMNode; marks: readonly Mark[] };

function inlineMd(b: PMNode, full: boolean, inHeading = false): string {
  const runs: Run[] = [];
  b.forEach((c) => runs.push({ node: c, marks: c.marks }));
  // drop a trailing hard break: Markdown cannot keep it
  while (runs.length && runs[runs.length - 1].node.type === n.hard_break) runs.pop();

  let out = '';
  let active: Mark[] = [];
  const open = (mk: Mark, i: number): string => {
    if (mk.type === m.code) return '`'.repeat(codeTicks(runs, i));
    if (mk.type === m.link) {
      if (!isAutoLink(mk, runs, i)) return '[';
      // A bare address only links after a space, the line start or ( * _ ~; otherwise use <...>.
      return mk.attrs.auto === 'bare' && (out === '' || /[\s(*_~]$/.test(out)) ? '' : '<';
    }
    return delim(mk, full);
  };
  const autoOpen = new Map<Mark, string>();
  const close = (mk: Mark): string => {
    if (mk.type === m.code) return codeClose.pop() ?? '`';
    if (mk.type === m.link) {
      const a = autoOpen.get(mk);
      if (a !== undefined) return a === '<' ? '>' : '';
      const href = /[\s()<>]/.test(mk.attrs.href) ? `<${mk.attrs.href.replace(/[<>]/g, (c: string) => encodeURIComponent(c))}>` : mk.attrs.href;
      return `](${href}${mk.attrs.title ? ` "${String(mk.attrs.title).replace(/"/g, '\\"')}"` : ''})`;
    }
    return delim(mk, full);
  };
  const codeClose: string[] = [];

  for (let i = 0; i < runs.length; i++) {
    const { node } = runs[i];
    // Marks already open stay outside (so **a *b* c** keeps its shape); code always innermost.
    const own = runs[i].marks;
    let marks = [
      ...active.filter((a) => a.type !== m.code && a.isInSet(own)),
      ...own.filter((x) => x.type !== m.code && !x.isInSet(active)),
      ...own.filter((x) => x.type === m.code),
    ];
    let text = node.isText ? node.text! : '';
    const isCode = marks.some((x) => x.type === m.code);
    // Whitespace-only text keeps only the marks already open (no "** **").
    if (node.isText && !isCode && !text.trim()) marks = marks.filter((x) => active.includes(x) || x.type === m.link);
    let keep = 0;
    while (keep < active.length && keep < marks.length && active[keep].eq(marks[keep])) keep++;
    // Leading whitespace goes outside marks that are about to open, trailing outside marks that close.
    let lead = '';
    if (node.isText && !isCode && keep < marks.length) {
      lead = /^\s*/.exec(text)![0];
      text = text.slice(lead.length);
    }
    if (keep < active.length) {
      // move trailing whitespace of the output out of the closing marks
      const tail = /[ \t]*$/.exec(out)![0];
      const codeOpen = active.slice(keep).some((x) => x.type === m.code);
      if (tail && !codeOpen) out = out.slice(0, out.length - tail.length);
      for (let j = active.length - 1; j >= keep; j--) out += close(active[j]);
      if (tail && !codeOpen) out += tail;
      active = active.slice(0, keep);
    }
    out += lead;
    for (let j = keep; j < marks.length; j++) {
      const d = open(marks[j], i);
      if (marks[j].type === m.link && isAutoLink(marks[j], runs, i)) autoOpen.set(marks[j], d);
      if (marks[j].type === m.code) codeClose.push(d);
      out += d;
      active.push(marks[j]);
    }
    if (node.type === n.hard_break) {
      out = out.replace(/[ \t]+$/, '') + (inHeading ? ' ' : '\n');
      continue;
    }
    if (node.type === n.image) {
      out += `![${escapeText(node.attrs.alt ?? '', full, undefined, undefined).replace(/]/g, '\\]')}](${/[\s()]/.test(node.attrs.src) ? `<${node.attrs.src}>` : node.attrs.src}${node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : ''})`;
      continue;
    }
    if (node.type === n.raw_inline) {
      out += node.attrs.text;
      continue;
    }
    if (!node.isText) continue;
    if (isCode) {
      out += codeText(runs, i, text);
      continue;
    }
    if (active.some((x) => x.type === m.link && autoOpen.has(x))) {
      out += text;
      continue;
    }
    const nextNode = runs[i + 1]?.node;
    const after = nextNode?.isText ? nextNode.text![0] : nextNode ? 'x' : undefined;
    out += escapeText(text, full, out.slice(-1) || undefined, after);
  }
  for (let j = active.length - 1; j >= 0; j--) out += close(active[j]);
  if (inHeading) return out;
  // Escape what would start a block at the start of each line.
  return out
    .split('\n')
    .map((l) => escapeLineStart(l.replace(/[ \t]+$/, '')))
    .join('\n');
}

function delim(mk: Mark, full: boolean): string {
  if (mk.type === m.strong) return full ? '**' : mk.attrs.markup === '__' ? '__' : '**';
  if (mk.type === m.em) return full ? '*' : mk.attrs.markup === '_' ? '_' : '*';
  if (mk.type === m.strike) return mk.attrs.markup === '~' && !full ? '~' : '~~';
  return '';
}

/** The text of the code run starting at run i (one code span may cover several runs). */
function codeRun(runs: Run[], i: number): string {
  let s = '';
  const outer = runs[i].marks.filter((x) => x.type !== m.code);
  for (let j = i; j < runs.length; j++) {
    const r = runs[j];
    if (!r.node.isText || !r.marks.some((x) => x.type === m.code)) break;
    const o = r.marks.filter((x) => x.type !== m.code);
    if (o.length !== outer.length || o.some((x, k) => !x.eq(outer[k]))) break;
    s += r.node.text;
  }
  return s;
}

function codeTicks(runs: Run[], i: number): number {
  const s = codeRun(runs, i);
  let t = 1;
  const runsOfTicks = new Set((s.match(/`+/g) ?? []).map((x) => x.length));
  while (runsOfTicks.has(t)) t++;
  return t;
}

/** Code text; pad with a space when it starts or ends with a backtick (or both ends are spaces). */
function codeText(runs: Run[], i: number, text: string): string {
  const prevIsCode = i > 0 && runs[i - 1].node.isText && runs[i - 1].marks.some((x) => x.type === m.code);
  const whole = codeRun(runs, i);
  const isFirst = !prevIsCode || codeRun(runs, i - 1) === '' ;
  let s = text;
  const needPad = /^`|`$/.test(whole) || (/^ /.test(whole) && / $/.test(whole) && whole.trim() !== '');
  if (needPad && isFirst && whole.startsWith(text)) s = ' ' + s;
  const endsHere = !runs[i + 1] || !runs[i + 1].node.isText || !runs[i + 1].marks.some((x) => x.type === m.code);
  if (needPad && endsHere) s = s + ' ';
  return s.replace(/\n/g, ' ');
}

function isAutoLink(mk: Mark, runs: Run[], i: number): boolean {
  if (!mk.attrs.auto || mk.attrs.title) return false;
  let text = '';
  for (let j = i; j < runs.length; j++) {
    const r = runs[j];
    if (!r.marks.some((x) => x.eq(mk))) break;
    if (!r.node.isText || r.marks.length !== 1) return false;
    text += r.node.text;
  }
  const href = String(mk.attrs.href);
  if (!(text === href || `mailto:${text}` === href)) return false;
  return mk.attrs.auto === 'angle' || /^(https?:\/\/|www\.|mailto:)/i.test(href);
}
