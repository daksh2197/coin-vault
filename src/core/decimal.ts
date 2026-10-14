/**
 * Typed numbers, read strictly.
 *
 * A text box hands us a string. Before any money maths, the string becomes an exact decimal:
 * an integer (the mantissa) and a count of places (the scale), so 31.25 is 3125 with scale 2.
 * No floating point touches a figure that ends up on screen.
 *
 * The rules are strict on purpose. A weight typed as "1,000" could mean one thousand or one,
 * so it is refused with a message instead of guessed.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Decimal {
  /** The digits without the point. Never negative. */
  mantissa: bigint;
  /** How many of those digits sit after the point. */
  scale: number;
}

export interface DecimalLimits {
  maxDecimals: number;
  /** Most digits before the point. */
  maxIntDigits: number;
}

export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Divide and round to the nearest whole number, halves going up. Both numbers must be positive. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function parseDecimal(raw: string, limits: DecimalLimits): Result<Decimal> {
  const text = raw.trim();
  if (text === '') return fail('Enter a number.');
  if (/^[-−‒-―]/.test(text)) return fail('This cannot be negative.');
  if (text.includes('/')) return fail('Type a decimal such as 0.25, not a fraction.');
  if (/[eE]/.test(text)) return fail('Plain numbers only, no exponents.');
  if (/[^0-9.,]/.test(text)) {
    return fail(/[^\x00-\x7f]/.test(text) ? 'Use the digits 0 to 9 only.' : 'Numbers only: digits and one decimal point.');
  }
  if (text.includes('.') && text.includes(',')) return fail('Remove thousands separators. Type 1000.50, not 1,000.50.');

  const separators = text.match(/[.,]/g) ?? [];
  if (separators.length > 1) return fail('Use a single decimal point.');

  let whole = text;
  let fraction = '';
  const at = text.search(/[.,]/);
  if (at >= 0) {
    whole = text.slice(0, at);
    fraction = text.slice(at + 1);
    // "1,000" is either one thousand or one. Do not guess.
    if (text[at] === ',' && whole !== '' && fraction.length === 3) {
      return fail('A comma is ambiguous here. Type 1000 for a thousand or 1.000 for one.');
    }
  }
  if (whole === '' && fraction === '') return fail('Enter a number.');
  if (whole.length > limits.maxIntDigits) return fail('That number is too large.');
  if (fraction.length > limits.maxDecimals) {
    return fail(limits.maxDecimals === 0 ? 'Whole numbers only.' : `At most ${limits.maxDecimals} decimal places.`);
  }
  return { ok: true, value: { mantissa: BigInt((whole || '0') + fraction), scale: fraction.length } };
}

/** The decimal as a whole number of units of 10^-scale, rounding halves up if it has more places. */
export function toScale(d: Decimal, scale: number): bigint {
  if (d.scale <= scale) return d.mantissa * pow10(scale - d.scale);
  return divRoundHalfUp(d.mantissa, pow10(d.scale - scale));
}

/** A whole number rendered with a point `scale` places from the right, trailing zeros trimmed. */
export function plainDecimal(units: bigint, scale: number): string {
  const sign = units < 0n ? '−' : '';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  return sign + (fraction ? `${whole}.${fraction}` : whole);
}
