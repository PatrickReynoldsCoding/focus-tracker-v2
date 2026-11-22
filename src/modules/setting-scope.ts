// Where a setting change applies: this profile only (the usual) or every profile (DECISIONS D46).
// The settings themselves are listed by their modules (Module.scopedSettings); this module adds
// the overview the Settings page draws its badges from, "Use the global value", "Apply to all
// profiles", the feature switches as settings, and Claude's tools for all of it.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import { allFeatures, featureSettings, featureStates, setFeature } from '../core/features';
import type { Module } from '../core/registry';
import { applyToAll, parseScope, scopedSetting, scopeStates, SCOPES, useGlobal, writeScoped } from '../core/setting-scope';

const scopeArg = z.enum(SCOPES).optional().describe('"profile" (the usual): this profile only. "all": every profile (other profiles lose their own value for it).');

async function features(ctx: Ctx) {
  const states = await featureStates(ctx);
  const scopes = new Map((await scopeStates(ctx)).filter((s) => s.section === 'features').map((s) => [s.id, s]));
  return allFeatures().map((f) => {
    const s = scopes.get(`features.${f.id}`);
    return { id: f.id, label: f.label, description: f.description, enabled: states[f.id], experimental: !!f.experimental, own: !!s?.own, for_all: s?.global ? s.global_value : null };
  });
}

export const settingScopeModule: Module = {
  id: 'setting-scope',
  description: 'Settings for one profile or for every profile: the overview, use the global value, apply to all profiles.',
  scopedSettings: featureSettings,
  routes(api) {
    api.get('/setting-scope', async (c) => c.json(await scopeStates(c.get('ctx'))));
    // "Use the global value": this profile drops its own value.
    api.delete('/setting-scope/:id', async (c) => {
      const ctx = c.get('ctx');
      await useGlobal(ctx, scopedSetting(c.req.param('id')));
      return c.json(await scopeStates(ctx));
    });
    // What this profile uses becomes every profile's value.
    api.post('/setting-scope/:id/all', async (c) => {
      const ctx = c.get('ctx');
      const r = await applyToAll(ctx, scopedSetting(c.req.param('id')));
      return c.json({ cleared: r.cleared, settings: await scopeStates(ctx) });
    });
    // One setting, for this profile or every profile (the generic way; sections have their own calls too).
    api.put('/setting-scope/:id', async (c) => {
      const ctx = c.get('ctx');
      const b = await c.req.json<{ value?: unknown; scope?: string }>();
      if (b.value === undefined) throw bad('Send {"value": …, "scope": "profile" | "all"}');
      const r = await writeScoped(ctx, scopedSetting(c.req.param('id')), b.value, parseScope(b.scope ?? c.req.query('scope')));
      return c.json({ cleared: r.cleared, settings: await scopeStates(ctx) });
    });
  },
  tools: [
    {
      name: 'get_setting_scopes',
      description:
        'The settings that can be set for one profile or for every profile (feature switches, notifications, Pomodoro, session length, link types, Today’s view): for each, the value this profile uses, whether it has its own value (own), whether there is a value for every profile (global, global_value) and which profiles have their own.',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => scopeStates(ctx),
    },
    {
      name: 'set_setting',
      description:
        'Change one setting from get_setting_scopes by its id (such as pomodoro.work, nudge.hour, session.length, features.tags, notify.reminders, today-view.focusCard). value: a number, true/false, text, or null to go back to the value for every profile (or the default). scope "all" sets it for every profile. The specific tools (set_feature, set_notification_settings) do the same for their parts.',
      input: z.object({ id: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown())]), scope: scopeArg }),
      run: async (ctx, a) => {
        const r = await writeScoped(ctx, scopedSetting(a.id), a.value, parseScope(a.scope));
        return { ...(await scopeStates(ctx)).find((s) => s.id === a.id), cleared: r.cleared };
      },
    },
    {
      name: 'use_global_setting',
      description: 'This profile stops having its own value for a setting (id from get_setting_scopes) and uses the value set for every profile (or the default when there is none).',
      input: z.object({ id: z.string() }),
      run: async (ctx, a) => {
        await useGlobal(ctx, scopedSetting(a.id));
        return (await scopeStates(ctx)).find((s) => s.id === a.id);
      },
    },
    {
      name: 'apply_setting_to_all_profiles',
      description: 'Make the value this profile uses for a setting (id from get_setting_scopes) the value for every profile; profiles that had their own value lose it (cleared lists them).',
      input: z.object({ id: z.string() }),
      run: async (ctx, a) => {
        const r = await applyToAll(ctx, scopedSetting(a.id));
        return { ...(await scopeStates(ctx)).find((s) => s.id === a.id), cleared: r.cleared };
      },
    },
    {
      name: 'get_features',
      description: 'The feature switches (Settings → Features) of the profile: id, label, what it does, whether it is on, whether this profile has its own value (own) and the value for every profile (for_all, null when none).',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => features(ctx),
    },
    {
      name: 'set_feature',
      description: 'Turn a feature switch (id from get_features) on or off in this profile, or with scope "all" in every profile. Tools that belong to a feature that is off are refused in that profile.',
      input: z.object({ id: z.string(), enabled: z.boolean(), scope: scopeArg }),
      run: async (ctx, a) => {
        const r = await setFeature(ctx, a.id, a.enabled, parseScope(a.scope));
        return { ...(await features(ctx)).find((f) => f.id === a.id), cleared: r.cleared };
      },
    },
  ],
};
