import { describe, expect, it } from 'vitest';
import { formatBasisPoints, formatCents } from './money';
import { allocation, MELT_DENOMINATOR, meltCents, meltNumerator, premiumBasisPoints, summarize } from './melt';
import type { Holding, Spot } from './types';
import { NG_PER_OZT } from './units';

const gold = (over: Partial<Holding> = {}): Holding => ({
  id: 'a',
  name: 'Test gold',
  metal: 'gold',
  finenessPpm: 999900,
  weightNg: NG_PER_OZT.toString(),
  enteredUnit: 'ozt',
  quantity: 1,
  paidPerUnitCents: 650000,
  ...over,
});
const spot = (centsPerOzt: number, metal: Spot['metal'] = 'gold'): Spot => ({ metal, centsPerOzt, enteredOn: '2026-10-14' });

describe('melt value, worked by hand at a SAMPLE spot of 6000.00 CAD per ounce', () => {
  it('1 oz at 0.9999 melts for 5999.40', () => {
    expect(meltCents(gold(), 600000)).toBe(599940n);
  });

  it('2.5 oz melts for 14998.50', () => {
    const h = gold({ weightNg: (NG_PER_OZT / 2n).toString(), quantity: 5 });
    expect(meltCents(h, 600000)).toBe(1499850n);
  });

  it('paying 6500.00 is a premium of 8.34% and a loss of 500.60', () => {
    const { lines, totals } = summarize([gold()], [spot(600000)]);
    expect(formatCents(lines[0]!.melt!)).toBe('$5,999.40');
    expect(formatBasisPoints(lines[0]!.premiumBp!)).toBe('8.34%');
    expect(formatCents(lines[0]!.gap!)).toBe('$500.60');
    expect(formatCents(lines[0]!.gain!)).toBe('−$500.60');
    expect(totals.premiumBp).toBe(834n);
  });

  it('pure metal melts for exactly ounces times spot', () => {
    expect(meltCents(gold({ finenessPpm: 1_000_000, quantity: 3 }), 123456)).toBe(370368n);
  });

  it('rounds a half cent up, once', () => {
    // 1/2 ng-equivalent: weight and spot chosen so the exact melt is 0.5 cents.
    const h = gold({ weightNg: '1', finenessPpm: 1_000_000, quantity: 1 });
    expect(meltCents(h, 1)).toBe(0n); // 1 ng at 1 cent per ounce is far below half a cent
    const half = gold({ weightNg: (NG_PER_OZT / 2n).toString(), finenessPpm: 1_000_000 });
    expect(meltCents(half, 1)).toBe(1n); // exactly 0.5 cents rounds up
    expect(meltCents(half, 3)).toBe(2n); // 1.5 rounds up
  });
});

describe('melt value scales linearly with quantity', () => {
  it('holds for 2000 random coins, exactly, before rounding', () => {
    let seed = 12345;
    const rand = (max: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };
    for (let i = 0; i < 2000; i += 1) {
      const h = gold({
        weightNg: String(1 + rand(1_000_000_000) * 31),
        finenessPpm: 100_000 + rand(900_001),
        quantity: 1 + rand(1000),
      });
      const cents = 1 + rand(5_000_000);
      const n = BigInt(1 + rand(50));
      const one = meltNumerator({ ...h, quantity: 1 }, cents);
      expect(meltNumerator({ ...h, quantity: h.quantity }, cents)).toBe(one * BigInt(h.quantity));
      expect(meltNumerator({ ...h, quantity: h.quantity * 1 }, cents) * n).toBe(meltNumerator({ ...h, quantity: h.quantity }, cents) * n);
      // After rounding, quantity n differs from n times quantity 1 by at most n/2 cents.
      const rounded = meltCents({ ...h, quantity: Number(n) }, cents);
      const sum = meltCents({ ...h, quantity: 1 }, cents) * n;
      const diff = rounded > sum ? rounded - sum : sum - rounded;
      expect(diff <= n / 2n + 1n).toBe(true);
    }
    expect(MELT_DENOMINATOR).toBe(NG_PER_OZT * 1_000_000n);
  });
});

