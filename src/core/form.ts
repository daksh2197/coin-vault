/**
 * Turns what the add/edit form holds (all text) into a checked Holding, or a message per field.
 * The screen never builds a Holding itself, so there is exactly one place where typed text becomes money.
 */

import { parseDate } from './dates';
import { type Result, fail } from './decimal';
import { parseCents, parseQuantity } from './money';
import { LIMITS } from './schema';
import { type Holding, METALS, type Metal, type Spot, type Unit } from './types';
import { formatGrams, formatOzt, parseFineness, parseWeight } from './units';

export interface HoldingInput {
  name: string;
  metal: string;
  fineness: string;
  weight: string;
  unit: string;
  quantity: string;
  paid: string;
  paidOn: string;
  mint: string;
  year: string;
  location: string;
  note: string;
}

export type HoldingField = keyof HoldingInput;
export type FieldErrors = Partial<Record<HoldingField, string>>;

export function buildHolding(input: HoldingInput, id: string, today: string): { ok: true; value: Holding } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = input.name.trim();
  if (name === '') errors.name = 'Give it a name.';
  else if (name.length > LIMITS.name) errors.name = `Keep the name under ${LIMITS.name} characters.`;

  const metal = (METALS as readonly string[]).includes(input.metal) ? (input.metal as Metal) : null;
  if (!metal) errors.metal = 'Pick a metal.';

  const fineness = parseFineness(input.fineness);
  if (!fineness.ok) errors.fineness = fineness.error;

  const unit: Unit | null = input.unit === 'g' || input.unit === 'ozt' ? input.unit : null;
  if (!unit) errors.unit = 'Pick grams or troy ounces.';
  const weight = unit ? parseWeight(input.weight, unit) : fail('Pick a unit first.');
  if (!weight.ok && unit) errors.weight = weight.error;

  const quantity = parseQuantity(input.quantity);
  if (!quantity.ok) errors.quantity = quantity.error;

  const paid = parseCents(input.paid, { allowZero: true });
  if (!paid.ok) errors.paid = paid.error;

  let paidOn: string | undefined;
  if (input.paidOn.trim() !== '') {
    const d = parseDate(input.paidOn, today, { allowFuture: false });
    if (d.ok) paidOn = d.value;
    else errors.paidOn = d.error;
  }

  let year: number | undefined;
  if (input.year.trim() !== '') {
    const y = /^\d{1,4}$/.test(input.year.trim()) ? Number(input.year.trim()) : NaN;
    if (!Number.isInteger(y) || y < 1 || y > Number(today.slice(0, 4)) + 1) errors.year = 'Use a four-digit year.';
    else year = y;
  }

  const mint = input.mint.trim();
  if (mint.length > LIMITS.mint) errors.mint = `Keep it under ${LIMITS.mint} characters.`;
  const location = input.location.trim();
  if (location.length > LIMITS.location) errors.location = `Keep it under ${LIMITS.location} characters.`;
  const note = input.note.trim();
  if (note.length > LIMITS.note) errors.note = `Keep it under ${LIMITS.note} characters.`;

  if (Object.keys(errors).length > 0 || !metal || !fineness.ok || !unit || !weight.ok || !quantity.ok || !paid.ok) {
    return { ok: false, errors };
  }
  const value: Holding = {
    id,
    name,
    metal,
    finenessPpm: fineness.value.ppm,
    weightNg: weight.value.toString(),
    enteredUnit: unit,
    quantity: quantity.value,
    paidPerUnitCents: paid.value,
  };
  if (paidOn) value.paidOn = paidOn;
  if (year !== undefined) value.year = year;
  if (mint) value.mint = mint;
  if (location) value.location = location;
  if (note) value.note = note;
  return { ok: true, value };
}

/** The form's text for an existing holding, so editing shows what was typed. */
export function holdingToInput(h: Holding): HoldingInput {
  const ng = BigInt(h.weightNg);
  return {
    name: h.name,
    metal: h.metal,
    fineness: String(h.finenessPpm / 1_000_000),
    weight: h.enteredUnit === 'g' ? formatGrams(ng) : formatOzt(ng),
    unit: h.enteredUnit,
    quantity: String(h.quantity),
    paid: (h.paidPerUnitCents / 100).toFixed(2),
    paidOn: h.paidOn ?? '',
    mint: h.mint ?? '',
    year: h.year === undefined ? '' : String(h.year),
    location: h.location ?? '',
    note: h.note ?? '',
  };
}

export function buildSpot(metal: Metal, price: string, date: string, today: string): Result<Spot> {
  const cents = parseCents(price, { allowZero: false });
  if (!cents.ok) return cents;
  const when = parseDate(date, today, { allowFuture: false });
  if (!when.ok) return when;
  return { ok: true, value: { metal, centsPerOzt: cents.value, enteredOn: when.value } };
}
