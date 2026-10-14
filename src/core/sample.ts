/**
 * Invented demo data, so a first visit has something to look at. None of it is a real holding,
 * a real purchase or a real price. Every row carries `sample: true`, and the page says SAMPLE
 * wherever one shows. "Remove sample data" deletes exactly the rows with that flag.
 */

import { NG_PER_OZT } from './units';
import { type Holding, type Spot } from './types';

const ozt = (n: number, d: number): string => String((NG_PER_OZT * BigInt(n)) / BigInt(d));

export function sampleHoldings(today: string): Holding[] {
  const base = { enteredUnit: 'ozt' as const, paidOn: today, sample: true as const };
  return [
    { ...base, id: 'sample-gold-1oz', name: 'SAMPLE 1 oz gold round', metal: 'gold', finenessPpm: 999900, weightNg: ozt(1, 1), quantity: 2, paidPerUnitCents: 650000, location: 'Sample safe', note: 'Invented demo row.' },
    { ...base, id: 'sample-gold-tenth', name: 'SAMPLE 1/10 oz gold coin', metal: 'gold', finenessPpm: 999900, weightNg: ozt(1, 10), quantity: 5, paidPerUnitCents: 71000, location: 'Sample safe' },
    { ...base, id: 'sample-silver-1oz', name: 'SAMPLE 1 oz silver round', metal: 'silver', finenessPpm: 999900, weightNg: ozt(1, 1), quantity: 40, paidPerUnitCents: 10500 },
    { ...base, id: 'sample-platinum-1oz', name: 'SAMPLE 1 oz platinum bar', metal: 'platinum', finenessPpm: 999500, weightNg: ozt(1, 1), quantity: 1, paidPerUnitCents: 270000 },
  ];
}

export function sampleSpots(today: string): Spot[] {
  return [
    { metal: 'gold', centsPerOzt: 600000, enteredOn: today, sample: true },
    { metal: 'silver', centsPerOzt: 8500, enteredOn: today, sample: true },
    { metal: 'platinum', centsPerOzt: 250000, enteredOn: today, sample: true },
  ];
}
