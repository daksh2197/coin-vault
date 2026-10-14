export const METALS = ['gold', 'silver', 'platinum', 'palladium'] as const;
export type Metal = (typeof METALS)[number];
export const METAL_LABEL: Record<Metal, string> = {
  gold: 'Gold',
  silver: 'Silver',
  platinum: 'Platinum',
  palladium: 'Palladium',
};

export type Unit = 'g' | 'ozt';

/** One kind of coin or bar you hold. Weight is for ONE piece; quantity multiplies. */
export interface Holding {
  id: string;
  name: string;
  metal: Metal;
  /** Parts per million: 0.9999 is 999900. */
  finenessPpm: number;
  /** Weight of one piece in whole nanograms, as a decimal string (it is a bigint). */
  weightNg: string;
  /** The unit it was typed in, so the form shows it back the same way. */
  enteredUnit: Unit;
  quantity: number;
  /** Price paid for ONE piece, in Canadian cents. */
  paidPerUnitCents: number;
  paidOn?: string;
  mint?: string;
  year?: number;
  location?: string;
  note?: string;
  /** True only for the invented demo rows. */
  sample?: true;
}

/** A spot price the user typed: Canadian cents per troy ounce, and the day they typed it for. */
export interface Spot {
  metal: Metal;
  centsPerOzt: number;
  enteredOn: string;
  sample?: true;
}
