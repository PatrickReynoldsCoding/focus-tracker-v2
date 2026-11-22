// The card dialog, for a project's card, a to-do's item and a plain list's item. Other features
// add sections with registerPanel('card', …) (links, the day, the rich note editor) and open it
// too (a linked card, a card in the Today list).

import { change, del, patch, post } from '../../core/api';
import { Panels, registerPanel, type CardSectionProps } from '../../core/registry';
import { ColorPicker, Dialog, InlineEdit, MarkdownEditor } from '../../core/ui';
import type { Card, Column } from './model';

export function CardDialog({ card, columns, onClose, onChange }: { card: Card; columns: Column[] | { id: string; name: string; is_done?: boolean }[]; onClose: () => void; onChange: (c: Partial<Card> | null) => void }) {
  const save = (p: Record<string, unknown>) => {
    onChange(p as Partial<Card>);
    change(() => patch(`/tasks/${card.id}`, p));
  };
  return (
    <Dialog title={<InlineEdit value={card.title} onSave={(title) => title && save({ title })} />} onClose={onClose} wide>
      <div class="stack">
        <Panels<CardSectionProps> place="card" props={{ card, columns, save, update: (f) => onChange(f as Partial<Card> | null), close: onClose }} />
      </div>
    </Dialog>
  );
}

/** A plain list's item: its board has no Done column (only a list's columns carry list_id without one). */
export const isPlainItem = (card: { list_id?: string | null }, columns: { is_done?: boolean }[]) => !!card.list_id && !columns.some((c) => c.is_done);

registerPanel('card', {
  id: 'note',
  order: 10,
  render: ({ card, save }) => <MarkdownEditor value={card.note ?? ''} placeholder="Add a note (Markdown)…" onSave={(note) => save({ note })} />,
});
registerPanel('card', { id: 'color', order: 20, render: ({ card, save }) => <ColorPicker value={card.color} onPick={(color) => save({ color })} /> });
// Status (a project's or to-do's column, Done included) or Column (a plain list's): the way to move a card on a phone.
registerPanel('card', {
  id: 'column',
  order: 30,
  render: ({ card, columns, update }) => (
    <label class="inline">
      {(columns as Column[]).some((c) => c.is_done) ? 'Status' : 'Column'}
      <select
        value={card.column_id}
        onChange={(e) => {
          const column_id = (e.target as HTMLSelectElement).value;
          update({ column_id });
          change(() => post(`/tasks/${card.id}/move`, { column_id }));
        }}
      >
        {(columns as Column[]).map((c) => (
          <option key={c.id} value={c.id}>
            {c.is_done ? `✓ ${c.name}` : c.name}
          </option>
        ))}
      </select>
    </label>
  ),
});
registerPanel('card', {
  id: 'delete',
  order: 1000,
  render: ({ card, update, close }) => (
    <div class="row">
      <button
        class="danger ghost"
        onClick={() => {
          close();
          update(null);
          change(() => del(`/tasks/${card.id}`), 'Card deleted');
        }}
      >
        Delete card
      </button>
    </div>
  ),
});
