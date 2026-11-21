// Markdown that keeps the writer's blank lines. `marked` drops every blank line after the first
// between two blocks; the note editor keeps each extra one as an empty paragraph (D: v0.23.1,
// features/editor/markdown.ts). Small views of a note (a small panel, a Files card) use this so
// they show the same lines as the editor.
import DOMPurify from 'dompurify';
import { Lexer, Parser, type Token } from 'marked';

const BLANK_LINE_NEWLINES = 2;
const EMPTY_LINE: Token = { type: 'html', raw: '', text: '<p class="md-blank"><br></p>', block: true } as Token;

export function keepBlankLines(tokens: Token[]): Token[] {
  const first = tokens.findIndex((t) => t.type !== 'space');
  const last = tokens.length - 1 - [...tokens].reverse().findIndex((t) => t.type !== 'space');
  return tokens.flatMap((t, i) => (t.type === 'space' && i > first && i < last ? Array.from({ length: Math.max(0, t.raw.length - BLANK_LINE_NEWLINES) }, () => EMPTY_LINE) : [t]));
}

/** A note's Markdown as HTML (not yet cleaned): single newlines are line breaks, extra blank lines stay. */
export function noteMarkup(text: string): string {
  const tokens = new Lexer({ gfm: true, breaks: true }).lex((text || '').replace(/\r\n?/g, '\n'));
  return new Parser({ gfm: true, breaks: true }).parse(keepBlankLines(tokens));
}

/** The same, cleaned with DOMPurify, to show on screen. */
export const noteHtml = (text: string): string => DOMPurify.sanitize(noteMarkup(text));
