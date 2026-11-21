import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE, apiToken, call } from './helpers';
import { SELF } from 'cloudflare:test';

async function text(mode = 'work') {
  const res = await SELF.fetch(`${BASE}/api/swiftbar`, { headers: { Authorization: `Bearer ${await apiToken()}`, 'X-Mode': mode } });
  expect(res.status).toBe(200);
  return res.text();
}
async function action(fields: Record<string, string>, mode = 'work') {
  const res = await SELF.fetch(`${BASE}/api/swiftbar/action`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await apiToken()}`, 'X-Mode': mode, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  expect(res.status).toBe(200);
}

describe('SwiftBar menu bar', () => {
  it('shows focus, to-dos, habits and sends notifications once', async () => {
    const m = { mode: 'work' };
    expect((await text()).split('\n')[0]).toBe('◎');
    const p = await call('POST', '/projects', { name: 'Menu | bar project' }, m);
    await call('PUT', '/focus', { project_id: p.id }, m);
    const todo = await call('POST', '/todos', { title: 'Pay rent', day: '2001-01-01' }, m);
    const h = await call('POST', '/habits', { name: 'Walk', sessions: 1, per: 'day' }, m);
    await call('POST', '/reminders', { text: 'Call Bob', due: '2001-01-01T09:00:00Z' }, m);
    let out = await text();
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^◎ Menu\s+bar project •1( \| sfimage=\d+\.circle\.fill sfcolor=red)?$/); // "|" in the name is removed: it would break SwiftBar (the badge's own " | " is on purpose)
    expect(out).toContain(`☐ Pay rent (late) | bash=__SELF__ param1=tick param2=${todo.id}`); // the Today list (flag today-panel)
    expect(out).toContain(`param1=habit param2=${h.id}`);
    expect(out).toContain('Start session | bash=__SELF__ param1=start');
    const notify = lines.find((l) => l.startsWith('#notify'))!;
    const [, nid, title, body] = notify.split('\t');
    expect(body).toBe('Call Bob');
    await action({ action: 'seen', id: nid });
    out = await text();
    expect(out).not.toContain('#notify');
    expect(out.split('\n')[0]).not.toContain('•');
    expect(out).toContain('Call Bob'); // still listed until dismissed
    expect(title).toBe('Reminder');
    await action({ action: 'tick', id: todo.id });
    await action({ action: 'habit', id: h.id });
    await action({ action: 'dismiss', id: nid });
    out = await text();
    expect(out).not.toContain('Pay rent');
    expect(out).not.toContain('Walk');
    expect(out).not.toContain('Call Bob');
  });

  it('runs a session with pomodoro notifications', async () => {
    const m = { mode: 'work' };
    const p = await call('POST', '/projects', { name: 'Pomo' }, m);
    await call('PUT', '/focus', { project_id: p.id }, m);
    await action({ action: 'start' });
    let out = await text();
    expect(out.split('\n')[0]).toMatch(/^◉ Pomo (25:00|24:5\d)/);
    expect(out).toContain('Pause | bash=__SELF__ param1=pause');
    // Pretend the session started 26 minutes ago (saved the old way, without periods): work is over.
    const started = new Date(Date.now() - 26 * 60000).toISOString();
    await env.DB.prepare("UPDATE settings SET value = ? WHERE mode = 'work' AND key = 'session.current'")
      .bind(JSON.stringify({ project_id: p.id, started, pomodoro: { work: 25, break: 5 } }))
      .run();
    out = await text();
    expect(out.split('\n')[0]).toMatch(/^⏰ Pomo: break time/);
    expect(out).toMatch(/#notify\t\w+\tTime for a break/);
    expect(out).toContain('Start break | bash=__SELF__ param1=next');
    await action({ action: 'next' });
    out = await text();
    expect(out.split('\n')[0]).toMatch(/^☕ Pomo (5:00|4:5\d)/);
    expect(out).not.toContain('Time for a break');
    await action({ action: 'pause' });
    out = await text();
    expect(out.split('\n')[0]).toMatch(/^⏸ Pomo 26:0\d/);
    expect(out).toContain('Resume | bash=__SELF__ param1=resume');
    await action({ action: 'resume' });
    await action({ action: 'stop', where_stopped: 'page 3' });
    const log = await call('GET', `/log?project_id=${p.id}`, undefined, m);
    expect(log[0]).toMatchObject({ where_stopped: 'page 3', minutes: 26 });
    out = await text();
    expect(out).not.toContain('Break time'); // cleared when the session ended
  });
});
