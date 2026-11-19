// The note editor's Markdown round trip (web/src/features/editor/markdown.ts):
// Markdown → editor document → Markdown must not lose or change content.
import { marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeMarkdown } from '../web/src/features/editor/markdown';

const rt = (md: string) => serializeMarkdown(parseMarkdown(md));
const html = (md: string) => (marked.parse(md, { gfm: true, breaks: true, async: false }) as string).replace(/\n+/g, '\n').trim();

// Notes written the way the owner and Claude write them: these must come back byte for byte.
const exact: Record<string, string> = {
  empty: '',
  plain: 'Just a line of text.',
  lines: 'First line\nsecond line\nthird line',
  headings: '# Project notes\n\n## Goals\n\nShip the editor.\n\n### Later\n\nMaybe tables.',
  marks: 'Some **bold**, some *italic*, some ~~struck~~ and `code`.',
  underscores: 'Some __bold__ and _italic_, a snake_case_name and file_name.txt.',
  links: 'See [the docs](https://example.com/docs "Docs") and https://example.com/bare and <https://example.com/angle>.',
  email: 'Write to someone@example.com about it.',
  bullets: '- one\n- two\n  - nested\n  - nested two\n- three',
  stars: '* one\n* two',
  numbered: '1. first\n2. second\n3. third',
  numberedFrom: '3) third\n4) fourth',
  checklist: '- [ ] buy milk\n- [x] call the bank\n- [ ] write **report**',
  emptyCheck: '- [ ] \n- [ ] something'.replace('[ ] \n', '[ ]\n'),
  quote: '> A quote\n> over two lines\n\nAfter it.',
  nestedQuote: '> Outer\n>\n> > Inner',
  code: '```js\nconst a = 1;\nconsole.log(`hi ${a}`);\n```',
  tildeCode: '~~~\nplain code\n~~~',
  rule: 'Above\n\n---\n\nBelow',
  starRule: 'Above\n\n***\n\nBelow',
  loose: '- one\n\n- two\n\n- three',
  itemParas: '- one\n\n  more about one\n- two'.replace('\n- two', '\n\n- two'),
  table: 'Before\n\n| Name | Done |\n|---|---|\n| A | yes |\n| B | no |\n\nAfter',
  html: '<details>\n<summary>More</summary>\nHidden\n</details>',
  inlineHtml: 'Press <kbd>Ctrl</kbd> + <kbd>B</kbd>.',
  image: '![A cat](https://example.com/cat.png "Cat")',
  mixedNesting: '- **Bold item** with *italic*\n  1. sub one\n  2. sub two\n- [ ] task with [link](https://a.b)',
  maths: 'Costs 2 * 3 = 6, and 5 - 2 = 3. 50% done & more.',
  claudeSummary:
    '## Session 18 Nov\n\n**Where I stopped:** wiring the conflict dialog.\n\n- [x] Schema\n- [x] Parser\n- [ ] Toolbar\n\n> Remember: notes are Markdown (D5).\n\nNext: `npm test`, then the phone check.',
  meeting:
    '# Call with the builder\n\nDate: 18/11/2026\n\n## Decisions\n\n1. Start in January\n2. Budget £4,000\n\n## Questions\n\n- Planning permission?\n- Skip hire: who pays?\n\n---\n\nFollow up by **Friday**.',
  hashtag: 'Tags: #home #garden',
  numberInText: 'Version 2. Not a list because it is mid line.',
  backslash: 'A path C:\\Users\\me and a literal \\*star.',
  strikeTilde: 'About ~5 minutes.',
};

// Odd or hand-written Markdown: may be tidied, but must show the same and be stable.
const messy: string[] = [
  'Setext heading\n==============\n\nText',
  '    indented code\n    more',
  '+ plus bullets\n+ two',
  '- a\n- b\n\n\n- c',
  '***both***',
  '**bold *and italic* inside**',
  'line with trailing spaces  \nnext',
  '- [X] capital x',
  '[ref link][r]\n\n[r]: https://example.com',
  'Text\n- list right after\n- two',
  '1. one\n1. one again\n1. and again',
  '> quote\ncontinued lazily',
  '`` code with ` tick ``',
  'a * b * c',
  'a needless \\* escape',
  '\\# not a heading',
  '\\- not a list',
  '2026\\. not a list',
  'Emoji 🎉 and accents: café, naïve.',
  '# Heading with `code` and **bold**',
  '- item\n\n  ```\n  code in item\n  ```',
  '<!-- a comment -->\n\nText',
];

