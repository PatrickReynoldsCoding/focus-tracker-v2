// A small, stateless MCP server (Streamable HTTP, JSON responses).
// Every tool comes from the modules (src/modules/*), plus an optional `mode` argument.

import { z } from 'zod';
import { errorResponse, resolveMode } from '../api';
import { Ctx, type Env } from '../core/ctx';
import { ApiError } from '../core/errors';
import { FEATURES_KEY, isOn, statesFrom } from '../core/features';
import { allTools, type Tool } from '../core/registry';

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = SUPPORTED[0];

const INSTRUCTIONS = `Focus Tracker is the owner's personal tracker: projects with Kanban boards, notes (Markdown), lists, to-dos, habits, a daily focus project and work sessions.
- Data is split into profiles (called modes in the tools), such as "personal" and "work"; list_profiles gives them all. Every tool takes an optional "mode" (a profile's id); without it the default profile is used. Each profile has its own settings and feature switches, so a tool can be off in one profile and on in another.
- Start with get_today for the day, list_projects / get_project for projects, search to find anything.
- Never choose today's focus project unless the owner asks: each day starts empty until they choose.
- Never store sensitive material (bank or card details, passwords, ID numbers, health records) in resources or notes.
- Link a Google Doc, Sheet, Drive file or any address to a project (or share it with a category) with add_resource; the type and icon are worked out from the address.
- Every change can be undone with the undo tool; tell the owner what you changed.`;

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

const modeArg = z.string().optional().describe('Profile id such as "personal" or "work" (list_profiles). Default: the default profile.');

/** Tools whose feature is on in at least one profile: tools/list names no profile, and a call may name any (D35). */
async function enabledTools(env: Env): Promise<Tool[]> {
  const rows = (
    await env.DB.prepare('SELECT m.id, s.value FROM modes m LEFT JOIN settings s ON s.mode = m.id AND s.key = ?').bind(FEATURES_KEY).all<{ id: string; value: string | null }>()
  ).results;
  const on = new Set<string>();
  for (const r of rows) {
    let chosen: Record<string, boolean> = {};
    try {
      chosen = r.value ? JSON.parse(r.value) : {};
    } catch {
      /* a broken value: the defaults */
    }
    for (const [id, v] of Object.entries(statesFrom(chosen))) if (v) on.add(id);
  }
  return (allTools() as Tool[]).filter((t) => !t.feature || on.has(t.feature));
}

async function toolList(env: Env) {
  return (await enabledTools(env)).map((t) => {
    const schema = z.toJSONSchema(t.input instanceof z.ZodObject ? t.input.extend({ mode: modeArg }) : t.input, { io: 'input' }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: t.name,
      description: t.description,
      inputSchema: schema,
      annotations: { readOnlyHint: !!t.readOnly, destructiveHint: t.name.startsWith('delete') || t.name === 'undo', openWorldHint: false },
    };
  });
}

async function callTool(env: Env, name: string, args: Record<string, unknown>) {
  const tool = (await enabledTools(env)).find((t) => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true };
  try {
    const { mode, ...rest } = args ?? {};
    const parsed = tool.input.parse(rest);
    const ctx = new Ctx(env, await resolveMode(env, typeof mode === 'string' ? mode : undefined));
    // The switches of the profile the call is for decide.
    if (tool.feature && !(await isOn(ctx, tool.feature)))
      throw new ApiError(404, `${name} is turned off in the profile "${ctx.mode}" (its feature ${tool.feature} is off there: Settings → Features)`, 'feature_off');
    ctx.label = `Claude: ${name}`;
    const result = await tool.run(ctx, parsed);
    await ctx.flushUndo();
    const text = JSON.stringify(result ?? { ok: true }, null, 1);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const res = errorResponse(err);
    const body = (await res.json()) as { error: string };
    if (!(err instanceof ApiError) && !(err instanceof z.ZodError)) console.error('tool failed', name, err);
    return { content: [{ type: 'text', text: body.error }], isError: true };
  }
}

async function handle(env: Env, msg: Rpc): Promise<Record<string, unknown> | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return null; // a notification: nothing to answer
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return reply({
        protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'focus-tracker', title: 'Focus Tracker', version: '2.0.0' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: await toolList(env) });
    case 'tools/call':
      return reply(await callTool(env, String(msg.params?.name), (msg.params?.arguments ?? {}) as Record<string, unknown>));
    case 'resources/list':
      return reply({ resources: [] });
    case 'prompts/list':
      return reply({ prompts: [] });
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export async function mcpFetch(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  const msgs = Array.isArray(body) ? (body as Rpc[]) : [body as Rpc];
  const out = (await Promise.all(msgs.map((m) => handle(env, m)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? out : out[0]);
}
