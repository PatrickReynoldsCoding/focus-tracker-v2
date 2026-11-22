// Web addresses in an item's text, tidied for display (D58): a bare address and a pasted Markdown
// link `[name](https://…)` become one small chip each with the site's name; the name stays as text.
// Nothing is rewritten in storage.

export type TidyLink = { url: string; site: string };
export type Tidy = { text: string; links: TidyLink[] };

const LINK_RE = /\[([^\]]*)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi;
const isAddress = (s: string) => /^(?:https?:\/\/|www\.)/i.test(s.trim());

/** The site's name for an address: its host without `www.`. */
export function siteOf(url: string): string {
  try {
    return new URL(/^www\./i.test(url) ? `https://${url}` : url).hostname.replace(/^www\./i, '') || url;
  } catch {
    return url;
  }
}

export function tidyLinks(raw: string | null | undefined): Tidy {
  const links: TidyLink[] = [];
  const text = (raw ?? '')
    .replace(LINK_RE, (_m, name: string | undefined, mdUrl: string | undefined, bare: string | undefined) => {
      const url = mdUrl ?? bare ?? '';
      links.push({ url: /^www\./i.test(url) ? `https://${url}` : url, site: siteOf(url) });
      return name && !isAddress(name) ? name : '';
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
  return { text, links };
}
