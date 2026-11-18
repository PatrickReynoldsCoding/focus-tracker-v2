import { describe, expect, it } from 'vitest';
import { detectResource, guessTitle, parseResourceText, sameKey } from '../src/core/resource-kinds';

const ID = '1aBcD_eFgHiJkLmNoPqRsTuVwXyZ0123456789';

describe('detecting what an address is', () => {
  const cases: [string, string][] = [
    [`https://docs.google.com/document/d/${ID}/edit`, 'doc'],
    [`https://docs.google.com/document/d/${ID}/edit?usp=sharing`, 'doc'],
    [`https://docs.google.com/document/u/1/d/${ID}/edit`, 'doc'],
    [`https://docs.google.com/a/example.com/document/d/${ID}/edit`, 'doc'],
    [`https://docs.google.com/document/d/${ID}/preview`, 'doc'],
    [`https://docs.google.com/document/create`, 'doc'],
    [`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`, 'sheet'],
    [`https://docs.google.com/spreadsheets/u/0/d/${ID}/htmlview`, 'sheet'],
    [`https://docs.google.com/presentation/d/${ID}/edit#slide=id.p`, 'slides'],
    [`https://docs.google.com/presentation/d/${ID}/present`, 'slides'],
    [`https://docs.google.com/forms/d/${ID}/edit`, 'form'],
    [`https://docs.google.com/forms/d/e/1FAIpQLSdXXXXXXXXXXXXXXXXXXXXXX/viewform`, 'form'],
    [`https://forms.gle/AbCdEf123456`, 'form'],
    [`https://docs.google.com/drawings/d/${ID}/edit`, 'drawing'],
    [`https://drive.google.com/file/d/${ID}/view?usp=sharing`, 'file'],
    [`https://drive.google.com/file/u/2/d/${ID}/view`, 'file'],
    [`https://drive.google.com/open?id=${ID}`, 'file'],
    [`https://drive.google.com/uc?export=download&id=${ID}`, 'file'],
    [`https://drive.google.com/drive/folders/${ID}`, 'folder'],
    [`https://drive.google.com/drive/folders/${ID}?usp=sharing`, 'folder'],
    [`https://drive.google.com/drive/u/1/folders/${ID}`, 'folder'],
    [`https://drive.google.com/drive/mobile/folders/${ID}`, 'folder'],
    [`https://drive.google.com/drive/u/0/my-drive`, 'folder'],
    [`https://drive.google.com/drive/shared-with-me`, 'folder'],
    [`https://drive.google.com/folderview?id=${ID}`, 'folder'],
    [`docs.google.com/document/d/${ID}/edit`, 'doc'],
    [`HTTPS://DOCS.GOOGLE.COM/SPREADSHEETS/d/${ID}`, 'sheet'],
  ];
  it.each(cases)('%s is %s', (url, kind) => {
    const d = detectResource(url);
    expect(d.kind).toBe(kind);
    expect(d.type).toBe('drive');
    expect(d.google).toBe(true);
    expect(d.value).toMatch(/^https:\/\//i);
  });

  it('finds the Drive id so the same file is spotted twice', () => {
    expect(detectResource(`https://docs.google.com/document/d/${ID}/edit`).driveId).toBe(ID);
    expect(detectResource(`https://drive.google.com/open?id=${ID}`).driveId).toBe(ID);
    expect(detectResource(`https://drive.google.com/drive/u/1/folders/${ID}`).driveId).toBe(ID);
    expect(sameKey(`https://docs.google.com/document/d/${ID}/edit`)).toBe(sameKey(`https://docs.google.com/document/u/1/d/${ID}/view?usp=sharing`));
    expect(sameKey('https://example.com/a')).not.toBe(sameKey('https://example.com/b'));
  });

  it('treats other addresses as links, with pdf and image by file name', () => {
    expect(detectResource('https://github.com/owner/repo')).toMatchObject({ type: 'link', kind: 'link', google: false });
    expect(detectResource('https://example.com/report.PDF?x=1').kind).toBe('pdf');
    expect(detectResource('https://example.com/a/photo.jpeg').kind).toBe('image');
    expect(detectResource('https://sites.google.com/view/mysite')).toMatchObject({ type: 'link', kind: 'link' });
    expect(detectResource('https://calendar.google.com/calendar/u/0/r').kind).toBe('link');
    expect(detectResource('example.com/page').value).toBe('https://example.com/page');
  });

  it('guesses email, phone and text, and respects a chosen type', () => {
    expect(detectResource('anna@example.com')).toMatchObject({ type: 'email', kind: 'email' });
    expect(detectResource('mailto:anna@example.com').value).toBe('anna@example.com');
    expect(detectResource('+44 7700 900123')).toMatchObject({ type: 'phone', kind: 'phone' });
    expect(detectResource('Ask for Dave')).toMatchObject({ type: 'text', kind: 'text' });
    expect(detectResource('https://example.com', 'text')).toMatchObject({ type: 'text', kind: 'text', value: 'https://example.com' });
    expect(detectResource('07700 900123', 'phone').kind).toBe('phone');
  });

  it('uses a Picker hint only for Drive files', () => {
    const file = `https://drive.google.com/file/d/${ID}/view`;
    expect(detectResource(file, 'drive', 'pdf').kind).toBe('pdf');
    expect(detectResource(file, 'drive', 'image').kind).toBe('image');
    expect(detectResource(`https://docs.google.com/document/d/${ID}/edit`, 'drive', 'pdf').kind).toBe('doc');
    expect(detectResource('https://example.com/x', 'link', 'pdf').kind).toBe('link');
  });
});

describe('titles', () => {
  it('guesses a title from the address', () => {
    expect(guessTitle(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toBe('Google Sheet');
    expect(guessTitle(`https://drive.google.com/drive/folders/${ID}`)).toBe('Drive folder');
    expect(guessTitle('https://www.github.com/owner/repo')).toBe('github.com/owner/repo');
    expect(guessTitle('https://example.com/files/Report%20final.pdf')).toBe('Report final.pdf');
  });
});

describe('reading pasted text', () => {
  it('reads a bare list, one address per line', () => {
    const { items } = parseResourceText(`https://docs.google.com/document/d/${ID}/edit\nhttps://docs.google.com/spreadsheets/d/${ID}2/edit\n\nhttps://docs.google.com/document/d/${ID}3/edit`);
    expect(items.map((i) => i.kind)).toEqual(['doc', 'sheet', 'doc']);
    expect(items.map((i) => i.title)).toEqual(['Google Doc', 'Google Sheet', 'Google Doc 2']);
  });

  it('reads titles written next to, above or inside Markdown around an address', () => {
    const { items, ignored } = parseResourceText(
      [
        `- Budget plan: https://docs.google.com/spreadsheets/d/${ID}/edit`,
        `1. Meeting notes – https://docs.google.com/document/d/${ID}x/edit`,
        `[Pitch deck](https://docs.google.com/presentation/d/${ID}y/edit)`,
        `Site photos`,
        `https://drive.google.com/drive/folders/${ID}z`,
        ``,
        `Just words that are not an address`,
        ``,
      ].join('\n'),
    );
    expect(items.map((i) => [i.title, i.kind])).toEqual([
      ['Budget plan', 'sheet'],
      ['Meeting notes', 'doc'],
      ['Pitch deck', 'slides'],
      ['Site photos', 'folder'],
    ]);
    expect(ignored).toBe(0);
  });

  it('reads several addresses on one line, without a scheme, and drops trailing punctuation', () => {
    const { items } = parseResourceText(`docs.google.com/document/d/${ID}/edit, https://forms.gle/AbCd123.`);
    expect(items.map((i) => i.kind)).toEqual(['doc', 'form']);
    expect(items[0].value).toBe(`https://docs.google.com/document/d/${ID}/edit`);
    expect(items[1].value).toBe('https://forms.gle/AbCd123');
  });

  it('finds nothing in text without addresses', () => {
    expect(parseResourceText('hello\nworld').items).toEqual([]);
  });
});
