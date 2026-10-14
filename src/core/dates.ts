/** Calendar dates as plain text, "2026-10-14". No clocks inside the maths: today is always passed in. */

import { type Result, fail } from './decimal';

export function isIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 1000;
}

/** The date on the user's own clock, not UTC. */
export function todayLocal(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function parseDate(text: string, today: string, opts: { allowFuture: boolean }): Result<string> {
  const t = text.trim();
  if (!isIsoDate(t)) return fail('Use a real date such as 2026-10-14.');
  if (!opts.allowFuture && t > today) return fail('That date is in the future.');
  return { ok: true, value: t };
}

/** Whole days from `from` to `to`. Both must be valid dates. */
export function daysBetween(from: string, to: string): number {
  const ms = (s: string): number => Date.parse(`${s}T00:00:00Z`);
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export function ageWords(days: number): string {
  if (days < 0) return 'dated in the future';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
