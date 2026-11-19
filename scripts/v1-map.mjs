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
/** A name for matching: lower case, letters and digits only. */
export const nameKey = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
/** v1 category ids can be short names ("job"); v2 ids are 6 to 40 letters, digits, _ or -. Same input, same output. */
const catId = (v) => {
  const s = str(v);
  return !s || /^[A-Za-z0-9_-]{6,40}$/.test(s) ? s || undefined : `cat_${s.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 40).padEnd(6, '_');
};
const enumOr = (v, allowed, fallback) => (allowed.includes(str(v)) ? str(v) : fallback);

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
const ENTITIES = { nbsp: ' ', lt: '<', gt: '>', quot: '"', amp: '&', apos: "'", ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
const decode = (t) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Tiny forgiving HTML parser: { tag, attrs, kids } nodes and text strings. */
function parseHtml(html) {
  const root = { tag: '#root', attrs: '', kids: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+|<)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) stack.at(-1).kids.push(m[4]);
    else if (m[2]) {
      const tag = m[2].toLowerCase();
      if (m[1]) {
        const i = stack.map((n) => n.tag).lastIndexOf(tag);
        if (i > 0) stack.length = i;
      } else {
        const node = { tag, attrs: m[3], kids: [] };
        // an unclosed <li>/<p>/<td> ends when the next one starts
        if (['li', 'p', 'td', 'th', 'tr'].includes(tag)) {
          const i = stack.map((n) => n.tag).lastIndexOf(tag);
          const barrier = stack.map((n) => n.tag).findLastIndex((t) => ['ul', 'ol', 'table'].includes(t));
          if (i > 0 && i > barrier) stack.length = i;
        }
        stack.at(-1).kids.push(node);
        if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(node);
      }
    }
  }
  return root;
}

const attr = (n, name) => decode(n.attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))?.slice(2).find((x) => x !== undefined) ?? '');
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'blockquote', 'pre', 'hr', 'section', 'article', 'body', 'html', 'head', 'style', 'script']);
const wrap = (mark, s) => {
  const core = s.trim();
  if (!core) return s;
  return `${s.match(/^\s*/)[0]}${mark}${core}${mark}${s.match(/\s*$/)[0]}`;
};

function inline(nodes, plain = false) {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') {
      out += decode(n.replace(/\s+/g, ' '));
      continue;
    }
    const kids = () => inline(n.kids, plain);
    switch (n.tag) {
      case 'br': out += '\n'; break;
      case 'strong': case 'b': out += plain ? kids() : wrap('**', kids()); break;
      case 'em': case 'i': out += plain ? kids() : wrap('*', kids()); break;
      case 's': case 'strike': case 'del': out += plain ? kids() : wrap('~~', kids()); break;
      case 'code': out += plain ? kids() : wrap('`', kids()); break;
      case 'a': {
        const href = attr(n, 'href');
        const text = kids();
        out += href && text.trim() ? `[${text.trim()}](${href})` : text;
        break;
      }
      case 'img': out += attr(n, 'alt'); break;
      case 'input': out += /\bchecked\b/i.test(n.attrs) ? '[x] ' : '[ ] '; break;
      case 'style': case 'script': case 'head': break;
      default: out += kids();
    }
  }
  return out;
}

const tidy = (s) => s.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/ {2,}/g, ' ').replace(/^\n+|\n+$/g, '').trim();
const indent = (s, pad) => s.split('\n').map((l) => (l ? pad + l : l)).join('\n');

function list(n) {
  const ordered = n.tag === 'ol';
  let i = 0;
  const lines = [];
  for (const li of n.kids.filter((k) => typeof k !== 'string' && k.tag === 'li')) {
    const marker = ordered ? `${++i}. ` : '- ';
    const parts = blocks(li.kids);
    const first = parts.shift() ?? '';
    let item = marker + first.replace(/\n/g, '\n' + ' '.repeat(marker.length));
    for (const p of parts) item += '\n' + indent(p, p.startsWith('- ') || /^\d+\. /.test(p) ? '  ' : ' '.repeat(marker.length));
    lines.push(item);
  }
  return lines.join('\n');
}

