/**
 * Money in integer cents.
 *
 * Typed amounts become whole cents (Canadian dollars) the moment they are read.
 * Results are bigints, so a total can never overflow or pick up a float crumb.
 * Text is built by hand, not with Intl, because Intl wants a float.
 */

import { type Result, fail, parseDecimal, toScale } from './decimal';

export const MAX_CENTS = 1_000_000_000_000; // $10 billion for one piece: a typo, not a coin

export function parseCents(text: string, opts: { allowZero: boolean }): Result<number> {
  const parsed = parseDecimal(text, { maxDecimals: 2, maxIntDigits: 10 });
  if (!parsed.ok) return parsed;
  const cents = toScale(parsed.value, 2);
  if (cents === 0n && !opts.allowZero) return fail('This must be above zero.');
  if (cents > BigInt(MAX_CENTS)) return fail('That amount is too large.');
  return { ok: true, value: Number(cents) };
}

export const MAX_QUANTITY = 1_000_000;

export function parseQuantity(text: string): Result<number> {
  const parsed = parseDecimal(text, { maxDecimals: 0, maxIntDigits: 7 });
  if (!parsed.ok) return parsed.error === 'Whole numbers only.' ? fail('Quantity must be a whole number.') : parsed;
  const n = parsed.value.mantissa;
  if (n < 1n) return fail('Quantity must be at least 1.');
  if (n > BigInt(MAX_QUANTITY)) return fail('Quantity cannot be above 1,000,000.');
  return { ok: true, value: Number(n) };
}

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 59994 -> "$599.94". Negative amounts use a real minus sign: "−$500.60". */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = (negative ? -cents : cents).toString().padStart(3, '0');
  const body = `$${group(abs.slice(0, -2))}.${abs.slice(-2)}`;
  return negative ? `−${body}` : body;
}

/** Basis points of a percentage: 834 is 8.34%. */
export function formatBasisPoints(bp: bigint, opts: { sign: boolean } = { sign: false }): string {
  const negative = bp < 0n;
  const abs = (negative ? -bp : bp).toString().padStart(3, '0');
  const body = `${group(abs.slice(0, -2))}.${abs.slice(-2)}%`;
  if (negative) return `−${body}`;
  return opts.sign && bp > 0n ? `+${body}` : body;
}
