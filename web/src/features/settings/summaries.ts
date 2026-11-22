// Pure helpers for the one-line summaries on a phone's list of Settings sections (D60).

/** "Personal", "Personal, Work", "Personal, Work + 1". */
export function namesLine(names: string[], show = 2): string {
  if (!names.length) return '';
  const head = names.slice(0, show).join(', ');
  return names.length > show ? `${head} + ${names.length - show}` : head;
}

/** "3 of 12 on". */
export const countLine = (on: number, all: number) => `${on} of ${all} on`;

/** "No categories", "1 category", "4 tokens". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 0 ? `No ${many}` : `${n} ${n === 1 ? one : many}`;
}
