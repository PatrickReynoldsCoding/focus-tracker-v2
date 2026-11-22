// Opening the app at a file in a given profile (D44): the Android widgets open
// `/?profile=<id>#/n/<id>`, a full page load, so the profile is set before anything draws and the
// page never shows the other profile's data. The query is then taken off the address.
import { localStorageSet, mode, post } from '../../core/api';

function openProfileFromAddress(): void {
  const params = new URLSearchParams(location.search);
  const id = params.get('profile')?.trim();
  if (!id) return;
  params.delete('profile');
  const rest = params.toString();
  history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  if (mode.value === id) return;
  mode.value = id;
  localStorageSet('ft.mode', id);
  // As switching profile does: the Mac menu bar and the widgets that follow the open profile follow it.
  void post('/profiles/opened', { id }).catch(() => {});
}

openProfileFromAddress();
