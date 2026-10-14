/**
 * The three numbers: what you paid, what the metal is worth, and the gap.
 *
 *   fine ounces = weight of one piece x quantity x fineness
 *   melt        = fine ounces x spot price (Canadian cents per troy ounce)
 *
 * Each holding's melt is worked out exactly (a fraction of integers), then rounded ONCE to a
 * whole cent, halves up. A total is the sum of the rounded lines, so the page always adds up.
 */

import { divRoundHalfUp } from './decimal';
import { NG_PER_OZT, PPM } from './units';
import { type Holding, type Metal, METALS, type Spot } from './types';

const DENOMINATOR = NG_PER_OZT * BigInt(PPM);

type Priced = Pick<Holding, 'weightNg' | 'finenessPpm' | 'quantity'>;

/** Melt value in cents, rounded once. */
export function meltCents(h: Priced, centsPerOzt: number): bigint {
  return divRoundHalfUp(meltNumerator(h, centsPerOzt), DENOMINATOR);
}

/** Melt value before rounding, as numerator / DENOMINATOR. Used to test linearity exactly. */
export function meltNumerator(h: Priced, centsPerOzt: number): bigint {
  return BigInt(h.weightNg) * BigInt(h.quantity) * BigInt(h.finenessPpm) * BigInt(centsPerOzt);
}
export const MELT_DENOMINATOR = DENOMINATOR;

/** (paid - melt) / melt as basis points, rounded half away from zero. Null when melt is zero. */
export function premiumBasisPoints(paid: bigint, melt: bigint): bigint | null {
  if (melt <= 0n) return null;
  const gap = paid - melt;
  const scaled = (gap < 0n ? -gap : gap) * 10_000n;
  const rounded = divRoundHalfUp(scaled, melt);
  return gap < 0n ? -rounded : rounded;
}

export interface Line {
  holding: Holding;
  paid: bigint;
  /** Null when no spot price has been typed for the metal. */
  melt: bigint | null;
  spot: Spot | null;
  /** paid - melt: the premium in dollars. Negative when you paid less than melt. */
  gap: bigint | null;
  premiumBp: bigint | null;
  /** melt - paid: positive is a gain at that spot price. */
  gain: bigint | null;
}

export interface Totals {
  /** Paid, melt and the rest cover only holdings that have a spot price. */
  paid: bigint;
  melt: bigint;
  gap: bigint;
  premiumBp: bigint | null;
  gain: bigint;
  included: number;
  excluded: number;
  /** Paid across every holding, with or without a spot price. */
  paidAll: bigint;
  meltByMetal: Record<Metal, bigint>;
}

export interface Summary {
  lines: Line[];
  totals: Totals;
}

export function summarize(holdings: readonly Holding[], spots: readonly Spot[]): Summary {
  const spotOf = new Map(spots.map((s) => [s.metal, s]));
  const meltByMetal = Object.fromEntries(METALS.map((m) => [m, 0n])) as Record<Metal, bigint>;
  let paid = 0n;
  let melt = 0n;
  let paidAll = 0n;
  let included = 0;
  const lines = holdings.map((holding): Line => {
    const linePaid = BigInt(holding.paidPerUnitCents) * BigInt(holding.quantity);
    paidAll += linePaid;
    const spot = spotOf.get(holding.metal) ?? null;
    if (!spot) return { holding, paid: linePaid, melt: null, spot: null, gap: null, premiumBp: null, gain: null };
    const lineMelt = meltCents(holding, spot.centsPerOzt);
    paid += linePaid;
    melt += lineMelt;
    meltByMetal[holding.metal] += lineMelt;
    included += 1;
    return {
      holding,
      paid: linePaid,
      melt: lineMelt,
      spot,
      gap: linePaid - lineMelt,
      premiumBp: premiumBasisPoints(linePaid, lineMelt),
      gain: lineMelt - linePaid,
    };
  });
  return {
    lines,
    totals: {
      paid,
      melt,
      gap: paid - melt,
      premiumBp: premiumBasisPoints(paid, melt),
      gain: melt - paid,
      included,
      excluded: holdings.length - included,
      paidAll,
      meltByMetal,
    },
  };
}

/** Oldest and newest spot dates among the spots actually used, for the "as of" line. */
export function spotDatesUsed(lines: readonly Line[]): string[] {
  const dates = new Set<string>();
  for (const l of lines) if (l.spot) dates.add(l.spot.enteredOn);
  return [...dates].sort();
}

/** Percentage of melt value by metal in basis points of the whole, adding to exactly 10,000; null when there is no melt value. */
export function allocation(meltByMetal: Record<Metal, bigint>): { metal: Metal; melt: bigint; bp: bigint }[] | null {
  const total = METALS.reduce((a, m) => a + meltByMetal[m], 0n);
  if (total <= 0n) return null;
  // Largest remainder: each metal gets its whole basis points, then the leftover points go to the
  // biggest fractional parts, so the shares always add up to exactly 100.00%.
  const present = METALS.filter((m) => meltByMetal[m] > 0n);
  const parts = present.map((metal) => {
    const scaled = meltByMetal[metal] * 10_000n;
    return { metal, melt: meltByMetal[metal], bp: scaled / total, rest: scaled % total };
  });
  let leftover = 10_000n - parts.reduce((a, p) => a + p.bp, 0n);
  for (const p of [...parts].sort((a, b) => (b.rest > a.rest ? 1 : b.rest < a.rest ? -1 : 0))) {
    if (leftover <= 0n) break;
    p.bp += 1n;
    leftover -= 1n;
  }
  return parts.map(({ metal, melt, bp }) => ({ metal, melt, bp }));
}
