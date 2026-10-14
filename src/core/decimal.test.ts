import { describe, expect, it } from 'vitest';
import { parseDecimal, plainDecimal, toScale } from './decimal';

const parse = (t: string, maxDecimals = 6) => parseDecimal(t, { maxDecimals, maxIntDigits: 9 });

describe('reading a typed number', () => {
  it('reads whole numbers and decimals exactly', () => {
    expect(parse('31.1035')).toEqual({ ok: true, value: { mantissa: 311035n, scale: 4 } });
    expect(parse('  12 ')).toEqual({ ok: true, value: { mantissa: 12n, scale: 0 } });
    expect(parse('.5')).toEqual({ ok: true, value: { mantissa: 5n, scale: 1 } });
    expect(parse('5.')).toEqual({ ok: true, value: { mantissa: 5n, scale: 0 } });
  });

  it('accepts a decimal comma when it cannot be mistaken for a thousands separator', () => {
    expect(parse('31,1035')).toEqual({ ok: true, value: { mantissa: 311035n, scale: 4 } });
    expect(parse('0,25')).toEqual({ ok: true, value: { mantissa: 25n, scale: 2 } });
  });

  it('refuses "1,000" because it could mean one or one thousand', () => {
    const r = parse('1,000');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ambiguous/);
  });

  it('refuses thousands separators when a decimal point is also present', () => {
    expect(parse('1,000.50').ok).toBe(false);
  });

  it.each([
    ['', 'Enter a number.'],
    ['   ', 'Enter a number.'],
    ['-1', 'This cannot be negative.'],
    ['−1', 'This cannot be negative.'],
    ['-0', 'This cannot be negative.'],
    ['1e999', 'Plain numbers only, no exponents.'],
    ['1/4', 'Type a decimal such as 0.25, not a fraction.'],
    ['NaN', 'Numbers only: digits and one decimal point.'],
    ['Infinity', 'Numbers only: digits and one decimal point.'],
    ['١٢', 'Use the digits 0 to 9 only.'],
    ['1.2.3', 'Use a single decimal point.'],
    ['.', 'Enter a number.'],
    ['<script>', 'Numbers only: digits and one decimal point.'],
  ])('rejects %j with a plain message', (text, message) => {
    expect(parse(text)).toEqual({ ok: false, error: message });
  });

  it('limits decimal places and size', () => {
    expect(parse('0.0000001').ok).toBe(false);
    expect(parse('1', 0).ok).toBe(true);
    expect(parse('1.5', 0)).toEqual({ ok: false, error: 'Whole numbers only.' });
    expect(parse('1234567890').ok).toBe(false);
  });
});

describe('exact decimals', () => {
  it('scales up exactly and down with halves rounding up', () => {
    expect(toScale({ mantissa: 125n, scale: 2 }, 4)).toBe(12500n);
    expect(toScale({ mantissa: 125n, scale: 2 }, 1)).toBe(13n); // 1.25 -> 1.3
    expect(toScale({ mantissa: 124n, scale: 2 }, 1)).toBe(12n);
  });

  it('writes a number back with its point and no trailing zeros', () => {
    expect(plainDecimal(31103476800n, 9)).toBe('31.1034768');
    expect(plainDecimal(5n, 3)).toBe('0.005');
    expect(plainDecimal(1000000n, 6)).toBe('1');
    expect(plainDecimal(-50n, 2)).toBe('−0.5');
  });
});
