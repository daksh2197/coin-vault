import { describe, expect, it } from 'vitest';
import { sanitizeHolding, sanitizeSpot } from './schema';
import type { Holding, Spot } from './types';
import { NG_PER_OZT } from './units';
import { buildExport, EXPORT_SCHEMA, mergeVaults, parseVaultText, serializeExport } from './vaultfile';

const holding = (id: string, over: Partial<Holding> = {}): Holding => ({
  id,
  name: `Coin ${id}`,
  metal: 'gold',
  finenessPpm: 999900,
  weightNg: NG_PER_OZT.toString(),
  enteredUnit: 'ozt',
  quantity: 1,
  paidPerUnitCents: 650000,
  paidOn: '2026-03-01',
  location: 'Top shelf',
  note: 'Story <b>here</b>',
  year: 2024,
  mint: 'Some mint',
  ...over,
});
const spots: Spot[] = [{ metal: 'gold', centsPerOzt: 600000, enteredOn: '2026-10-14' }];
const NOW = new Date('2026-10-14T12:00:00Z');

function text(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...buildExport([holding('a')], spots, NOW), ...over });
}

describe('export and import', () => {
  it('round-trips holdings and spots exactly', () => {
    const file = serializeExport(buildExport([holding('a'), holding('b', { metal: 'silver' })], spots, NOW));
    const back = parseVaultText(file);
    expect(back.ok).toBe(true);
    if (back.ok && back.value.kind === 'plain') {
      expect(back.value.vault.holdings).toEqual([holding('a'), holding('b', { metal: 'silver' })]);
      expect(back.value.vault.spots).toEqual(spots);
      expect(back.value.vault.exportedAt).toBe('2026-10-14T12:00:00.000Z');
    }
  });

  it('says plainly when a file is not ours', () => {
    for (const t of ['', 'not json', '[]', 'null', '"x"', '{"format":"other"}', text({ format: 'nope' }), text({ schema: 'x' }), text({ holdings: {} })]) {
      const r = parseVaultText(t);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.error).toBe('This is not a Coin Vault file.');
    }
  });

  it('copes with a truncated file', () => {
    const full = text();
    expect(parseVaultText(full.slice(0, full.length - 30)).ok).toBe(false);
  });

  it('refuses a file from a newer version with a message that says so', () => {
    const r = parseVaultText(text({ schema: EXPORT_SCHEMA + 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer version/);
  });

  it('refuses duplicate ids, duplicate metals and invalid rows, naming the problem', () => {
    const dup = parseVaultText(text({ holdings: [holding('a'), holding('a')] }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/share the id a/);
    const dupSpot = parseVaultText(text({ spots: [...spots, ...spots] }));
    expect(dupSpot.ok).toBe(false);
    const bad = parseVaultText(text({ holdings: [holding('a', { quantity: 0 })] }));
    expect(bad.ok).toBe(false);
  });

  it('recognises an encrypted envelope without opening it', () => {
    const r = parseVaultText(JSON.stringify({ format: 'coin-vault-enc', v: 1 }));
    expect(r).toEqual({ ok: true, value: { kind: 'encrypted', file: { format: 'coin-vault-enc', v: 1 } } });
  });

  it('refuses a file over 10 MB without parsing it', () => {
    expect(parseVaultText('x'.repeat(10 * 1024 * 1024 + 1)).ok).toBe(false);
  });

  it('keeps only known fields, so a hostile file cannot add its own', () => {
    const evil = `{"format":"coin-vault","schema":1,"exportedAt":"x","spots":[],"holdings":[
      {"id":"a","name":"N","metal":"gold","finenessPpm":999900,"weightNg":"31103476800","enteredUnit":"g","quantity":1,"paidPerUnitCents":1,
       "__proto__":{"polluted":true},"constructor":"x","extra":"y"}]}`;
    const r = parseVaultText(evil);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === 'plain') {
      const h = r.value.vault.holdings[0]!;
      expect(Object.keys(h).sort()).toEqual(['enteredUnit', 'finenessPpm', 'id', 'metal', 'name', 'paidPerUnitCents', 'quantity', 'weightNg']);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it('keeps HTML in a name or note as plain text, untouched', () => {
    const h = sanitizeHolding(holding('a', { name: '<img src=x onerror=alert(1)>', note: '<script>x</script>' }));
    expect(h.ok && h.value.name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('what a holding may contain', () => {
  const ok = (over: Record<string, unknown>) => sanitizeHolding({ ...holding('a'), ...over }).ok;

  it('rejects out-of-range and malformed fields', () => {
    expect(ok({})).toBe(true);
    expect(ok({ id: '__proto__' })).toBe(false);
    expect(ok({ id: 'A B' })).toBe(false);
    expect(ok({ name: '   ' })).toBe(false);
    expect(ok({ name: 'x'.repeat(121) })).toBe(false);
    expect(ok({ note: 'x'.repeat(2001) })).toBe(false);
    expect(ok({ note: 'x'.repeat(2000) })).toBe(true);
    expect(ok({ metal: 'copper' })).toBe(false);
    expect(ok({ finenessPpm: 1_000_001 })).toBe(false);
    expect(ok({ finenessPpm: 99_999 })).toBe(false);
    expect(ok({ finenessPpm: 0.5 })).toBe(false);
    expect(ok({ weightNg: '0' })).toBe(false);
    expect(ok({ weightNg: '-5' })).toBe(false);
    expect(ok({ weightNg: '1e9' })).toBe(false);
    expect(ok({ weightNg: '100000000000001' })).toBe(false);
    expect(ok({ weightNg: 5 })).toBe(false);
    expect(ok({ enteredUnit: 'kg' })).toBe(false);
    expect(ok({ quantity: 1.5 })).toBe(false);
    expect(ok({ quantity: 1_000_001 })).toBe(false);
    expect(ok({ paidPerUnitCents: -1 })).toBe(false);
    expect(ok({ paidPerUnitCents: 0 })).toBe(true);
    expect(ok({ paidPerUnitCents: Number.MAX_SAFE_INTEGER })).toBe(false);
    expect(ok({ paidOn: '2026-02-30' })).toBe(false);
    expect(ok({ year: 1.5 })).toBe(false);
  });

  it('rejects bad spot prices', () => {
    expect(sanitizeSpot({ metal: 'gold', centsPerOzt: 0, enteredOn: '2026-10-14' }).ok).toBe(false);
    expect(sanitizeSpot({ metal: 'gold', centsPerOzt: -5, enteredOn: '2026-10-14' }).ok).toBe(false);
    expect(sanitizeSpot({ metal: 'gold', centsPerOzt: 5, enteredOn: '2026-13-01' }).ok).toBe(false);
    expect(sanitizeSpot({ metal: 'iron', centsPerOzt: 5, enteredOn: '2026-10-14' }).ok).toBe(false);
  });
});

describe('adding an import to what is already there', () => {
  it('lets the imported row win on the same id and keeps the rest', () => {
    const merged = mergeVaults(
      { holdings: [holding('a'), holding('b')], spots },
      { holdings: [holding('b', { quantity: 7 }), holding('c')], spots: [] },
    );
    expect(merged.holdings.map((h) => [h.id, h.quantity])).toEqual([['a', 1], ['b', 7], ['c', 1]]);
    expect(merged.spots).toEqual(spots);
  });

  it('keeps the newer spot for each metal', () => {
    const older: Spot = { metal: 'gold', centsPerOzt: 1, enteredOn: '2026-01-01' };
    const newer: Spot = { metal: 'gold', centsPerOzt: 2, enteredOn: '2026-12-01' };
    expect(mergeVaults({ holdings: [], spots: [newer] }, { holdings: [], spots: [older] }).spots).toEqual([newer]);
    expect(mergeVaults({ holdings: [], spots: [older] }, { holdings: [], spots: [newer] }).spots).toEqual([newer]);
  });
});
