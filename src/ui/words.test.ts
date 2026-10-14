import { describe, expect, it } from 'vitest';
import type { Line } from '../core/melt';
import { asOf, asOfTotals, BACKUP_NAG_DAYS, backupStatus, excludedText, missingSpotText, STALE_DAYS } from './words';

const spot = (enteredOn: string, sample = false) => ({ metal: 'gold' as const, centsPerOzt: 1, enteredOn, ...(sample ? { sample: true as const } : {}) });
const line = (s: ReturnType<typeof spot> | null): Line => ({ holding: {} as Line['holding'], paid: 0n, melt: s ? 0n : null, spot: s, gap: null, premiumBp: null, gain: null });

describe('the date beside every figure', () => {
  it('says which day the spot was typed and how old that is', () => {
    expect(asOf(spot('2026-10-14'), '2026-10-14')).toBe('spot 2026-10-14 (today)');
    expect(asOf(spot('2026-10-01'), '2026-10-14')).toBe('spot 2026-10-01 (13 days ago)');
    expect(asOf(null, '2026-10-14')).toBe('');
  });

  it('says so when a price is dated in the future', () => {
    expect(asOf(spot('2999-01-01'), '2026-10-14')).toBe('spot 2999-01-01 (dated in the future)');
  });

  it('labels invented prices SAMPLE', () => {
    expect(asOf(spot('2026-10-14', true), '2026-10-14')).toMatch(/^SAMPLE spot/);
  });

  it('gives a range for several dates and flags an old one', () => {
    expect(asOfTotals([line(spot('2026-10-14'))], '2026-10-14')).toBe('spot typed 2026-10-14');
    expect(asOfTotals([line(spot('2026-10-10')), line(spot('2026-10-14'))], '2026-10-14')).toBe('spots typed 2026-10-10 to 2026-10-14');
    expect(asOfTotals([line(spot('2026-09-01'))], '2026-10-14')).toBe('spot typed 2026-09-01. Oldest is 43 days old.');
    expect(asOfTotals([line(null)], '2026-10-14')).toBe('');
    expect(STALE_DAYS).toBe(7);
    expect(BACKUP_NAG_DAYS).toBe(7);
  });
});

describe('missing prices', () => {
  it('names the metals that need one', () => {
    expect(missingSpotText([])).toBe('');
    expect(missingSpotText(['gold'])).toBe('Enter a spot price for gold.');
    expect(missingSpotText(['gold', 'silver', 'platinum'])).toBe('Enter a spot price for gold, silver and platinum.');
    expect(excludedText(0, [])).toBe('');
    expect(excludedText(1, ['palladium'])).toBe('1 holding is left out of melt, premium and gain. Enter a spot price for palladium.');
  });
});

describe('the backup reminder', () => {
  it('nags only when there is something to lose', () => {
    expect(backupStatus(null, '2026-10-14', false)).toMatch(/No backup yet/);
    expect(backupStatus(null, '2026-10-14', true)).toMatch(/have not saved a backup/);
    expect(backupStatus('2026-10-13T10:00:00.000Z', '2026-10-14', true)).toBe('Last backup: 2026-10-13 (1 day ago).');
    expect(backupStatus('2026-10-01T10:00:00.000Z', '2026-10-14', true)).toMatch(/Safari/);
    expect(backupStatus('2026-10-01T10:00:00.000Z', '2026-10-14', false)).not.toMatch(/Safari/);
  });
});
