import { describe, expect, it } from 'vitest';
import { ageWords, daysBetween, isIsoDate, todayLocal } from './dates';
import { buildHolding, buildSpot, holdingToInput, type HoldingInput } from './form';
import { parseCents, parseQuantity } from './money';

const TODAY = '2026-10-14';
const good: HoldingInput = {
  name: ' 1 oz gold bar ',
  metal: 'gold',
  fineness: '99.99',
  weight: '1',
  unit: 'ozt',
  quantity: '2',
  paid: '6500.50',
  paidOn: '2026-03-01',
  mint: 'Test mint',
  year: '2024',
  location: 'Shelf 2',
  note: 'a note',
};

describe('the add-a-holding form', () => {
  it('turns typed text into a checked holding', () => {
    const r = buildHolding(good, 'abc', TODAY);
    expect(r).toEqual({
      ok: true,
      value: {
        id: 'abc',
        name: '1 oz gold bar',
        metal: 'gold',
        finenessPpm: 999900,
        weightNg: '31103476800',
        enteredUnit: 'ozt',
        quantity: 2,
        paidPerUnitCents: 650050,
        paidOn: '2026-03-01',
        year: 2024,
        mint: 'Test mint',
        location: 'Shelf 2',
        note: 'a note',
      },
    });
  });

  it('reports every bad field at once, with a message for each', () => {
    const r = buildHolding({ ...good, name: '', metal: 'tin', fineness: '', weight: '-1', quantity: '0', paid: 'abc', paidOn: '2026-02-30', year: '20x' }, 'x', TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['fineness', 'metal', 'name', 'paid', 'paidOn', 'quantity', 'weight', 'year']);
  });

  it('accepts a coin paid nothing for (a gift) and rejects a future purchase date', () => {
    expect(buildHolding({ ...good, paid: '0' }, 'x', TODAY).ok).toBe(true);
    const r = buildHolding({ ...good, paidOn: '2027-01-01' }, 'x', TODAY);
    expect(r.ok).toBe(false);
  });

  it('leaves optional fields out rather than saving blanks', () => {
    const r = buildHolding({ ...good, paidOn: '', mint: '', year: '', location: '', note: '' }, 'x', TODAY);
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['enteredUnit', 'finenessPpm', 'id', 'metal', 'name', 'paidPerUnitCents', 'quantity', 'weightNg']);
  });

  it('shows an existing holding back exactly as it can be saved again', () => {
    const first = buildHolding(good, 'abc', TODAY);
    if (!first.ok) throw new Error('setup');
    const again = buildHolding(holdingToInput(first.value), 'abc', TODAY);
    expect(again).toEqual(first);
    const grams = buildHolding({ ...good, unit: 'g', weight: '31.1034768' }, 'g', TODAY);
    if (!grams.ok) throw new Error('setup');
    expect(buildHolding(holdingToInput(grams.value), 'g', TODAY)).toEqual(grams);
  });

  it('handles very long text and emoji', () => {
    expect(buildHolding({ ...good, note: 'x'.repeat(10_000) }, 'x', TODAY).ok).toBe(false);
    const r = buildHolding({ ...good, name: '🪙 שלום' }, 'x', TODAY);
    expect(r.ok && r.value.name).toBe('🪙 שלום');
  });
});

describe('typing a spot price', () => {
  it('stores cents per ounce with the date', () => {
    expect(buildSpot('gold', '6000', TODAY, TODAY)).toEqual({ ok: true, value: { metal: 'gold', centsPerOzt: 600000, enteredOn: TODAY } });
  });

  it('refuses zero, negatives, three decimals, junk and future dates', () => {
    for (const price of ['0', '0.00', '-5', '12.345', 'abc', '', '1e3']) expect(buildSpot('gold', price, TODAY, TODAY).ok, price).toBe(false);
    expect(buildSpot('gold', '6000', '2026-10-15', TODAY).ok).toBe(false);
    expect(buildSpot('gold', '6000', 'yesterday', TODAY).ok).toBe(false);
  });

  it('accepts an old date and measures its age', () => {
    expect(buildSpot('gold', '6000', '2020-01-01', TODAY).ok).toBe(true);
    expect(daysBetween('2026-10-01', TODAY)).toBe(13);
    expect(ageWords(0)).toBe('today');
    expect(ageWords(1)).toBe('1 day ago');
    expect(ageWords(13)).toBe('13 days ago');
  });
});

describe('dates and amounts', () => {
  it('knows real dates from impossible ones', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('26-1-1')).toBe(false);
  });

  it('reads today from the local clock', () => {
    expect(todayLocal(new Date(2026, 9, 14, 23, 59))).toBe('2026-10-14');
  });

  it('reads money and counts strictly', () => {
    expect(parseCents('1234.5', { allowZero: true })).toEqual({ ok: true, value: 123450 });
    expect(parseCents('0.005', { allowZero: true }).ok).toBe(false);
    expect(parseCents('99999999999', { allowZero: true }).ok).toBe(false);
    expect(parseQuantity('1.5').ok).toBe(false);
    expect(parseQuantity('1e9').ok).toBe(false);
    expect(parseQuantity('1000000').ok).toBe(true);
    expect(parseQuantity('1000001').ok).toBe(false);
  });
});
