// A plain list's look (D58, mockup B): each group is its own box with a coloured left edge and a
// tinted header (fold button, name, count); an item is its text (two lines, then "more"), a chip
// per web address (the site's name; a tap opens the link), and a ⋯ menu (Edit, Move to a group,
// Delete) instead of a ✕. A tap on the item opens it. Used by a list's page and its panels; a
// to-do keeps its own rows.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Menu, MenuItem } from '../../core/menu';
import { tidyLinks } from '../../core/links';
import { plainPreview } from '../../core/ui';
import { deleteCard, moveCard, type BoardCtx } from './actions';
import { justDragged } from './drag';
import { useGroupFold } from './memory';
import './list-look.css';
import type { Card, Column } from './model';

/** The colours groups take in turn: tokens, so Light, Dark and E-ink follow. */
export const groupClass = (index: number) => `ll-g${index % 5}`;

/** Chips for the addresses in an item's text. */
function Chips({ links }: { links: { url: string; site: string }[] }) {
  if (!links.length) return null;
  return (
    <span class="ll-chips">
      {links.map((l, i) => (
        <a key={i} class="ll-chip" href={l.url} target="_blank" rel="noopener noreferrer" title={l.url} aria-label={`Open ${l.site}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <span aria-hidden="true">🔗</span> {l.site}
        </a>
      ))}
    </span>
  );
}

/** Text held to two lines with a "more" toggle that shows only when the text is cut. */
function Clamped({ children, watch }: { children: ComponentChildren; watch: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    const measure = () => !open && setCut(e.scrollHeight > e.clientHeight + 1);
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(e);
    return () => ro?.disconnect();
  }, [watch, open]);
  return (
    <>
      <div ref={el} class={`ll-clamp${open ? ' open' : ''}`}>
        {children}
      </div>
      {(cut || open) && (
        <button class="ll-more" aria-expanded={open} onClick={(e) => (e.stopPropagation(), setOpen(!open))} onKeyDown={(e) => e.stopPropagation()}>
          {open ? 'less' : 'more'}
        </button>
      )}
    </>
  );
}

function ItemMenu({ b, c, groups, onOpen }: { b: BoardCtx; c: Card; groups: Column[]; onOpen: (c: Card) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const others = groups.filter((g) => g.id !== c.column_id);
  return (
    <>
      <button class="icon small ll-menu-btn" aria-label={`More for ${c.title}`} aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement))}>
        ⋯
      </button>
      {anchor && (
        <Menu anchor={anchor} label={`More for ${c.title}`} onClose={() => setAnchor(null)}>
          <MenuItem icon="✎" onClick={() => onOpen(c)}>
            Edit
          </MenuItem>
          {others.map((g) => (
            <MenuItem key={g.id} icon="➜" onClick={() => moveCard(b, c.id, g.id, g.cards.length)}>
              Move to {g.name}
            </MenuItem>
          ))}
          <MenuItem icon="🗑" danger onClick={() => deleteCard(b, c)}>
            Delete
          </MenuItem>
        </Menu>
      )}
    </>
  );
}

/** One item of a plain list. `groups` are the list's groups (for Move to); `menu` false in the small panel. */
export function ListItem({ b, c, groups, onOpen, menu = true, extra }: { b: BoardCtx; c: Card; groups: Column[]; onOpen: (c: Card) => void; menu?: boolean; extra?: ComponentChildren }) {
  const { text, links } = tidyLinks(c.title);
  const note = c.note ? plainPreview(c.note, 2, 160) : '';
  const open = () => !justDragged() && onOpen(c);
  return (
    <li data-id={c.id} class="ll-item">
      <div class="ll-body" role="button" tabIndex={0} title="Open" onClick={open} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(c))}>
        {(text || note) && (
          <Clamped watch={`${text}|${note}`}>
            {text && <b class="ll-title">{text}</b>}
            {note && <span class="ll-note">{note}</span>}
          </Clamped>
        )}
        <Chips links={links} />
      </div>
      {extra}
      {menu && <ItemMenu b={b} c={c} groups={groups} onOpen={onOpen} />}
    </li>
  );
}

/** A group's box: coloured edge, tinted header with its fold button, name and count. `head` replaces the plain name (the page's editable one). */
export function GroupBox({ col, index, head, children }: { col: Column; index: number; head?: ComponentChildren; children: (folded: boolean) => ComponentChildren }) {
  const [folded, setFolded] = useGroupFold(col.id);
  return (
    <section class={`ll-group ${groupClass(index)}${folded ? ' folded' : ''}`} data-group={col.name}>
      <div class="ll-head">
        <button class="ll-fold" aria-expanded={!folded} aria-label={`${folded ? 'Open' : 'Fold'} ${col.name}`} title={folded ? 'Open' : 'Fold'} onClick={() => setFolded(!folded)}>
          {folded ? '▸' : '▾'}
        </button>
        {head ?? (
          <>
            <span class="ll-name">{col.name}</span>
            <span class="ll-count">{col.cards.length}</span>
          </>
        )}
      </div>
      {children(folded)}
    </section>
  );
}
