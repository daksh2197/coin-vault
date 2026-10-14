/** Sentences the screen shows that depend on numbers. Pure, so they can be tested. */

import { ageWords, daysBetween } from '../core/dates';
import { spotDatesUsed, type Line } from '../core/melt';
import { METAL_LABEL, type Metal, type Spot } from '../core/types';

/** A spot price older than this is flagged. A week is a long time in a metals market. */
export const STALE_DAYS = 7;
/** Safari can clear a site's storage after seven days without use, so a backup older than this gets a reminder. */
export const BACKUP_NAG_DAYS = 7;

export function asOf(spot: Spot | null, today: string): string {
  if (!spot) return '';
  const label = spot.sample ? 'SAMPLE spot' : 'spot';
  return `${label} ${spot.enteredOn} (${ageWords(daysBetween(spot.enteredOn, today))})`;
}

/** The "as of" line under a total: one date, a range, and a flag when the oldest is stale. */
export function asOfTotals(lines: readonly Line[], today: string): string {
  const dates = spotDatesUsed(lines);
  if (dates.length === 0) return '';
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const sample = lines.some((l) => l.spot?.sample) ? 'SAMPLE ' : '';
  const text = first === last ? `${sample}spot typed ${first}` : `${sample}spots typed ${first} to ${last}`;
  const age = daysBetween(first, today);
  return age > STALE_DAYS ? `${text}. Oldest is ${age} days old.` : text;
}

export function missingSpotText(metals: readonly Metal[]): string {
  const names = metals.map((m) => METAL_LABEL[m].toLowerCase());
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
  return `Enter a spot price for ${list}.`;
}

export function excludedText(excluded: number, metals: readonly Metal[]): string {
  if (excluded === 0) return '';
  const what = excluded === 1 ? '1 holding is' : `${excluded} holdings are`;
  return `${what} left out of melt, premium and gain. ${missingSpotText(metals)}`;
}

export function backupStatus(lastBackup: string | null, today: string, hasHoldings: boolean): string {
  if (!lastBackup) {
    return hasHoldings
      ? 'You have not saved a backup from this browser yet. Nothing here is copied anywhere else.'
      : 'No backup yet. Nothing is stored anywhere but this browser.';
  }
  const day = lastBackup.slice(0, 10);
  const age = daysBetween(day, today);
  const base = `Last backup: ${day} (${ageWords(age)}).`;
  return age > BACKUP_NAG_DAYS && hasHoldings ? `${base} Safari can clear a site left alone for seven days, so save a new one.` : base;
}
