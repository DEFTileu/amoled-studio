import type { LogEntry } from '@contracts/v1';

export type Level = 'info' | 'warn' | 'error';
export interface Row { id: number; t: string; level: Level; src: string; msg: string }

const ANSI = /\x1b\[[0-9;]*m/g;
const IDF = /^([EWIDV]) \(\d+\) /; // ESP-IDF log prefix, e.g. "E (123) tag: ..."

export function parseLine(e: LogEntry): { level: Level; msg: string } {
  const msg = e.message.replace(ANSI, '');
  const c = IDF.exec(msg)?.[1];
  return { level: c === 'E' ? 'error' : c === 'W' ? 'warn' : 'info', msg };
}

export const stamp = (d = new Date()) => d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');

/**
 * The backend returns a bounded sliding window with no ids or timestamps, so new lines are found by matching the
 * longest tail of what we already hold against the head of the new window; their time is when we first saw them.
 * shortcut: identical repeating lines while the window rotates can mis-align; upgrade when the backend adds sequence numbers.
 */
export function mergeBackend(known: LogEntry[], next: LogEntry[]): LogEntry[] {
  const same = (a: LogEntry, b: LogEntry) => a.stream === b.stream && a.message === b.message;
  for (let k = Math.min(known.length, next.length); k > 0; k--) {
    let ok = true;
    for (let i = 0; i < k && ok; i++) ok = same(known[known.length - k + i], next[i]);
    if (ok) return next.slice(k);
  }
  return next;
}
