// Profiles (Personal, Work ...; called modes on the server): the dropdown in the header to switch,
// make and manage them, the Profiles section of Settings, and the open profile's colour theme.
// Each profile has its own data, settings and feature switches (DECISIONS D35).

import { profiles } from '../../core/profiles';
import { registerHeaderItem, registerPanel } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { namesLine } from '../settings/summaries';
import './accent';
import { ProfileList } from './ManageProfiles';
import { ProfileSwitch } from './ProfileSwitch';
import './profiles.css';

registerHeaderItem({ id: 'profiles', order: 30, render: () => <ProfileSwitch /> });

registerPanel('settings', {
  id: 'profiles',
  order: 25,
  scope: 'all',
  icon: '👤',
  summary: () => {
    const list = useSignal(profiles);
    return list ? namesLine(list.profiles.map((p) => p.label)) : null;
  },
  render: () => (
    <section class="card">
      <h2>Profiles</h2>
      <p class="muted small">Each profile has its own projects, notes and habits, and its own settings and features. Its colour tints the app while it is open.</p>
      <ProfileList />
    </section>
  ),
});
