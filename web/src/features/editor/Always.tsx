// A note that is always the editor (D61): no read-only view and no "Edit" step. The note on Today, a
// project's notes and the note's own page use it (`always` on MarkdownEditor). The editor chunk loads
// when the note scrolls near the screen (so a Today page with many notes mounts few editors); until
// then the note's text shows in the same box, and a tap on it mounts the editor at once.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { mode, version } from '../../core/api';
import * as offline from '../../core/offline';
import { useFlag } from '../../core/features';
import type { MarkdownEditorProps } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { Markdown } from '../../core/ui';
import { getDraft, paper } from './device';
import type { EditingProps } from './Editing';
import { noteTarget, plainTarget, type Target } from './targets';
import './editor-always.css';

type EditingComp = (p: EditingProps) => any;
let loaded: EditingComp | null = null;
let loading: Promise<EditingComp> | null = null;
const loadChunk = () => (loading ??= import('./Editing').then((m) => (loaded = m.default as EditingComp)));

const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 699px)').matches;

export function AlwaysEditor(props: MarkdownEditorProps) {
  const { value, placeholder, rows = 8, note } = props;
  const paperOn = useFlag('paper-themes');
  const paperId = useSignal(paper);
  const live = useRef(props);
  live.current = props;
  const target: Target = useMemo(
    () =>
      (props.target as Target | undefined) ??
      (note ? noteTarget(note.kind, note.id) : plainTarget(() => live.current.value, (v) => live.current.onSave(v), props.draftKey)),
    [props.target, note?.kind, note?.id, props.draftKey],
  );
  const key = props.draftKey ?? target.key;
  const net = useSignal(offline.status);
  const m = useSignal(mode);
  void net.waiting;
  const waiting = note ? offline.queuedBody(m, `/notes/of/${note.kind}/${note.id}`)?.body : undefined;
  const latest = typeof waiting === 'string' ? waiting : value;

  const [Comp, setComp] = useState<EditingComp | null>(() => loaded);
  const [near, setNear] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // What the editor starts from: a draft kept on this device (it saves again, with the usual check), else the note.
  const start = useRef<EditingProps['start'] | null>(null);
  if (!start.current) {
    const d = getDraft(key);
    start.current = d && d.text !== latest ? { text: d.text, baseText: d.baseText, base: d.base, clash: d.clash || d.baseText === '\u0000' } : { text: latest, baseText: latest, base: undefined };
  }

  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    if (typeof IntersectionObserver !== 'function') return setNear(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    if (near && !Comp) loadChunk().then((c) => setComp(() => c), () => {});
  }, [near, Comp]);

  const paperCls = `paper-${paperOn ? paperId : 'plain'}`;
  if (near && Comp)
    return (
      <div class="ed-wrap ed-wrap-always">
        <Comp
          start={start.current}
          target={{ ...target, key }}
          placeholder={placeholder}
          rows={rows}
          phone={isPhone()}
          paperOn={paperOn}
          always
          incoming={latest}
          onDone={() => {
            if (note) version.value++; // views showing this note reload
          }}
        />
      </div>
    );
  return (
    <div class="ed-wrap" ref={box}>
      <div class={`ed ed-view ed-always-wait ${paperCls}`} style={{ minHeight: `${rows * 1.75 + 1}rem` }} onPointerDown={() => setNear(true)} onClick={() => setNear(true)}>
        {latest ? <Markdown class="ed-doc" text={latest} /> : <p class="ed-doc ed-placeholder">{placeholder ?? 'Write…'}</p>}
      </div>
    </div>
  );
}
