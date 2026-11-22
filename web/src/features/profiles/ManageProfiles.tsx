// Manage profiles: rename, recolour, reorder, choose the default, delete (restorable for a week).
// Shown in a dialog from the profile dropdown and as the Profiles section of Settings.

import { useEffect, useState } from 'preact/hooks';
import { change, get, HttpError, mode, patch, post, put, say, version } from '../../core/api';
import { loadProfiles, profiles, switchProfile, type DeletedProfile, type Profile } from '../../core/profiles';
import { useSignal } from '../../core/signal';
import { Dialog, InlineEdit, Loading } from '../../core/ui';
import { ColourChoice } from './ColourChoice';
import { USUAL_COLOUR } from './colours';
import { ProfileDot } from './Dot';
import { NewProfileDialog } from './NewProfile';

type Usage = { kind: string; count: number }[];

/** Friendly names for what a profile holds, for the warning before it is deleted. */
const KINDS: Record<string, [string, string]> = {
  projects: ['project', 'projects'],
  tasks: ['card', 'cards'],
  todos: ['to-do', 'to-dos'],
  lists: ['list or note', 'lists and notes'],
  notes: ['project note', 'project notes'],
  habits: ['habit', 'habits'],
  whiteboards: ['whiteboard', 'whiteboards'],
  folders: ['folder', 'folders'],
  resources: ['link', 'links'],
  reminders: ['reminder', 'reminders'],
  backlog: ['backlog item', 'backlog items'],
  log: ['logged session', 'logged sessions'],
};

