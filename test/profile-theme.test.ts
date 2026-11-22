// A profile's own colour theme (D61): saved with the profile, cleared by an empty value, refused when malformed, kept when deleted and restored.
import { expect, it } from 'vitest';
import { call } from './helpers';

it('saves, clears and restores a profile theme', async () => {
  const made = (await call('POST', '/profiles', { label: 'Themed one' }, { expect: 201 })).profile;
  expect(made.theme).toBeNull();
  const set = await call('PATCH', `/profiles/${made.id}`, { theme: 'forest' });
  expect(set.theme).toBe('forest');
  expect((await call('GET', '/profiles')).profiles.find((p: any) => p.id === made.id).theme).toBe('forest');
  await call('PATCH', `/profiles/${made.id}`, { theme: 'Not A Theme!' }, { expect: 400 });
  await call('POST', `/profiles/${made.id}/delete`, { confirm: 'Themed one' });
  const back = await call('POST', `/profiles/${made.id}/restore`);
  expect(back.restored.theme).toBe('forest');
  expect((await call('PATCH', `/profiles/${made.id}`, { theme: '' })).theme).toBeNull();
});
