// Map the tabs of a Focus Tracker v1 spreadsheet (layout v6, docs/schema.md in v1)
// to v2 rows. Pure functions: tested in scripts/v1-map.test.mjs.

/** Import order: a row's refs must exist before it. */
export const ORDER = ['categories', 'projects', 'backlog', 'lists', 'columns', 'tasks', 'todos', 'criteria', 'resources', 'habits', 'habit_log', 'log', 'skips', 'reminders', 'notes', 'stickies', 'links', 'whiteboards'];

const str = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v).trim());
const opt = (v) => str(v) || undefined;
const yes = (v) => /^(yes|true|1|y)$/i.test(str(v));
const num = (v) => (str(v) === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const int = (v) => (num(v) === undefined ? undefined : Math.round(num(v)));
/** A day as 2026-11-18 from an ISO text, a date, or a Date object. */
export function day(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = str(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}
function time(v) {
  const s = str(v);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T08:00:00.000Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}
const enumOr = (v, allowed, fallback) => (allowed.includes(str(v)) ? str(v) : fallback);

/** Rich text from v1's editor to Markdown: headings, bold, italic, links, lists, checkboxes, line breaks. */
export function htmlToMarkdown(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/\r?\n/g, ' ');
  s = s.replace(/<(h[1-6])[^>]*>(.*?)<\/\1>/gi, (_, h, t) => `\n\n${'#'.repeat(Number(h[1]))} ${t}\n\n`);
  s = s.replace(/<(strong|b)\b[^>]*>(.*?)<\/\1>/gi, '**$2**');
  s = s.replace(/<(em|i)\b[^>]*>(.*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<(s|strike|del)\b[^>]*>(.*?)<\/\1>/gi, '~~$2~~');
  s = s.replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  s = s.replace(/<li[^>]*>\s*<input[^>]*checked[^>]*>/gi, '<li>[x] ');
  s = s.replace(/<li[^>]*>\s*<input[^>]*type="checkbox"[^>]*>/gi, '<li>[ ] ');
  s = s.replace(/<ol[^>]*>(.*?)<\/ol>/gi, (_, body) => {
    let n = 0;
    return '\n' + body.replace(/<li[^>]*>(.*?)<\/li>/gi, (_m, t) => `${++n}. ${t.trim()}\n`) + '\n';
  });
  s = s.replace(/<ul[^>]*>(.*?)<\/ul>/gi, (_, body) => '\n' + body.replace(/<li[^>]*>(.*?)<\/li>/gi, (_m, t) => `- ${t.trim()}\n`) + '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div)>/gi, '\n\n').replace(/<(p|div)[^>]*>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const noteOf = (r) => (str(r.note_html) ? htmlToMarkdown(r.note_html) : opt(r.note));

/**
 * @param tabs {Record<string, Record<string, unknown>[]>} rows of each v1 tab, keyed by tab name ("Projects", "To-dos" ...)
 * @param docs {Record<string, string>} Markdown of each notes Doc, keyed by Doc id (optional)
 */
export function mapV1(tabs, docs = {}) {
  const t = (name) => (tabs[name] ?? []).filter((r) => str(r.id) || name === 'Settings');
  const out = Object.fromEntries(ORDER.map((k) => [k, []]));
  const warnings = [];

  out.categories = t('Categories').map((r) => ({ id: str(r.id), label: str(r.label) || 'Unnamed', color: opt(r.color), ord: num(r.order) }));
  out.projects = t('Projects').map((r) => ({
    id: str(r.id),
    name: str(r.name) || 'Unnamed project',
    category_id: opt(r.category),
    status: enumOr(r.status, ['active', 'paused', 'done', 'dropped'], str(r.status) === 'finished' ? 'done' : 'active'),
    locked_until: day(r.locked_until),
    last_touched: day(r.last_touched),
    created: time(r.created),
    updated_at: time(r.updated_at),
  }));
  out.backlog = t('Backlog').map((r) => ({ id: str(r.id), title: str(r.title), category_id: opt(r.category), note: opt(r.note), ord: num(r.order), created: time(r.created) }));
  out.lists = t('Lists').map((r) => ({
    id: str(r.id),
    name: str(r.name) || 'Unnamed',
    kind: enumOr(r.kind, ['todo', 'note'], 'list'),
    project_id: opt(r.project_id),
    show_today: yes(r.show_today),
    color: opt(r.color),
    ord: num(r.order),
    created: time(r.created),
  }));
  const listIds = new Set(out.lists.map((l) => l.id));
  out.columns = t('Columns').map((r) => {
    // Before v2 of the sheet, project_id also held list ids.
    let project_id = opt(r.project_id);
    let list_id = opt(r.list_id);
    if (!list_id && project_id && listIds.has(project_id)) [list_id, project_id] = [project_id, undefined];
    return { id: str(r.id), name: str(r.name) || 'Column', project_id, list_id, ord: num(r.order) };
  });
  out.tasks = t('Tasks').map((r) => ({
    id: str(r.id),
    title: str(r.title) || 'Untitled',
    column_id: opt(r.column_id),
    project_id: opt(r.project_id),
    list_id: opt(r.list_id),
    note: noteOf(r),
    color: opt(r.color),
    ord: num(r.order),
    created: time(r.created),
    updated_at: time(r.updated_at),
  }));
  out.todos = t('To-dos').map((r) => ({
    id: str(r.id),
    title: str(r.title) || 'Untitled',
    list_id: opt(r.list_id),
    group_id: opt(r.group_id),
    day: day(r.day),
    done: day(r.done),
    project_id: opt(r.project_id),
    note: noteOf(r),
    color: opt(r.color),
    ord: num(r.order),
    created: time(r.created),
    updated_at: time(r.updated_at),
  }));
  out.criteria = t('Criteria').map((r) => ({ id: str(r.id), project_id: str(r.project_id), text: str(r.text), done: yes(r.done) || !!day(r.done), ord: num(r.order), created: time(r.created) }));
  out.resources = t('Resources').map((r) => ({
    id: str(r.id),
    title: str(r.title) || str(r.value ?? r.url),
    type: enumOr(r.type, ['link', 'drive', 'phone', 'email', 'text'], 'link'),
    value: str(r.value ?? r.url),
    grp: opt(r.group),
    note: opt(r.note),
    project_id: opt(r.project_id),
    category_id: opt(r.category),
    created: time(r.added),
  }));
  out.habits = t('Habits').map((r) => ({
    id: str(r.id),
    name: str(r.name) || 'Habit',
    intention: opt(r.intention),
    sessions: int(r.sessions),
    per: enumOr(r.per, ['day', 'week'], undefined),
    size: opt(r.size),
    small_version: opt(r.small_version),
    goal: opt(r.goal),
    step_up_every: opt(r.step_up_every),
    prompts: opt(r.prompts),
    category_id: opt(r.category),
    description: opt(r.description),
    status: enumOr(r.status, ['active', 'paused', 'ended', 'aspiring'], 'active'),
    started: day(r.started),
    next_prompt: time(r.next_prompt),
    ord: num(r.order),
    updated_at: time(r.updated_at),
  }));
  out.habit_log = t('Habit log').map((r) => ({
    id: str(r.id),
    habit_id: str(r.habit_id),
    day: day(r.day),
    kind: enumOr(r.kind, ['done', 'plan', 'skip', 'level', 'pending', 'answer'], 'done'),
    count: int(r.count) ?? 1,
    value: opt(r.value),
    updated_at: time(r.updated_at),
  }));
  out.log = t('Log').map((r) => ({ id: str(r.id), project_id: opt(r.project_id), date: day(r.date), minutes: int(r.minutes), where_stopped: opt(r.where_stopped), created: time(r.date) }));
  out.skips = t('Skips').map((r) => ({ id: str(r.id), project_id: str(r.project_id), to_project_id: opt(r.to_project_id), date: day(r.date) }));
  out.reminders = t('Reminders').map((r) => ({ id: str(r.id), project_id: opt(r.project_id), due: time(r.due), done: time(r.done), created: time(r.created) }));
  out.stickies = t('Stickies').map((r) => ({
    id: str(r.id),
    project_id: str(r.project_id),
    text: opt(r.text),
    color: opt(r.color),
    opacity: num(r.opacity),
    x: num(r.x),
    y: num(r.y),
    w: num(r.w),
    h: num(r.h),
    created: time(r.created),
  }));
  out.links = t('Links').map((r) => ({ id: str(r.id), from_id: str(r.from_id), to_id: str(r.to_id), type: enumOr(r.type, ['blocks', 'relates'], 'relates'), note: opt(r.note), created: time(r.created) }));
  // Whiteboard scenes live in .excalidraw files in Drive; the rows come across, the drawings come with Drive sync.
  out.whiteboards = t('Whiteboards').map((r) => ({ id: str(r.id), name: str(r.name) || 'Whiteboard', project_id: opt(r.project_id), show_today: yes(r.show_today), created: time(r.created) }));
  if (out.whiteboards.length) warnings.push(`${out.whiteboards.length} whiteboards: names imported, drawings stay in Drive for now`);

  for (const r of t('Notes')) {
    if (r.id === 'today') continue;
    const docId = str(r.doc_id);
    const body = docs[docId];
    if (docId && body === undefined) warnings.push(`Notes ${r.id}: no text for Doc ${docId} (export it into the docs folder as ${docId}.md)`);
    out.notes.push({ id: str(r.id), project_id: opt(r.project_id), list_id: opt(r.list_id), body: body ?? str(r.preview), show_today: yes(r.show_today) });
  }

  // Drop empty optional values; the server fills defaults.
  for (const k of ORDER) out[k] = out[k].map((row) => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== '')));

  const settings = {};
  for (const r of tabs.Settings ?? []) {
    const key = str(r.key);
    if (/^(rotation|week)\./.test(key)) settings[key] = str(r.value);
  }
  return { rows: out, settings, warnings };
}
