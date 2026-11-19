// Resources: links, Google Drive items (with their icons), phone numbers, emails and text kept
// with a project, plus the resources a category shares with all its projects.
// Registers the project page's 'resources' panel (it replaces the plain list that used to sit in
// features/projects) and a panel on the Projects tab for the shared ones.
import './resources.css';
import { useEffect, useState } from 'preact/hooks';
import { registerPanel, type ProjectPanelProps, type ProjectsPanelProps } from '../../core/registry';
import { useData } from '../../core/ui';
import type { Resource } from './model';
import { ResourceBlock } from './ResourceBlock';

type Category = { id: string; label: string };

/** Resources shared by a category: loaded on their own, edited in place. */
function Shared({ category, empty }: { category: string; empty?: string }) {
  const { data, setData } = useData<Resource[]>(`/resources?category_id=${category}&project_id=&limit=2000`);
  if (!data) return <p class="muted small">Loading…</p>;
  return <ResourceBlock items={data} setItems={(fn) => setData(fn)} owner={{ category_id: category }} empty={empty} />;
}

function ProjectResources({ project, setProject }: ProjectPanelProps) {
  const { data: cats } = useData<Category[]>('/categories');
  const catName = cats?.find((c) => c.id === project.category_id)?.label;
  const items: Resource[] = project.resources;
  return (
    <section class="card resources-card">
      <div class="card-head">
        <h2>Resources</h2>
        <span class="muted">{items.length || ''}</span>
      </div>
      <ResourceBlock
        items={items}
        setItems={(fn) => setProject((p: any) => ({ ...p, resources: fn(p.resources) }))}
        owner={{ project_id: project.id }}
        empty="Links, Google Docs, phone numbers and notes for this project."
      />
      {project.category_id && (
        <div class="res-shared">
          <h3 class="res-shared-head">Shared with {catName ? `all ${catName} projects` : 'this category'}</h3>
          <Shared category={project.category_id} empty="Nothing shared yet. Add shared resources on the Projects tab, or here." />
        </div>
      )}
    </section>
  );
}

function SharedPanel({ category }: ProjectsPanelProps) {
  const { data: cats } = useData<Category[]>('/categories');
  const [sel, setSel] = useState(category);
  useEffect(() => setSel(category), [category]);
  if (!cats?.length) return null;
  const chosen = cats.find((c) => c.id === sel)?.id ?? cats[0].id;
  return (
    <section class="card resources-card">
      <div class="card-head">
        <h2>Shared resources</h2>
        <select class="res-cat" value={chosen} onChange={(e) => setSel((e.target as HTMLSelectElement).value)} aria-label="Category">
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <p class="muted small">Shown on every project in this category, under its own resources.</p>
      <Shared key={chosen} category={chosen} empty="No shared resources for this category yet." />
    </section>
  );
}

registerPanel('project', { id: 'resources', title: 'Resources', description: 'Links and files for this project.', order: 40, render: (p) => <ProjectResources {...p} /> });
registerPanel('projects', { id: 'shared-resources', order: 10, render: (p) => <SharedPanel {...p} /> });
