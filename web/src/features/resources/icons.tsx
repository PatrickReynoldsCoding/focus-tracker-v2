// Small inline icons for each kind of resource, in the Google product colours.
// Drawn here as SVG so nothing is fetched from another site.

import type { ComponentChildren } from 'preact';
import type { ResourceKind } from '../../../../src/core/resource-kinds';

const PAGE = 'M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z';
const FOLD = 'M14 2v5h5z';

function Page({ color, children }: { color: string; children?: ComponentChildren }) {
  return (
    <>
      <path d={PAGE} fill={color} />
      <path d={FOLD} fill="#fff" fill-opacity="0.4" />
      {children}
    </>
  );
}

const W = { fill: '#fff' } as const;
const STROKE = { stroke: '#fff', 'stroke-width': 1.6, 'stroke-linecap': 'round', fill: 'none' } as const;

function glyph(kind: ResourceKind): ComponentChildren {
  switch (kind) {
    case 'doc':
      return (
        <Page color="#4285F4">
          <path d="M8 12h8M8 15h8M8 18h5" {...STROKE} />
        </Page>
      );
    case 'sheet':
      return (
        <Page color="#0F9D58">
          <path d="M8 11h8v8H8zM8 15h8M12 11v8" {...STROKE} stroke-width={1.3} stroke-linejoin="round" />
        </Page>
      );
    case 'slides':
      return (
        <Page color="#F4B400">
          <rect x="8" y="11.5" width="8" height="5.5" rx="0.8" {...STROKE} stroke-width={1.4} />
        </Page>
      );
    case 'form':
      return (
        <Page color="#7248B9">
          <circle cx="8.6" cy="12.2" r="0.9" {...W} />
          <circle cx="8.6" cy="15.2" r="0.9" {...W} />
          <circle cx="8.6" cy="18.2" r="0.9" {...W} />
          <path d="M11 12.2h5M11 15.2h5M11 18.2h5" {...STROKE} stroke-width={1.4} />
        </Page>
      );
    case 'drawing':
      return (
        <Page color="#DB4437">
          <circle cx="10.2" cy="14.2" r="2" {...STROKE} stroke-width={1.4} />
          <path d="M12.5 19l2.5-4 2 4z" {...W} />
        </Page>
      );
    case 'file':
      return (
        <Page color="#5F6368">
          <path d="M8 12h8M8 15h8M8 18h5" {...STROKE} stroke-opacity="0.85" />
        </Page>
      );
    case 'pdf':
      return (
        <Page color="#D93025">
          <text x="12" y="18" text-anchor="middle" font-size="5.6" font-weight="700" font-family="system-ui, sans-serif" fill="#fff">
            PDF
          </text>
        </Page>
      );
    case 'image':
      return (
        <Page color="#1E8E5A">
          <circle cx="9.5" cy="12.6" r="1.2" {...W} />
          <path d="M7 19l3.5-4 2.5 2.5 1.8-2L18 19z" {...W} />
        </Page>
      );
    case 'folder':
      return (
        <>
          <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.2h8.5A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" fill="#5F6368" />
          <path d="M3 10h18" stroke="#fff" stroke-opacity="0.35" />
        </>
      );
    case 'phone':
      return (
        <>
          <rect x="7" y="2.5" width="10" height="19" rx="2.4" fill="#34A853" />
          <rect x="8.6" y="5" width="6.8" height="11" rx="0.8" fill="#fff" fill-opacity="0.9" />
          <circle cx="12" cy="18.8" r="0.9" {...W} />
        </>
      );
    case 'email':
      return (
        <>
          <rect x="2.5" y="5" width="19" height="14" rx="2" fill="#EA4335" />
          <path d="M3.5 7l8.5 6.2L20.5 7" {...STROKE} stroke-linejoin="round" />
        </>
      );
    case 'text':
      return (
        <>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="#8A8A82" />
          <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5.5" {...STROKE} />
        </>
      );
    default:
      // link
      return (
        <>
          <circle cx="12" cy="12" r="9.5" fill="none" stroke="#4285F4" stroke-width="1.7" />
          <ellipse cx="12" cy="12" rx="4" ry="9.5" fill="none" stroke="#4285F4" stroke-width="1.5" />
          <path d="M2.8 9.5h18.4M2.8 14.5h18.4" stroke="#4285F4" stroke-width="1.5" />
        </>
      );
  }
}

export function KindIcon({ kind, size = 24 }: { kind: ResourceKind; size?: number }) {
  return (
    <svg class={`kind-icon kind-${kind}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {glyph(kind)}
    </svg>
  );
}
