import { describe, expect, it } from 'vitest';
import { plainDecimal } from './decimal';
import {
  formatFineness,
  formatGrams,
  formatOzt,
  MAX_WEIGHT_NG,
  NG_PER_OZT,
  parseFineness,
  parseWeight,
} from './units';

const ng = (text: string, unit: 'g' | 'ozt'): bigint => {
  const r = parseWeight(text, unit);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('weight', () => {
  it('knows one troy ounce is exactly 31.1034768 grams', () => {
    expect(NG_PER_OZT).toBe(31_103_476_800n);
    expect(ng('1', 'ozt')).toBe(31_103_476_800n);
    expect(ng('31.1034768', 'g')).toBe(31_103_476_800n);
  });

  it.each([
    ['0.5', '15.5517384'],
    ['0.25', '7.7758692'],
    ['0.1', '3.11034768'],
    ['0.05', '1.55517384'],
    ['5', '155.517384'],
    ['10', '311.034768'],
  ])('%s ozt is %s g, worked by hand', (oz, grams) => {
    expect(formatGrams(ng(oz, 'ozt'))).toBe(grams);
  });

  it('does not treat a published 31.11 g as one ounce', () => {
    expect(ng('31.11', 'g')).toBeGreaterThan(NG_PER_OZT);
    expect(formatOzt(ng('31.11', 'g'))).toBe('1.00021');
  });

  it('shows ounces to six places and grams exactly', () => {
    expect(formatOzt(ng('10', 'g'))).toBe('0.321507');
    expect(formatGrams(ng('0.000001', 'g'))).toBe('0.000001');
  });

  it('refuses zero, an oversized piece and rounding-to-zero weights', () => {
    expect(parseWeight('0', 'g').ok).toBe(false);
    expect(parseWeight('0.000000', 'g').ok).toBe(false);
    expect(parseWeight('1000000', 'ozt').ok).toBe(false);
    expect(parseWeight('100001', 'g').ok).toBe(false);
    expect(ng('100000', 'g')).toBe(MAX_WEIGHT_NG);
    expect(parseWeight('1e12', 'ozt').ok).toBe(false);
  });
});

describe('fineness', () => {
  const ppm = (t: string): number => {
    const r = parseFineness(t);
    if (!r.ok) throw new Error(r.error);
    return r.value.ppm;
  };

  it('reads the same purity typed three ways', () => {
    expect(parseFineness('0.9999')).toEqual({ ok: true, value: { ppm: 999900, reading: 'fraction' } });
    expect(parseFineness('99.99')).toEqual({ ok: true, value: { ppm: 999900, reading: 'percent' } });
    expect(parseFineness('999.9')).toEqual({ ok: true, value: { ppm: 999900, reading: 'per mille' } });
  });

  it('handles the edges of each reading', () => {
    expect(ppm('1')).toBe(1_000_000);
    expect(ppm('100')).toBe(1_000_000);
    expect(ppm('1000')).toBe(1_000_000);
    expect(ppm('0.99999')).toBe(999990);
    expect(ppm('0.9995')).toBe(999500);
    expect(ppm('0.925')).toBe(925000);
  });

  it('refuses nonsense instead of guessing', () => {
    for (const t of ['0', '', '-1', '1000.1', '1.0001', '0.05', '5', '1e3', 'abc']) {
      expect(parseFineness(t).ok, t).toBe(false);
    }
  });

  it('writes fineness as a fraction and a percentage', () => {
    expect(formatFineness(999900)).toBe('0.9999 (99.99%)');
    expect(formatFineness(1_000_000)).toBe('1 (100%)');
  });

  it('works out the pure metal in a coin, by hand', () => {
    const fine = (weight: bigint, p: number): string => plainDecimal(weight * BigInt(p), 15);
    expect(fine(NG_PER_OZT, 999900)).toBe('31.10036645232');
    expect(fine(NG_PER_OZT, 999990)).toBe('31.103165765232');
    expect(fine(NG_PER_OZT, 999500)).toBe('31.0879250616');
    expect(fine(ng('10', 'g'), 999900)).toBe('9.999');
  });
});
