// Insights replaces the Log tab while the `insights` flag is on (the Log is its Logs sub-tab).
// The page itself is a separate chunk, fetched when the tab is first opened.
import { useEffect, useState } from 'preact/hooks';
import { registerPanel, registerRoute, registerTab } from '../../core/registry';

const FLAG = 'insights';

function Lazy({ open }: { open?: 'logs' }) {
  const [Page, setPage] = useState<typeof import('./Insights').Insights>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    import('./Insights').then((m) => setPage(() => m.Insights), () => setFailed(true));
  }, []);
  if (failed) return <p class="empty error">Insights could not load. Check the connection and try again.</p>;
  return Page ? <Page open={open} /> : <p class="empty">Loading…</p>;
}

registerTab({ id: 'insights', path: '/insights', label: 'Insights', icon: '◔', order: 50, feature: FLAG, render: () => <Lazy /> });
// The old address of the Log tab opens the Logs sub-tab.
registerRoute({ id: 'insights-log', prefix: '/log', tab: 'insights', feature: FLAG, render: () => <Lazy open="logs" /> });
// The phone's bottom bar is full, so Settings carries a way in.
registerPanel('settings', {
  id: 'insights-link',
  order: 35,
  feature: FLAG,
  render: () => (
    <section class="card">
      <h2>Insights</h2>
      <p class="muted small">How your weeks went: focus time, habits against target, projects and the log.</p>
      <a class="chip" href="#/insights">
        Open Insights
      </a>
    </section>
  ),
});
