// Sticky note colours: pastels that keep dark text readable. The server has the same names
// (src/modules/stickies.ts STICKY_COLORS); keep the two lists in step.
export const STICKY_SHADES: [name: string, shade: string][] = [
  ['yellow', '#fff3a3'],
  ['sand', '#f1e3c4'],
  ['peach', '#ffe0cc'],
  ['orange', '#ffd2a1'],
  ['red', '#ffb8b0'],
  ['pink', '#ffc9de'],
  ['lavender', '#dcd9ff'],
  ['purple', '#e3c9ff'],
  ['blue', '#c4e3ff'],
  ['sky', '#bfeeff'],
  ['teal', '#b2ece6'],
  ['mint', '#c6f5dc'],
  ['green', '#cdeec0'],
  ['lime', '#e6f5a8'],
  ['grey', '#e4e4e0'],
];
const BY_NAME = Object.fromEntries(STICKY_SHADES);
export const shadeOf = (c: string | null | undefined) => BY_NAME[c ?? ''] ?? BY_NAME.yellow;

/** The server's limits (src/modules/stickies.ts STICKY_LIMITS). */
export const LIMITS = { opacity: [0.4, 1], x: [0, 100], y: [0, 20000], w: [120, 900], h: [80, 900] } as const;
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
