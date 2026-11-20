// The sheet "+ Add panel" opens: the panels that are not on this page (or in this pill) yet, each
// with its icon and one line, then one "Add file" entry that opens the file picker.

import { useState } from 'preact/hooks';
import { useFlag } from '../../core/features';
import type { PanelAdderProps } from '../../core/registry';
import { Dialog } from '../../core/ui';
import { FilePicker } from './FilePicker';

const titleOf = (p: { id: string; title?: string }) => p.title ?? p.id.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function AddPanelSheet({ place, where, panels, addPanel, files, onClose }: PanelAdderProps) {
  const filesTab = useFlag('files-tab');
  const [picking, setPicking] = useState(false);
  const canFile = !!files && filesTab;
  if (picking && files)
    return (
      <Dialog title="Add file" onClose={onClose} wide>
        <FilePicker place={place} files={files} onBack={() => setPicking(false)} onClose={onClose} />
      </Dialog>
    );
  return (
    <Dialog title="Add panel" onClose={onClose} wide>
      <div class="ap">
        <p class="muted small ap-where">To {where}.</p>
        <ul class="ap-list" aria-label="Panels">
          {canFile && (
            <li>
              <button class="ap-row ap-file" onClick={() => setPicking(true)}>
                <span class="ap-icon" aria-hidden="true">
                  ❏
                </span>
                <span class="ap-text">
                  <strong>Add file</strong>
                  <span class="muted small">A note, list or whiteboard from Files, or a new one. {files!.hint}</span>
                </span>
                <span class="ap-go" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          )}
          {panels.map((p) => (
            <li key={p.id}>
              <button
                class="ap-row"
                onClick={() => {
                  onClose();
                  addPanel(p);
                }}
              >
                <span class="ap-icon" aria-hidden="true">
                  {p.icon ?? '▦'}
                </span>
                <span class="ap-text">
                  <strong>{titleOf(p)}</strong>
                  {p.description && <span class="muted small">{p.description}</span>}
                </span>
                <span class="ap-go small">Add</span>
              </button>
            </li>
          ))}
        </ul>
        {!panels.length && (
          <p class="muted small">
            Every panel is here already
            {canFile ? '. Add file puts a note, list or whiteboard here.' : '.'}
          </p>
        )}
      </div>
    </Dialog>
  );
}
