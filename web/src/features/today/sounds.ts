// The session sounds, made with Web Audio (no files): a little hen's cluck when
// work ends, a small steam whistle when a break ends. Short and quiet on purpose.
// Muted per device in Settings (localStorage 'ft.sound' = 'off').

let ac: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    ac ??= new AudioContext();
    if (ac.state === 'suspended') void ac.resume();
    return ac;
  } catch {
    return null;
  }
}

// Browsers only allow sound after a click or key press. Making the context
// during that first click slowed it down in v1 (about 200 ms in Chrome), so it
// is made half a second later; later clicks resume it if it was suspended.
if (typeof window !== 'undefined') {
  const wake = () => setTimeout(() => context(), 500);
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);
}

export function soundOn(): boolean {
  try {
    return localStorage.getItem('ft.sound') !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem('ft.sound', on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
}

/** One "bok": a short, filtered, falling blip. */
function cluck(a: AudioContext, t: number, pitch: number, length: number, out: AudioNode) {
  const o = a.createOscillator();
  const f = a.createBiquadFilter();
  const g = a.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(pitch, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.6, t + length);
  f.type = 'bandpass';
  f.frequency.value = 1100;
  f.Q.value = 3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(1, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(f).connect(g).connect(out);
  o.start(t);
  o.stop(t + length + 0.02);
}

/** Work ends, time for a break: "bok, bok, ba-gawk". */
function hen(a: AudioContext) {
  const out = a.createGain();
  out.gain.value = 0.18;
  out.connect(a.destination);
  const t = a.currentTime + 0.05;
  cluck(a, t, 620, 0.08, out);
  cluck(a, t + 0.17, 640, 0.08, out);
  cluck(a, t + 0.36, 560, 0.07, out);
  cluck(a, t + 0.45, 900, 0.22, out);
}

/** Break ends, back to work: a short two-tone whistle with a puff of steam. */
function whistle(a: AudioContext) {
  const out = a.createGain();
  out.gain.value = 0.12;
  out.connect(a.destination);
  const t = a.currentTime + 0.05;
  const len = 0.9;
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(1, t + 0.08);
  env.gain.setValueAtTime(1, t + len - 0.25);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  env.connect(out);
  const vib = a.createOscillator();
  const vibDepth = a.createGain();
  vib.frequency.value = 6;
  vibDepth.gain.value = 6;
  vib.connect(vibDepth);
  for (const hz of [740, 932]) {
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz * 0.9, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.12);
    vibDepth.connect(o.frequency);
    o.connect(env);
    o.start(t);
    o.stop(t + len + 0.05);
  }
  vib.start(t);
  vib.stop(t + len + 0.05);
  // Steam: a little filtered noise at the start.
  const n = a.createBuffer(1, Math.floor(a.sampleRate * 0.3), a.sampleRate);
  const d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  const hp = a.createBiquadFilter();
  const ng = a.createGain();
  src.buffer = n;
  hp.type = 'highpass';
  hp.frequency.value = 3000;
  ng.gain.value = 0.25;
  src.connect(hp).connect(ng).connect(out);
  src.start(t);
}

export type SoundName = 'work-ends' | 'break-ends';

/** Play a sound (unless muted, or `force` for the try buttons). */
export function play(name: SoundName, force = false) {
  if (!force && !soundOn()) return;
  const a = context();
  if (!a) return;
  (name === 'work-ends' ? hen : whistle)(a);
}
