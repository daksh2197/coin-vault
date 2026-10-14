/**
 * Weight and fineness.
 *
 * Every weight is stored as whole nanograms, in a bigint, so nothing drifts.
 * One troy ounce is exactly 31.1034768 grams (LBMA), which is exactly 31,103,476,800 ng.
 * A weight typed in ounces is converted once, on the way in, and never round-tripped through grams.
 */

import type { Unit } from './types';
import { type Decimal, type Result, divRoundHalfUp, fail, parseDecimal, plainDecimal, pow10, toScale } from './decimal';

export type { Unit };
export const NG_PER_G = 1_000_000_000n;
export const NG_PER_OZT = 31_103_476_800n;
/** One piece may not weigh more than 100 kg. Real bars stop far below that; this stops typos. */
export const MAX_WEIGHT_NG = 100_000_000_000_000n;
/** Fineness is stored in parts per million: 0.9999 is 999,900. */
export const PPM = 1_000_000;
export const MIN_FINENESS_PPM = 100_000;

export function weightToNg(d: Decimal, unit: Unit): bigint {
  const perUnit = unit === 'g' ? NG_PER_G : NG_PER_OZT;
  return divRoundHalfUp(d.mantissa * perUnit, pow10(d.scale));
}

export function parseWeight(text: string, unit: Unit): Result<bigint> {
  const parsed = parseDecimal(text, { maxDecimals: unit === 'g' ? 9 : 6, maxIntDigits: 9 });
  if (!parsed.ok) return parsed;
  const ng = weightToNg(parsed.value, unit);
  if (ng <= 0n) return fail('Weight must be above zero.');
  if (ng > MAX_WEIGHT_NG) return fail('That is heavier than 100 kg for one piece. Check the unit.');
  return { ok: true, value: ng };
}

/** Exact, up to nine places: 31103476800 ng is "31.1034768". */
export function formatGrams(ng: bigint): string {
  return plainDecimal(ng, 9);
}

/** Troy ounces to six places, rounded: 31103476800 ng is "1". */
export function formatOzt(ng: bigint): string {
  return plainDecimal(divRoundHalfUp(ng * 1_000_000n, NG_PER_OZT), 6);
}

export const formatWeight = (ng: bigint, unit: Unit): string => (unit === 'g' ? `${formatGrams(ng)} g` : `${formatOzt(ng)} ozt`);

export type FinenessReading = 'fraction' | 'percent' | 'per mille';

export interface Fineness {
  ppm: number;
  reading: FinenessReading;
}

/**
 * Fineness can be typed three ways, and the size of the number says which:
 *   0.9999   up to 1      a fraction
 *   99.99    over 1 to 100   a percentage
 *   999.9    over 100 to 1000  parts per thousand (the number stamped on many bars)
 * The form shows the reading as you type, so a wrong guess is visible before it is saved.
 */
export function parseFineness(text: string): Result<Fineness> {
  const parsed = parseDecimal(text, { maxDecimals: 8, maxIntDigits: 4 });
  if (!parsed.ok) return parsed;
  const d = parsed.value;
  const compare = (n: bigint): number => {
    const left = d.mantissa;
    const right = n * pow10(d.scale);
    return left < right ? -1 : left > right ? 1 : 0;
  };
  if (compare(0n) === 0) return fail('Fineness must be above zero.');
  let reading: FinenessReading;
  let ppm: bigint;
  if (compare(1n) <= 0) {
    reading = 'fraction';
    ppm = toScale(d, 6);
  } else if (compare(100n) <= 0) {
    reading = 'percent';
    ppm = toScale(d, 4);
  } else if (compare(1000n) <= 0) {
    reading = 'per mille';
    ppm = toScale(d, 3);
  } else {
    return fail('Fineness cannot be above 1000 parts per thousand.');
  }
  if (ppm < BigInt(MIN_FINENESS_PPM)) {
    return fail('That reads as under 10% pure, which is too low for a precious-metal coin. Type 0.9999, 99.99 or 999.9.');
  }
  if (ppm > BigInt(PPM)) return fail('Fineness cannot be above 100%.');
  return { ok: true, value: { ppm: Number(ppm), reading } };
}

/** 999900 is "0.9999 (99.99%)". */
export function formatFineness(ppm: number): string {
  const fraction = plainDecimal(BigInt(ppm), 6);
  const percent = plainDecimal(BigInt(ppm), 4);
  return `${fraction} (${percent}%)`;
}
