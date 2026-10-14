/**
 * What a valid holding or spot looks like. Everything that comes from outside the form (an imported
 * file, a row read back from the database) goes through here, and only the known fields come out.
 * Unknown keys are dropped, so a file cannot smuggle in anything else.
 */

import { isIsoDate } from './dates';
import { type Result, fail } from './decimal';
import { MAX_CENTS, MAX_QUANTITY } from './money';
import { type Holding, METALS, type Metal, type Spot } from './types';
import { MAX_WEIGHT_NG, MIN_FINENESS_PPM, PPM } from './units';

export const LIMITS = { name: 120, mint: 80, location: 200, note: 2000 } as const;
const ID = /^[a-z0-9-]{1,64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMetal = (v: unknown): v is Metal => typeof v === 'string' && (METALS as readonly string[]).includes(v);

function optionalText(raw: Record<string, unknown>, key: 'mint' | 'location' | 'note'): Result<string | undefined> {
  const v = raw[key];
  if (v === undefined || v === null || v === '') return { ok: true, value: undefined };
  if (typeof v !== 'string') return fail(`"${key}" must be text.`);
  if (v.length > LIMITS[key]) return fail(`"${key}" is longer than ${LIMITS[key]} characters.`);
  return { ok: true, value: v };
}

export function sanitizeHolding(raw: unknown): Result<Holding> {
  if (!isRecord(raw)) return fail('A holding is not an object.');
  const { id, name, metal, finenessPpm, weightNg, enteredUnit, quantity, paidPerUnitCents } = raw;
  if (typeof id !== 'string' || !ID.test(id)) return fail('A holding has an invalid id.');
  if (typeof name !== 'string' || name.trim() === '' || name.length > LIMITS.name) return fail(`Holding ${id}: name is missing or too long.`);
  if (!isMetal(metal)) return fail(`Holding ${id}: unknown metal.`);
  if (!Number.isSafeInteger(finenessPpm) || (finenessPpm as number) < MIN_FINENESS_PPM || (finenessPpm as number) > PPM) {
    return fail(`Holding ${id}: fineness is out of range.`);
  }
  if (typeof weightNg !== 'string' || !/^[1-9]\d{0,17}$/.test(weightNg) || BigInt(weightNg) > MAX_WEIGHT_NG) {
    return fail(`Holding ${id}: weight is out of range.`);
  }
  if (enteredUnit !== 'g' && enteredUnit !== 'ozt') return fail(`Holding ${id}: unknown weight unit.`);
  if (!Number.isSafeInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_QUANTITY) {
    return fail(`Holding ${id}: quantity is out of range.`);
  }
  if (!Number.isSafeInteger(paidPerUnitCents) || (paidPerUnitCents as number) < 0 || (paidPerUnitCents as number) > MAX_CENTS) {
    return fail(`Holding ${id}: price paid is out of range.`);
  }
  const out: Holding = {
    id,
    name: name.trim(),
    metal,
    finenessPpm: finenessPpm as number,
    weightNg,
    enteredUnit,
    quantity: quantity as number,
    paidPerUnitCents: paidPerUnitCents as number,
  };
  if (raw.paidOn !== undefined && raw.paidOn !== null && raw.paidOn !== '') {
    if (typeof raw.paidOn !== 'string' || !isIsoDate(raw.paidOn)) return fail(`Holding ${id}: purchase date is not a real date.`);
    out.paidOn = raw.paidOn;
  }
  if (raw.year !== undefined && raw.year !== null && raw.year !== '') {
    if (!Number.isSafeInteger(raw.year) || (raw.year as number) < 1 || (raw.year as number) > 2100) return fail(`Holding ${id}: year is out of range.`);
    out.year = raw.year as number;
  }
  for (const key of ['mint', 'location', 'note'] as const) {
    const text = optionalText(raw, key);
    if (!text.ok) return fail(`Holding ${id}: ${text.error}`);
    if (text.value !== undefined) out[key] = text.value;
  }
  if (raw.sample === true) out.sample = true;
  return { ok: true, value: out };
}

export function sanitizeSpot(raw: unknown): Result<Spot> {
  if (!isRecord(raw)) return fail('A spot price is not an object.');
  const { metal, centsPerOzt, enteredOn } = raw;
  if (!isMetal(metal)) return fail('A spot price has an unknown metal.');
  if (!Number.isSafeInteger(centsPerOzt) || (centsPerOzt as number) < 1 || (centsPerOzt as number) > MAX_CENTS) {
    return fail(`Spot price for ${metal} is out of range.`);
  }
  if (typeof enteredOn !== 'string' || !isIsoDate(enteredOn)) return fail(`Spot price for ${metal} has no real date.`);
  const out: Spot = { metal, centsPerOzt: centsPerOzt as number, enteredOn };
  if (raw.sample === true) out.sample = true;
  return { ok: true, value: out };
}

/** A fresh random id for a new holding. */
export function newId(): string {
  return crypto.randomUUID();
}
