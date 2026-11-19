// A small pop-up menu under a button (the New button, an item's ⋯). It opens upwards when there
// is no room below, closes on a tap outside or Escape, and adds no browser history entry.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export function Menu({ anchor, onClose, children, label }: { anchor: HTMLElement; onClose: () => void; children: ComponentChildren; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const m = ref.current!.getBoundingClientRect();
    const gap = 6;
    const below = a.bottom + gap + m.height <= window.innerHeight - 8;
    const top = below ? a.bottom + gap : Math.max(8, a.top - gap - m.height);
    const left = Math.min(Math.max(8, a.right - m.width), window.innerWidth - m.width - 8);
    setPos({ top, left });
    ref.current?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
  }, [anchor]);
  useEffect(() => {
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.focus();
      }
    };
    const gone = () => onClose();
    // A phone's address bar showing or hiding changes the height only: the menu stays.
    const width = window.innerWidth;
    const resized = () => window.innerWidth !== width && onClose();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', resized);
    window.addEventListener('hashchange', gone);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', resized);
      window.removeEventListener('hashchange', gone);
    };
  }, [anchor, onClose]);
  return (
    <div ref={ref} class="files-menu" role="menu" aria-label={label} style={pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : { visibility: 'hidden', top: '0', left: '0' }} onClick={(e) => (e.target as HTMLElement).closest('button, a') && onClose()}>
      {children}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger, href, external }: { icon?: ComponentChildren; children: ComponentChildren; onClick?: () => void; danger?: boolean; href?: string; external?: boolean }) {
  const inner = (
    <>
      <span class="files-menu-ico" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </>
  );
  if (href)
    return (
      <a role="menuitem" class="files-menu-item" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} onClick={onClick}>
        {inner}
      </a>
    );
  return (
    <button type="button" role="menuitem" class={`files-menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>
      {inner}
    </button>
  );
}
