// The Habits page in a pop-out dialog over the Today list (opened from its "Habits" heading).
// It is the Habits tab's own page component; Esc, ✕ and the phone's Back close it (Dialog), and
// what was changed inside is reloaded on Today when it closes.
import { version } from '../../core/api';
import { afterDialog, Dialog, go } from '../../core/ui';
import { Habits } from './Habits';

export function HabitsPopup({ onClose }: { onClose: () => void }) {
  const close = () => {
    onClose();
    version.value++;
  };
  const openTab = () => {
    close();
    afterDialog(() => go('/habits'));
  };
  return (
    <Dialog title="Habits" wide cls="habits-popup" onClose={close}>
      <button class="link small habits-popup-tab" onClick={openTab}>
        Open Habits tab
      </button>
      <Habits inDialog />
    </Dialog>
  );
}