export function describeUsage(usage: Usage): string {
  const named = usage.filter((u) => KINDS[u.kind]).map((u) => `${u.count} ${KINDS[u.kind][u.count === 1 ? 0 : 1]}`);
  const other = usage.filter((u) => !KINDS[u.kind]).reduce((n, u) => n + u.count, 0);
  if (other) named.push(`${other} other ${other === 1 ? 'thing' : 'things'}`);
  if (!named.length) return 'nothing yet';
  return named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

const dayOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Send a change that the Undo button cannot take back (the default profile, Delete now): no Undo in its message. */
async function act(send: () => Promise<unknown>, done: string): Promise<boolean> {
  try {
    await send();
    version.value++;
    say(done);
    return true;
  } catch (x) {
    say(x instanceof HttpError ? x.message : 'Not saved: try again', 'error');
    return false;
  }
}

async function restore(p: { id: string; label: string }) {
  try {
    const r = await post<{ restored: Profile }>(`/profiles/${p.id}/restore`);
    await loadProfiles();
    version.value++;
    say(`${r.restored.label} is back, with everything in it`);
  } catch (x) {
    say(x instanceof HttpError ? x.message : 'Not restored: try again', 'error');
  }
}

function DeleteProfileDialog({ p, last, onClose, onDeleted }: { p: Profile; last: boolean; onClose: () => void; onDeleted: (p: Profile) => void }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    get<Usage>(`/profiles/${p.id}/usage`)
      .then(setUsage)
      .catch(() => setUsage([]));
  }, [p.id]);
  const ok = typed.trim().toLowerCase() === p.label.trim().toLowerCase();
  async function remove(e: Event) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    try {
      const r = await post<{ default: string }>(`/profiles/${p.id}/delete`, { confirm: typed });
      if (mode.value === p.id) await switchProfile(r.default);
      await loadProfiles();
      version.value++;
      say(`${p.label} deleted`, 'info', { label: 'Undo', run: () => void restore(p) });
      onDeleted(p);
      onClose();
    } catch (x) {
      setErr(x instanceof HttpError ? x.message : 'Not deleted: try again');
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Delete ${p.label}?`} onClose={onClose}>
      {last ? (
        <p>This is your only profile, so it cannot be deleted. Make another profile first.</p>
      ) : (
        <form class="stack" onSubmit={remove}>
          <div class="profile-warning" role="alert">
            <strong>Everything in {p.label} goes, on every device and for Claude:</strong> {usage ? describeUsage(usage) : 'counting…'}, and its settings.
          </div>
          <p class="small">You can bring it back from Manage profiles for 7 days. After that it is gone for good.</p>
          <label>
            Type {p.label} to confirm
            <input value={typed} autoFocus autoComplete="off" onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
          </label>
          {err && <p class="error">{err}</p>}
          <div class="row end">
            <button type="button" class="ghost" onClick={onClose}>
              Cancel
            </button>
            <button class="danger" disabled={!ok || busy}>
              {busy ? 'Deleting…' : `Delete ${p.label}`}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function PurgeDialog({ p, onClose }: { p: DeletedProfile; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const ok = typed.trim().toLowerCase() === p.label.trim().toLowerCase();
  return (
    <Dialog title={`Delete ${p.label} for good?`} onClose={onClose}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          const done = await act(() => post(`/profiles/${p.id}/purge`, { confirm: typed }), `${p.label} is gone for good`);
          if (done) onClose();
        }}
      >
        <div class="profile-warning" role="alert">
          <strong>This cannot be undone.</strong> Everything that was in {p.label} is removed now, instead of on {dayOf(p.restore_until)}.
        </div>
        <label>
          Type {p.label} to confirm
          <input value={typed} autoFocus autoComplete="off" onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
        </label>
        <div class="row end">
          <button type="button" class="ghost" onClick={onClose}>
            Cancel
          </button>
          <button class="danger" disabled={!ok}>
            Delete for good
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ProfileList() {
  const list = useSignal(profiles);
  const m = useSignal(mode);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [purging, setPurging] = useState<DeletedProfile | null>(null);
  const [colouring, setColouring] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  // The toast's Undo is under a dialog while Manage profiles is open, so the list offers it too.
  const [justDeleted, setJustDeleted] = useState<Profile | null>(null);
  if (!list) return <Loading />;
  const all = list.profiles;
  const edit = (p: Profile, body: Record<string, unknown>, done?: string) => change(() => patch(`/profiles/${p.id}`, body), done);
  return (
    <div class="stack profile-list">
      {justDeleted && list.deleted.some((d) => d.id === justDeleted.id) && (
        <div class="profile-undo" role="status">
          <span>{justDeleted.label} deleted.</span>
          <button class="small" onClick={() => (setJustDeleted(null), void restore(justDeleted))}>
            Undo
          </button>
        </div>
      )}
      <ul class="plain">
        {all.map((p, i) => (
          <li key={p.id} class={`profile-row ${p.id === m ? 'on' : ''}`}>
            <div class="profile-row-main">
              <button
                type="button"
                class="icon profile-colour-btn"
                aria-label={`Colour of ${p.label}`}
                aria-expanded={colouring === p.id}
                onClick={() => setColouring(colouring === p.id ? null : p.id)}
              >
                <ProfileDot p={p} />
              </button>
              <InlineEdit value={p.label} onSave={(label) => label.trim() && label.trim() !== p.label && edit(p, { label: label.trim() }, 'Renamed')} />
              <span class="profile-tags">
                {p.id === m && <span class="tag">Open</span>}
                {p.id === list.default && (
                  <span class="tag" title="Used when a device or Claude names no profile">
                    Default
                  </span>
                )}
              </span>
              <span class="row tight profile-moves">
                <button class="icon small" aria-label={`Move ${p.label} up`} disabled={i === 0} onClick={() => edit(p, { position: i })}>
                  ▲
                </button>
                <button class="icon small" aria-label={`Move ${p.label} down`} disabled={i === all.length - 1} onClick={() => edit(p, { position: i + 2 })}>
                  ▼
                </button>
              </span>
            </div>
            <div class="profile-row-more">
              <span class="muted small">
                id <code>{p.id}</code>
              </span>
              {p.id !== m && (
                <button class="ghost small" onClick={() => switchProfile(p.id)}>
                  Open
                </button>
              )}
              {p.id !== list.default && (
                <button class="ghost small" onClick={() => act(() => put('/profiles/default', { id: p.id }), `${p.label} is the default`)}>
                  Make default
                </button>
              )}
              <button class="ghost small danger" onClick={() => setDeleting(p)}>
                Delete…
              </button>
            </div>
            {colouring === p.id && (
              <div class="profile-row-colour">
                <ColourChoice value={p.color || USUAL_COLOUR} label={`Colour of ${p.label}`} onPick={(color) => edit(p, { color })} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div class="row">
        <button class="small" onClick={() => setMaking(true)}>
          + New profile…
        </button>
      </div>
      <label class="inline profile-follow">
        <input type="checkbox" checked={list.follow_open} onChange={(e) => act(() => put('/profiles/follow-open', { on: (e.target as HTMLInputElement).checked }), 'Saved')} />
        <span>
          The profile I open becomes the default
          <span class="muted small" style="display:block">
            Off (the usual): the default stays the one you chose with Make default. The default profile is used by Claude, the Mac menu bar and the Android widgets when they name none.
          </span>
        </span>
      </label>
      {list.deleted.length > 0 && (
        <div class="stack profile-deleted">
          <h3>Recently deleted</h3>
          <ul class="plain">
            {list.deleted.map((p) => (
              <li key={p.id} class="row spread">
                <span class="row">
                  <ProfileDot p={p} />
                  <span>
                    {p.label} <span class="muted small">kept until {dayOf(p.restore_until)}</span>
                  </span>
                </span>
                <span class="row tight">
                  <button class="ghost small" onClick={() => restore(p)}>
                    Restore
                  </button>
                  <button class="ghost small danger" onClick={() => setPurging(p)}>
                    Delete now…
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {making && <NewProfileDialog onClose={() => setMaking(false)} />}
      {deleting && <DeleteProfileDialog p={deleting} last={all.length <= 1} onClose={() => setDeleting(null)} onDeleted={setJustDeleted} />}
      {purging && <PurgeDialog p={purging} onClose={() => setPurging(null)} />}
    </div>
  );
}

export function ManageProfilesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Manage profiles" onClose={onClose}>
      <p class="muted small">Each profile has its own projects, notes and habits, and its own settings and features. Its colour tints the app while it is open.</p>
      <ProfileList />
    </Dialog>
  );
}
