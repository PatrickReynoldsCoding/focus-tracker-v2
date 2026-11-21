// The small views of a note (web/src/core/blank-lines.ts) keep its line breaks and extra blank lines.
import { describe, expect, it } from 'vitest';
import { noteMarkup } from '../web/src/core/blank-lines';

const blanks = (html: string) => (html.match(/class="md-blank"/g) ?? []).length;

describe('noteMarkup', () => {
  it('turns a single newline into a line break', () => {
    expect(noteMarkup('one\ntwo')).toContain('one<br>two');
  });
  it('gives one blank line between paragraphs no extra space', () => {
    const html = noteMarkup('one\n\ntwo');
    expect(blanks(html)).toBe(0);
    expect(html.match(/<p>/g)).toHaveLength(2);
  });
  it('keeps each extra blank line', () => {
    expect(blanks(noteMarkup('one\n\n\n\ntwo'))).toBe(2);
    expect(blanks(noteMarkup('one\n\n\n\n\n\n\ntwo'))).toBe(5);
  });
  it('drops blank lines at the start and the end', () => {
    expect(blanks(noteMarkup('\n\n\none\n\n\n\n'))).toBe(0);
  });
  it('agrees with the editor on how many blank lines there are', async () => {
    const { parseMarkdown } = await import('../web/src/features/editor/markdown');
    const src = 'a\n\n\n\nb\n\n\nc';
    const empties = parseMarkdown(src).content.content.filter((n) => n.type.name === 'paragraph' && n.content.size === 0).length;
    expect(blanks(noteMarkup(src))).toBe(empties);
  });
});
