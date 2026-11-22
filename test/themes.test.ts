// Every colour theme must be readable (WCAG AA: 4.5 for text) and complete (DECISIONS D61).
import { describe, expect, it } from 'vitest';
import { contrast } from '../web/src/themes/define';
import { COLOUR_THEMES } from '../web/src/themes';

const TOKENS = ['--bg', '--surface', '--surface-2', '--fg', '--muted', '--line', '--accent', '--accent-fg', '--accent-soft', '--warm', '--danger', '--danger-fg',
  '--ok', '--warn', '--backdrop', '--shadow-pop', '--shadow', '--c-red', '--c-orange', '--c-yellow', '--c-green', '--c-teal', '--c-blue', '--c-purple', '--c-pink', '--c-grey'];
const COLOURS = ['--c-red', '--c-orange', '--c-yellow', '--c-green', '--c-teal', '--c-blue', '--c-purple', '--c-pink', '--c-grey'];

it('has the eight themes', () => {
  expect(COLOUR_THEMES.map((t) => t.id)).toEqual(['midnight', 'paper', 'forest', 'ocean', 'sunset', 'berry', 'sand', 'slate']);
});

describe.each(COLOUR_THEMES.map((t) => [t.id, t] as const))('%s', (_id, t) => {
  const v = t.vars;
  it('sets every token', () => {
    for (const k of TOKENS) expect(v[k], k).toBeTruthy();
  });
  it('text reads on the page and on panels', () => {
    for (const bg of ['--bg', '--surface', '--surface-2']) {
      expect(contrast(v['--fg'], v[bg]), `fg on ${bg}`).toBeGreaterThanOrEqual(7);
      expect(contrast(v['--muted'], v[bg]), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--accent'], v[bg]), `accent text on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--danger'], v[bg]), `danger on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--warm'], v[bg]), `warm on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('buttons and badges read', () => {
    expect(contrast(v['--accent-fg'], v['--accent'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--danger-fg'], v['--danger'])).toBeGreaterThanOrEqual(4.5);
  });
  it('text reads on the chosen state and on the colour tints', () => {
    if (/^#/.test(v['--accent-soft'])) expect(contrast(v['--fg'], v['--accent-soft'])).toBeGreaterThanOrEqual(7);
    for (const c of COLOURS) expect(contrast(v['--fg'], v[c]), c).toBeGreaterThanOrEqual(7);
  });
  it('lines can be seen', () => {
    expect(contrast(v['--line'], v['--bg'])).toBeGreaterThanOrEqual(1.1);
  });
});
