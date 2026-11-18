// A small, stateless MCP server (Streamable HTTP, JSON responses).
// Every tool comes from the modules (src/modules/*), plus an optional `mode` argument.

import { z } from 'zod';
import { errorResponse, resolveMode } from '../api';
import { Ctx, type Env } from '../core/ctx';
import { ApiError } from '../core/errors';
import { featureStates } from '../core/features';
import { allTools, type Tool } from '../core/registry';

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = SUPPORTED[0];

const INSTRUCTIONS = `Focus Tracker is the owner's personal tracker: projects with Kanban boards, notes (Markdown), lists, to-dos, habits, a daily focus project and work sessions.
- Data is split into modes (usually "personal" and "work"). Every tool takes an optional "mode"; without it the default mode is used.
- Start with get_today for the day, list_projects / get_project for projects, search to find anything.
- Never choose today's focus project unless the owner asks: each day starts empty until they choose.
- Never store sensitive material (bank or card details, passwords, ID numbers, health records) in resources or notes.
- Every change can be undone with the undo tool; tell the owner what you changed.`;

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

const modeArg = z.string().optional().describe('Mode such as "personal" or "work". Default: the default mode.');

async function enabledTools(env: Env): Promise<Tool[]> {
  const ctx = new Ctx(env, await resolveMode(env, undefined));
  const states = await featureStates(ctx);
  return (allTools() as Tool[]).filter((t) => !t.feature || states[t.feature]);
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
