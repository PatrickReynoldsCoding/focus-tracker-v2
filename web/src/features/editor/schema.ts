// The editor's document model (ProseMirror schema). It covers what notes use in Markdown;
// anything else (tables, HTML, link definitions) is kept as a raw block, shown as source
// and written back unchanged, so nothing is lost.
import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';

const safeSrc = (s: string) => (/^(https?:|data:image\/)/i.test(s) ? s : '');

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
  heading: {
    attrs: { level: { default: 1 } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (n) => [`h${n.attrs.level}`, 0],
  },
  blockquote: { content: 'block+', group: 'block', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
  code_block: {
    attrs: { lang: { default: '' }, fence: { default: '```' } },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: () => ['pre', ['code', 0]],
  },
  horizontal_rule: { attrs: { markup: { default: '---' } }, group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
  raw_block: {
    attrs: { text: { default: '' }, kind: { default: '' } },
    group: 'block',
    atom: true,
    selectable: true,
    toDOM: (n) => [
      'div',
      { class: 'ed-raw', contenteditable: 'false', title: 'Kept as Markdown. Edit it with ⋯ → Edit Markdown source.' },
      ['span', { class: 'ed-raw-label' }, n.attrs.kind === 'table' ? 'Table (Markdown)' : 'Markdown'],
      ['pre', n.attrs.text],
    ],
  },
  bullet_list: {
    attrs: { tight: { default: true }, bullet: { default: '-' } },
    content: 'list_item+',
    group: 'block',
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', 0],
  },
  ordered_list: {
    attrs: { tight: { default: true }, start: { default: 1 }, delim: { default: '.' } },
    content: 'list_item+',
    group: 'block',
    parseDOM: [{ tag: 'ol', getAttrs: (d) => ({ start: Number((d as HTMLElement).getAttribute('start') ?? 1) || 1 }) }],
    toDOM: (n) => ['ol', n.attrs.start === 1 ? {} : { start: n.attrs.start }, 0],
  },
  list_item: {
    attrs: { checked: { default: null } },
    content: 'paragraph block*',
    defining: true,
    parseDOM: [
      {
        tag: 'li',
        getAttrs: (d) => {
          const box = (d as HTMLElement).querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]') as HTMLInputElement | null;
          return { checked: box ? box.checked : null };
        },
      },
    ],
    toDOM: (n) =>
      n.attrs.checked == null
        ? ['li', 0]
        : [
            'li',
            { class: 'ed-task', 'data-checked': String(n.attrs.checked) },
            ['span', { class: 'ed-check', contenteditable: 'false', role: 'checkbox', 'aria-checked': String(n.attrs.checked), 'aria-label': 'Done' }],
            ['div', { class: 'ed-task-body' }, 0],
          ],
  },
  text: { group: 'inline' },
  hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  image: {
    inline: true,
    attrs: { src: {}, alt: { default: '' }, title: { default: null } },
    group: 'inline',
    draggable: true,
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (d) => ({ src: (d as HTMLElement).getAttribute('src'), alt: (d as HTMLElement).getAttribute('alt') ?? '', title: (d as HTMLElement).getAttribute('title') }),
      },
    ],
    toDOM: (n) => ['img', { src: safeSrc(n.attrs.src), alt: n.attrs.alt, title: n.attrs.title }],
  },
  raw_inline: { inline: true, atom: true, attrs: { text: { default: '' } }, group: 'inline', toDOM: (n) => ['span', { class: 'ed-raw-inline' }, n.attrs.text] },
};

// Order matters: Markdown is written with earlier marks outside later ones (code innermost).
const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: {}, title: { default: null }, auto: { default: '' } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (d) => ({ href: (d as HTMLElement).getAttribute('href'), title: (d as HTMLElement).getAttribute('title') }) }],
    toDOM: (m) => ['a', { href: m.attrs.href, title: m.attrs.title, rel: 'noopener noreferrer nofollow' }, 0],
  },
  em: {
    attrs: { markup: { default: '*' } },
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  strong: {
    attrs: { markup: { default: '**' } },
    parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (d) => (d as HTMLElement).style.fontWeight !== 'normal' && null }, { style: 'font-weight=bold' }, { style: 'font-weight=700' }],
    toDOM: () => ['strong', 0],
  },
  strike: { attrs: { markup: { default: '~~' } }, parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }], toDOM: () => ['s', 0] },
  code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
};

export const schema = new Schema({ nodes, marks });
