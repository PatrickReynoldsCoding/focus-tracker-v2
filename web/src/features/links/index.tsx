// Issue links (Jira style): "Linked items" on the project page and in the card dialog,
// "Blocked by …" at the top of a blocked project, a mark on blocked cards, and custom
// link types in Settings. Server side: src/modules/relations.ts.
import './links.css';
import { useState } from 'preact/hooks';
import { change, del, post, say } from '../../core/api';
import { OwnValue, scopedChange, ScopeChoice, useScopeStates } from '../../core/scope';
import { useFlag } from '../../core/features';
import { registerPanel, type CardTileProps } from '../../core/registry';
import { Loading, useData } from '../../core/ui';
import { LinkedItems } from './LinkedItems';
import { BlockedBy, FLAG, useBlocked, useOpener, type Item, type LinkType } from './shared';

function ProjectBlocked({ items }: { items: Item[] }) {
  const { open, node } = useOpener();
  return (
    <div class="blocked-banner">
      <BlockedBy items={items} open={open} />
      {node}
    </div>
  );
}

function BlockedMark({ card }: CardTileProps) {
  const by = useBlocked()?.tasks?.[card.id];
  if (!by) return null;
  const text = `Blocked by ${by.map((b) => b.title).join(', ')}`;
  return (
    <span class="blocked-mark" title={text} aria-label={text}>
      ⛔
    </span>
  );
}

function LinkTypes() {
  const on = useFlag(FLAG);
  const { data } = useData<LinkType[]>(on ? '/links/types' : null);
  const { states, of } = useScopeStates();
  // The whole list is one setting (D46): this profile's, or every profile's with All profiles.
  const send = (run: (scope: 'profile' | 'all') => Promise<unknown>, done: string) =>
    scopedChange('link-types', ['links.types'], states, (scope) => change(() => run(scope)).then((ok) => ok && say(scope === 'all' ? `${done} for every profile` : done)));
  const [outward, setOutward] = useState('');
  const [inward, setInward] = useState('');
  if (!on) return null;
  if (!data) return <Loading />;
  return (
    <section class="card">
      <h2>Link types</h2>
      <p class="muted small">
        How items can be linked. Each type reads one way from each item.
        <OwnValue state={of('links.types')} section="link-types" />
      </p>
      <ScopeChoice section="link-types" />
      <ul class="plain link-types">
        {data.map((t) => (
          <li key={t.id}>
            <span>
              {t.outward}
              {t.inward !== t.outward && <span class="muted"> / {t.inward}</span>}
            </span>
            {t.custom ? (
              <button class="icon small" aria-label={`Remove ${t.outward}`} onClick={() => send((scope) => del(`/links/types/${t.id}?scope=${scope}`), 'Link type removed')}>
                ✕
              </button>
            ) : (
              <span class="tag">built in</span>
            )}
          </li>
        ))}
      </ul>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!outward.trim()) return;
          // Link types are settings, which undo does not cover: a plain message.
          send((scope) => post('/links/types', { outward, inward, scope }), 'Link type added');
          setOutward('');
          setInward('');
        }}
      >
        <input placeholder="Outward, e.g. funds" value={outward} onInput={(e) => setOutward((e.target as HTMLInputElement).value)} aria-label="Outward phrase" />
        <input placeholder="Inward, e.g. is funded by" value={inward} onInput={(e) => setInward((e.target as HTMLInputElement).value)} aria-label="Inward phrase" />
        <button class="ghost" disabled={!outward.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

registerPanel('project', {
  id: 'blocked-by',
  icon: '⛓',
  title: 'Blocked by',
  description: 'Projects this one waits for. Shown only while it is blocked.',
  order: 5,
  feature: FLAG,
  render: ({ project }) => (project.blocked_by?.length ? <ProjectBlocked items={project.blocked_by} /> : null),
});
registerPanel('project', {
  id: 'links',
  icon: '🔗',
  title: 'Linked items',
  description: 'Projects, cards and lists linked to this project.',
  order: 35,
  feature: FLAG,
  render: ({ project }) => (
    <section class="card">
      <LinkedItems kind="projects" id={project.id} showBlocked={false} />
    </section>
  ),
});
registerPanel('card', {
  id: 'links',
  order: 40,
  feature: FLAG,
  render: ({ card, close }) => <LinkedItems kind="tasks" id={card.id} heading="h3" close={close} />,
});
registerPanel('card-tile', { id: 'blocked', order: 10, feature: FLAG, render: ({ card }) => <BlockedMark card={card} /> });
registerPanel('settings', { id: 'link-types', order: 35, scope: 'profile', feature: 'custom-link-types', icon: '🔗', summary: () => 'Your own kinds of link', render: () => <LinkTypes /> });
