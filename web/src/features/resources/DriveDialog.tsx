import { useEffect, useMemo, useState } from 'preact/hooks';
import { change, get, post, say } from '../../core/api';
import { useFlag } from '../../core/features';
import { Dialog } from '../../core/ui';
import { detectResource, KIND_LABELS, parseResourceText, sameKey, type ResourceKind } from '../../../../src/core/resource-kinds';
import { KindIcon } from './icons';
import { RULE, type Owner, type Resource } from './model';
import { hintFromMime, openPicker, type PickerConfig } from './picker';

type Row = { value: string; title: string; kind: ResourceKind; type: string; hint?: string; fromPicker?: boolean };

/** Google's Picker settings; asked for only while the `google-picker` flag is on. */
function usePickerConfig(): PickerConfig | null {
  const on = useFlag('google-picker');
  const [cfg, setCfg] = useState<PickerConfig | null>(null);
  useEffect(() => {
    if (!on) return setCfg(null);
    get<PickerConfig>('/resources/picker')
      .then((c) => setCfg(c.enabled ? c : null))
      .catch(() => setCfg(null));
  }, [on]);
  return cfg;
}

/**
 * The "Add from Drive" pop-up. Paste one or many Google Drive or Docs addresses (or any web
 * addresses); each is recognised, gets its icon and a title to edit. With the Picker switched on,
 * "Choose from Google Drive" adds files from Google's own pop-up too.
 */
export function DriveDialog({ owner, existing, groups, onClose }: { owner: Owner; existing: Resource[]; groups: string[]; onClose: () => void }) {
  const picker = usePickerConfig();
  const [text, setText] = useState('');
  const [grp, setGrp] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const have = useMemo(() => new Set(existing.filter((r) => r.type === 'link' || r.type === 'drive').map((r) => sameKey(r.value))), [existing]);
  const parsed = useMemo(() => parseResourceText(text), [text]);
  const rows: (Row & { dup: boolean })[] = useMemo(() => {
    const seen = new Set<string>();
    const all: Row[] = [...parsed.items.map((i) => ({ value: i.value, title: i.title, kind: i.kind, type: i.type })), ...picked];
    return all
      .filter((r) => !removed.has(r.value))
      .map((r) => {
        const key = sameKey(r.value);
        const dup = have.has(key) || seen.has(key);
        seen.add(key);
        return { ...r, title: titles[r.value] ?? r.title, dup };
      });
  }, [parsed, picked, removed, titles, have]);
  const toAdd = rows.filter((r) => !r.dup);

  async function choose() {
    if (!picker) return;
    try {
      const files = await openPicker(picker);
      setPicked((p) => [
        ...p,
        ...files.map((f) => {
          const d = detectResource(f.url, 'drive', hintFromMime(f.mimeType));
          return { value: d.value, title: f.name, kind: d.kind, type: d.type, hint: hintFromMime(f.mimeType), fromPicker: true };
        }),
      ]);
    } catch (err) {
      say((err as Error).message, 'error');
    }
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText((x) => (x ? x.replace(/\s*$/, '\n') : '') + t);
    } catch {
      say('Could not read the clipboard. Paste into the box instead.', 'error');
    }
  }

  async function addAll() {
    if (!toAdd.length || busy) return;
    setBusy(true);
    const n = toAdd.length;
    await change(
      () => post('/resources/bulk', { ...owner, group: grp.trim() || undefined, items: toAdd.map((r) => ({ value: r.value, title: r.title.trim() || undefined, kind: r.hint })) }),
      n === 1 ? 'Added 1 resource' : `Added ${n} resources`,
    );
    setBusy(false);
    onClose();
  }

  return (
    <Dialog title="Add from Drive" onClose={onClose} wide>
      <div class="stack drive-dialog">
        <p class="muted small">
          Open the file in Google Drive, copy its address, and paste it here. Paste one, or a whole list, one per line. Add a title before an address if you like: <code>Budget - https://…</code>
        </p>
        <div class="drive-tools">
          <a class="chip" href="https://drive.google.com/" target="_blank" rel="noopener noreferrer">
            Open Google Drive ↗
          </a>
          {picker && (
            <button type="button" class="chip on" onClick={choose}>
              Choose from Google Drive
            </button>
          )}
          <button type="button" class="chip" onClick={pasteFromClipboard}>
            Paste from clipboard
          </button>
        </div>
        <textarea
          class="drive-paste"
          rows={4}
          autoFocus
          placeholder={'https://docs.google.com/document/d/…\nhttps://drive.google.com/drive/folders/…'}
          aria-label="Google Drive addresses"
          autocapitalize="off"
          spellcheck={false}
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
        {parsed.ignored > 0 && <p class="small muted">{parsed.ignored} line{parsed.ignored === 1 ? '' : 's'} without an address ignored.</p>}

        {rows.length > 0 && (
          <ul class="plain drive-rows">
            {rows.map((r) => (
              <li key={r.value} class={r.dup ? 'dup' : ''}>
                <KindIcon kind={r.kind} size={26} />
                <div class="drive-row-main">
                  <input
                    aria-label={`Title for ${KIND_LABELS[r.kind]}`}
                    value={r.title}
                    disabled={r.dup}
                    onInput={(e) => setTitles({ ...titles, [r.value]: (e.target as HTMLInputElement).value })}
                  />
                  <span class="muted small">
                    {KIND_LABELS[r.kind]}
                    {r.dup ? ' · already added, skipped' : ''}
                  </span>
                </div>
                <button class="icon small" aria-label={`Remove ${r.title}`} onClick={() => setRemoved(new Set(removed).add(r.value))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <label>
          Group for all (optional)
          <input list="drive-groups" placeholder="Such as Planning" value={grp} onInput={(e) => setGrp((e.target as HTMLInputElement).value)} />
          <datalist id="drive-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
        <p class="muted small res-rule">{RULE}</p>
        <div class="row res-actions">
          <span class="spacer" />
          <button type="button" class="ghost" onClick={onClose}>
            Cancel
          </button>
          <button class="primary" disabled={!toAdd.length || busy} onClick={addAll}>
            {toAdd.length > 1 ? `Add all (${toAdd.length})` : toAdd.length === 1 ? 'Add' : 'Add all'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
