// A fold-out menu for the editor's toolbar: a button that opens a list of choices.
// Keyboard: Enter, Space or ↓ opens it on the first item; ↑ ↓ Home End move; Esc closes and
// returns to the button; Tab closes. Pointer and touch: tap to open, tap a choice.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface MenuItem {
  label: ComponentChildren;
  /** Plain text of the label, for screen readers when the label is styled. */
  text?: string;
  hint?: string;
  checked?: boolean;
  /** 'radio' (one of a group) or 'check' (on/off); default: an action. */
  kind?: 'radio' | 'check';
  disabled?: boolean;
  class?: string;
  run: () => void;
}
export type MenuEntry = MenuItem | 'sep' | { heading: string };

export function Menu({
  id,
  label,
  title,
  items,
  open,
  setOpen,
  up,
  align = 'start',
  class: cls,
}: {
  id: string;
  label: ComponentChildren;
  title: string;
  items: MenuEntry[];
  open: string | null;
  setOpen: (id: string | null) => void;
  up?: boolean;
  align?: 'start' | 'end';
  class?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const isOpen = open === id;
  const focusFirst = useRef(false);

  const itemsEls = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not([disabled])') ?? [])];

  useEffect(() => {
    if (!isOpen) return;
    if (focusFirst.current) {
      const els = itemsEls();
      (els.find((e) => e.getAttribute('aria-checked') === 'true') ?? els[0])?.focus();
      focusFirst.current = false;
    }
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(null);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [isOpen]);

  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus) btn.current?.focus();
  };

  const onListKey = (e: KeyboardEvent) => {
    const els = itemsEls();
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const go = (j: number) => els[(j + els.length) % els.length]?.focus();
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') close(true);
    else if (e.key === 'Tab') return setOpen(null);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      const from = els.slice(i + 1).concat(els.slice(0, i + 1));
      from.find((el) => el.textContent?.trim().toLowerCase().startsWith(k))?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div class={`ed-menu ${cls ?? ''}`}>
      <button
        ref={btn}
        type="button"
        class="ed-tb ed-menu-btn"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={`${id}-menu`}
        title={title}
        aria-label={title}
        onClick={() => setOpen(isOpen ? null : id)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            focusFirst.current = true;
            setOpen(id);
          } else if (e.key === 'Escape' && isOpen) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(null);
          }
        }}
      >
        {label}
        <span class="ed-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {isOpen && (
        <div ref={list} id={`${id}-menu`} role="menu" aria-label={title} class={`ed-pop ${up ? 'up' : ''} ${align}`} onKeyDown={onListKey}>
          {items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} role="separator" class="ed-sep" />
            ) : 'heading' in it ? (
              <div key={i} class="ed-pop-head" role="presentation">
                {it.heading}
              </div>
            ) : (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                role={it.kind === 'radio' ? 'menuitemradio' : it.kind === 'check' ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={it.kind ? !!it.checked : undefined}
                aria-label={it.text}
                disabled={it.disabled}
                class={`ed-item ${it.class ?? ''} ${it.checked ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  close(false);
                  it.run();
                }}
              >
                <span class="ed-tick" aria-hidden="true">
                  {it.kind ? (it.checked ? '✓' : '') : ''}
                </span>
                <span class="ed-item-label">{it.label}</span>
                {it.hint && <kbd class={`ed-hint ${/Ctrl|⌘|Tab|Esc/.test(it.hint) ? 'ed-key' : ''}`}>{it.hint}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