function table(n) {
  const rows = [];
  const walk = (nodes) => {
    for (const k of nodes) {
      if (typeof k === 'string') continue;
      if (k.tag === 'tr') rows.push(k.kids.filter((c) => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th')).map((c) => tidy(inline(c.kids)).replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
      else walk(k.kids);
    }
  };
  walk(n.kids);
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

/** Render child nodes as an array of Markdown blocks. */
function blocks(nodes, plainHeading = false) {
  const out = [];
  let buf = [];
  const flush = () => {
    const t = tidy(inline(buf));
    if (t) out.push(t);
    buf = [];
  };
  for (const n of nodes) {
    if (typeof n === 'string' || !BLOCK.has(n.tag)) {
      buf.push(n);
      continue;
    }
    flush();
    if (/^h[1-6]$/.test(n.tag)) {
      const t = tidy(inline(n.kids, true)).replace(/\n+/g, ' ');
      if (t) out.push(`${'#'.repeat(Number(n.tag[1]))} ${t}`);
    } else if (n.tag === 'ul' || n.tag === 'ol') {
      const t = list(n);
      if (t) out.push(t);
    } else if (n.tag === 'li') out.push(...blocks(n.kids));
    else if (n.tag === 'table') {
      const t = table(n);
      if (t) out.push(t);
    } else if (n.tag === 'blockquote') out.push(indent(blocks(n.kids).join('\n\n'), '> ').replace(/^(\s*)$/gm, '>'));
    else if (n.tag === 'pre') out.push('```\n' + decode(n.kids.map((k) => (typeof k === 'string' ? k : inline([k]))).join('')).replace(/^\n+|\n+$/g, '') + '\n```');
    else if (n.tag === 'hr') out.push('---');
    else if (['style', 'script', 'head'].includes(n.tag)) continue;
    else out.push(...blocks(n.kids));
  }
  flush();
  return out;
}

/** Rich text (v1 editor HTML, or Word via mammoth) to Markdown: headings, bold, italic, links, nested lists, checkboxes, tables, code, quotes. */
export function htmlToMarkdown(html) {
  if (!html) return '';
  return blocks(parseHtml(String(html)).kids).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

const noteOf = (r) => (str(r.note_html) ? htmlToMarkdown(r.note_html) : opt(r.note));

/**
 * @param tabs {Record<string, Record<string, unknown>[]>} rows of each v1 tab, keyed by tab name ("Projects", "To-dos" ...)
 * @param docs {Record<string, string>} Markdown of each notes Doc, keyed by Doc id (optional)
 * @param extra {{ named?: Record<string, string>, scenes?: Record<string, object> }} `named`: Markdown keyed by file name without
 *   extension ("My project notes"), matched to a project or note list by name when the Doc id has no file; `scenes`: Excalidraw
 *   scenes keyed by whiteboard id.
 */
export function mapV1(tabs, docs = {}, extra = {}) {
  const t = (name) => (tabs[name] ?? []).filter((r) => str(r.id) || name === 'Settings');
  const out = Object.fromEntries(ORDER.map((k) => [k, []]));
  const warnings = [];
  const unmatched = { docs: [], scenes: [] };

  out.categories = t('Categories').map((r) => ({ id: catId(r.id), label: str(r.label) || 'Unnamed', color: opt(r.color), ord: num(r.order) }));
  out.projects = t('Projects').map((r) => ({
    id: str(r.id),
    name: str(r.name) || 'Unnamed project',
    category_id: catId(r.category),
    status: enumOr(r.status, ['active', 'paused', 'done', 'dropped'], str(r.status) === 'finished' ? 'done' : 'active'),
    locked_until: day(r.locked_until),
    last_touched: day(r.last_touched),
    created: time(r.created),
    updated_at: time(r.updated_at),
  }));
  out.backlog = t('Backlog').map((r) => ({ id: str(r.id), title: str(r.title), category_id: catId(r.category), note: opt(r.note), ord: num(r.order), created: time(r.created) }));
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
    category_id: catId(r.category),
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
    category_id: catId(r.category),
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
  const scenes = extra.scenes ?? {};
  const boardIds = new Set(out.whiteboards.map((w) => w.id));
  for (const w of out.whiteboards) if (scenes[w.id]) w.scene = scenes[w.id];
  unmatched.scenes = Object.keys(scenes).filter((id) => !boardIds.has(id));
  const bare = out.whiteboards.filter((w) => !w.scene).length;
  if (bare) warnings.push(`${bare} whiteboards have no drawing file (names imported, drawing stays in Drive)`);

  const named = new Map(Object.entries(extra.named ?? {}).map(([k, v]) => [nameKey(k), { file: k, text: v, used: false }]));
  const projectName = new Map(out.projects.map((p) => [p.id, p.name]));
  const listName = new Map(out.lists.map((l) => [l.id, l.name]));
  for (const r of t('Notes')) {
    if (r.id === 'today') continue;
    const docId = str(r.doc_id);
    let body = docs[docId];
    if (body === undefined) {
      const owner = projectName.get(str(r.project_id)) ?? listName.get(str(r.list_id));
      const hit = owner && (named.get(nameKey(`${owner} notes`)) ?? named.get(nameKey(owner)));
      if (hit && !hit.used) {
        hit.used = true;
        body = hit.text;
      } else if (docId) warnings.push(`Notes ${r.id}: no file for Doc ${docId}${owner ? ` or "${owner} notes"` : ''}; used the v1 preview`);
    }
    out.notes.push({ id: str(r.id), project_id: opt(r.project_id), list_id: opt(r.list_id), body: body || str(r.preview), show_today: yes(r.show_today) });
  }
  unmatched.docs = [...named.values()].filter((n) => !n.used).map((n) => n.file);

  // Drop empty optional values; the server fills defaults.
  for (const k of ORDER) out[k] = out[k].map((row) => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== '')));

  const settings = {};
  for (const r of tabs.Settings ?? []) {
    const key = str(r.key);
    if (/^(rotation|week)\./.test(key)) settings[key] = str(r.value);
  }
  return { rows: out, settings, warnings, unmatched };
}
