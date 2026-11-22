import { describe, expect, it } from 'vitest';
import { countLine, namesLine, plural } from '../web/src/features/settings/summaries';

describe('Settings summaries (D60)', () => {
  it('lists names with a + n for the rest', () => {
    expect(namesLine([])).toBe('');
    expect(namesLine(['Personal'])).toBe('Personal');
    expect(namesLine(['Personal', 'Work'])).toBe('Personal, Work');
    expect(namesLine(['Personal', 'Work', 'Garden'])).toBe('Personal, Work + 1');
    expect(namesLine(['a', 'b', 'c', 'd', 'e'])).toBe('a, b + 3');
  });
  it('counts and pluralises', () => {
    expect(countLine(3, 12)).toBe('3 of 12 on');
    expect(plural(0, 'category', 'categories')).toBe('No categories');
    expect(plural(1, 'category', 'categories')).toBe('1 category');
    expect(plural(4, 'token')).toBe('4 tokens');
  });
});
