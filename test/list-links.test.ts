// Web addresses in an item's text become chips with the site's name (web/src/core/links.ts, D58).
import { describe, expect, it } from 'vitest';
import { siteOf, tidyLinks } from '../web/src/core/links';

describe('tidyLinks', () => {
  it('turns a bare address into a chip and leaves the words', () => {
    const t = tidyLinks('Read this https://www.hamel.dev/blog/evals/ today');
    expect(t.text).toBe('Read this today');
    expect(t.links).toEqual([{ url: 'https://www.hamel.dev/blog/evals/', site: 'hamel.dev' }]);
  });
  it('keeps the name of a pasted Markdown link and chips its address', () => {
    const t = tidyLinks('[Read and Watch doc](https://docs.google.com/document/d/abc/edit)');
    expect(t.text).toBe('Read and Watch doc');
    expect(t.links).toEqual([{ url: 'https://docs.google.com/document/d/abc/edit', site: 'docs.google.com' }]);
  });
  it('drops a Markdown name that is only the address', () => {
    expect(tidyLinks('[https://a.com/x](https://a.com/x)').text).toBe('');
  });
  it('handles several links and a bare www address', () => {
    const t = tidyLinks('a [b](https://one.com) www.two.org/p.');
    expect(t.text).toBe('a b.');
    expect(t.links.map((l) => l.site)).toEqual(['one.com', 'two.org']);
    expect(t.links[1].url).toBe('https://www.two.org/p');
  });
  it('is plain for text without addresses', () => {
    expect(tidyLinks('Buy milk')).toEqual({ text: 'Buy milk', links: [] });
    expect(tidyLinks(null)).toEqual({ text: '', links: [] });
  });
  it('names the site', () => {
    expect(siteOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(siteOf('not a url')).toBe('not a url');
  });
});