describe('editor Markdown round trip', () => {
  for (const [name, md] of Object.entries(exact))
    it(`keeps "${name}" exactly`, () => {
      expect(rt(md)).toBe(md);
    });

  for (const md of messy)
    it(`keeps the meaning of ${JSON.stringify(md.slice(0, 30))}`, () => {
      const once = rt(md);
      expect(html(once)).toBe(html(md));
      expect(rt(once)).toBe(once);
    });

  it('reads checklists as ticked or not', () => {
    const doc = parseMarkdown('- [ ] a\n- [x] b');
    const items: (boolean | null)[] = [];
    doc.descendants((n) => {
      if (n.type.name === 'list_item') items.push(n.attrs.checked);
    });
    expect(items).toEqual([false, true]);
  });

  it('escapes text that would turn into formatting', () => {
    const { schema } = parseMarkdown('').type;
    const p = (t: string) => schema.node('doc', null, [schema.node('paragraph', null, [schema.text(t)])]);
    for (const t of ['# not a heading', '- not a list', '1. not a list', '> not a quote', '*not italic*', 'a `tick', '<b>not html</b>', '---', '[x] not a box'])
      expect(parseMarkdown(serializeMarkdown(p(t))).textContent).toBe(t);
  });

  it('keeps text typed after a line break from becoming a block', () => {
    const { schema } = parseMarkdown('').type;
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Title'), schema.node('hard_break'), schema.text('---'), schema.node('hard_break'), schema.text('# no')])]);
    const md = serializeMarkdown(doc);
    expect(parseMarkdown(md).toJSON()).toEqual(doc.toJSON());
  });

  it('separates two lists of the same kind', () => {
    const { schema } = parseMarkdown('').type;
    const list = () => schema.node('bullet_list', null, [schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('x')])])]);
    const doc = schema.node('doc', null, [list(), list()]);
    expect(parseMarkdown(serializeMarkdown(doc)).childCount).toBe(2);
  });

  it('is fast enough for a long note', () => {
    const big = Array.from({ length: 300 }, (_, i) => `## Part ${i}\n\nSome **text** with a [link](https://e.com/${i}).\n\n- [ ] task ${i}\n- item`).join('\n\n');
    const t = Date.now();
    expect(rt(big)).toBe(big);
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('keeps random text with Markdown characters and marks (300 random notes)', () => {
    const { schema } = parseMarkdown('').type;
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    const pieces = ['a', 'word', ' ', ' ', '*', '_', '`', '~', '[', ']', '(', ')', '<', '>', '#', '-', '+', '1.', '!', '&amp;', '|', '\\', 'x_y', '2 * 3', 'http://e.com', ':', '"'];
    const markSets = [[], [], ['strong'], ['em'], ['strike'], ['code'], ['strong', 'em'], ['link']];
    const text = () => Array.from({ length: 1 + rnd(6) }, () => pieces[rnd(pieces.length)]).join('');
    const inline = () =>
      Array.from({ length: 1 + rnd(4) }, () => {
        const t = text();
        const names = markSets[rnd(markSets.length)];
        const marks = names.map((n) => (n === 'link' ? schema.marks.link.create({ href: 'https://example.com/x' }) : schema.marks[n].create()));
        return schema.text(t, marks);
      });
    const block = () => {
      const k = rnd(4);
      const para = schema.node('paragraph', null, inline());
      if (k === 0) return schema.node('heading', { level: 1 + rnd(3) }, inline());
      if (k === 1) return schema.node('bullet_list', null, [schema.node('list_item', { checked: rnd(2) ? null : false }, [para])]);
      if (k === 2) return schema.node('blockquote', null, [para]);
      return para;
    };
    const visible = (d: any) => {
      const out: string[] = [];
      d.descendants((n: any) => {
        if (n.isTextblock) out.push(n.textContent.replace(/\s+/g, ' ').trim());
      });
      return out.filter(Boolean).join('|');
    };
    const bad: string[] = [];
    for (let i = 0; i < 300; i++) {
      const doc = schema.node('doc', null, Array.from({ length: 1 + rnd(3) }, block));
      const md = serializeMarkdown(doc);
      const back = parseMarkdown(md);
      if (visible(back) !== visible(doc)) bad.push(`${JSON.stringify(visible(doc))}\n  → ${JSON.stringify(md)}\n  → ${JSON.stringify(visible(back))}`);
      else {
        // Settles: odd text glued to an address can take one more pass to reach its final form.
        const p2 = serializeMarkdown(back);
        const p3 = serializeMarkdown(parseMarkdown(p2));
        expect(serializeMarkdown(parseMarkdown(p3))).toBe(p3);
      }
    }
    expect(bad.slice(0, 5).join('\n')).toBe('');
  });
});