describe('premium', () => {
  it('is paid over melt, to two places, halves away from zero', () => {
    expect(premiumBasisPoints(650000n, 599940n)).toBe(834n);
    expect(premiumBasisPoints(500000n, 600000n)).toBe(-1667n);
    expect(premiumBasisPoints(600000n, 600000n)).toBe(0n);
  });

  it('is n/a, never 0 or NaN, when there is no melt value', () => {
    expect(premiumBasisPoints(100n, 0n)).toBeNull();
    expect(premiumBasisPoints(0n, 0n)).toBeNull();
  });

  it('handles a gift (paid nothing) as a premium of -100%', () => {
    expect(premiumBasisPoints(0n, 599940n)).toBe(-10000n);
    expect(formatBasisPoints(-10000n)).toBe('−100.00%');
  });

  it('never prints a negative zero', () => {
    expect(formatBasisPoints(0n, { sign: true })).toBe('0.00%');
    expect(formatCents(0n)).toBe('$0.00');
  });
});

describe('totals', () => {
  const holdings = [
    gold({ id: 'a', quantity: 2 }),
    gold({ id: 'b', metal: 'silver', paidPerUnitCents: 10000, weightNg: NG_PER_OZT.toString(), quantity: 10 }),
    gold({ id: 'c', metal: 'palladium', paidPerUnitCents: 500000 }),
  ];

  it('add up the rounded lines and leave out metals with no spot price', () => {
    const { lines, totals } = summarize(holdings, [spot(600000), spot(8500, 'silver')]);
    expect(lines.map((l) => l.melt)).toEqual([1199880n, 84992n, null]);
    expect(totals.melt).toBe(1199880n + 84992n);
    expect(totals.paid).toBe(1_300_000n + 100_000n);
    expect(totals.paidAll).toBe(totals.paid + 500_000n);
    expect(totals.included).toBe(2);
    expect(totals.excluded).toBe(1);
  });

  it('with no spot prices at all, melt is empty and nothing is a number', () => {
    const { lines, totals } = summarize(holdings, []);
    expect(lines.every((l) => l.melt === null && l.premiumBp === null && l.gain === null)).toBe(true);
    expect(totals.included).toBe(0);
    expect(totals.premiumBp).toBeNull();
  });

  it('does not overflow past the safe-integer limit', () => {
    const big = gold({ paidPerUnitCents: 1_000_000_000_000, quantity: 1_000_000 });
    const { totals } = summarize([big, { ...big, id: 'b' }], [spot(600000)]);
    expect(totals.paid).toBe(2_000_000_000_000_000_000n);
    expect(formatCents(totals.paid)).toBe('$20,000,000,000,000,000.00');
  });

  it('splits melt value by metal as shares that name every metal that has value', () => {
    const { totals } = summarize(holdings, [spot(600000), spot(8500, 'silver')]);
    const parts = allocation(totals.meltByMetal)!;
    expect(parts.map((p) => p.metal)).toEqual(['gold', 'silver']);
    expect(parts.reduce((a, p) => a + p.bp, 0n)).toBeGreaterThanOrEqual(9999n);
    expect(allocation(summarize([], []).totals.meltByMetal)).toBeNull();
  });
});

describe('allocation shares', () => {
  it('always add up to exactly 100.00%', () => {
    const three = allocation({ gold: 100n, silver: 100n, platinum: 100n, palladium: 0n })!;
    expect(three.map((p) => p.bp)).toEqual([3334n, 3333n, 3333n]);
    let seed = 7;
    const rand = (max: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };
    for (let i = 0; i < 5000; i += 1) {
      const parts = allocation({ gold: BigInt(rand(10_000_000)), silver: BigInt(rand(10_000_000)), platinum: BigInt(rand(1000)), palladium: BigInt(rand(3)) });
      if (parts) expect(parts.reduce((a, p) => a + p.bp, 0n)).toBe(10_000n);
    }
  });
});

describe('money text', () => {
  it('groups thousands and pads cents', () => {
    expect(formatCents(5n)).toBe('$0.05');
    expect(formatCents(123456789n)).toBe('$1,234,567.89');
    expect(formatCents(-100n)).toBe('−$1.00');
  });
});
