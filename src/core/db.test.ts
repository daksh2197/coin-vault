import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DB_NAME, DB_VERSION, openVault, VaultError } from './db';
import type { Holding, Spot } from './types';
import { NG_PER_OZT } from './units';

const holding = (id: string, over: Partial<Holding> = {}): Holding => ({
  id,
  name: `Coin ${id}`,
  metal: 'silver',
  finenessPpm: 999900,
  weightNg: NG_PER_OZT.toString(),
  enteredUnit: 'ozt',
  quantity: 3,
  paidPerUnitCents: 9000,
  ...over,
});
const spot: Spot = { metal: 'silver', centsPerOzt: 8500, enteredOn: '2026-10-14' };

/** Build a database the way the first release did: version 1, holdings only, no unit field. */
function makeV1(factory: IDBFactory, rows: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore('holdings', { keyPath: 'id' });
      for (const row of rows) store.put(row);
    };
    open.onsuccess = () => {
      open.result.close();
      resolve();
    };
    open.onerror = () => reject(open.error);
  });
}

describe('the vault database', () => {
  it('starts empty on a brand-new device', async () => {
    const vault = await openVault(new IDBFactory());
    expect(await vault.readAll()).toEqual({ holdings: [], spots: [], lastBackup: null, unreadable: 0 });
    vault.close();
  });

  it('saves, reads back, edits and deletes holdings and spots', async () => {
    const vault = await openVault(new IDBFactory());
    await vault.putHolding(holding('a'));
    await vault.putHolding(holding('b'));
    await vault.putSpot(spot);
    await vault.putHolding(holding('a', { quantity: 9 }));
    await vault.deleteHolding('b');
    const data = await vault.readAll();
    expect(data.holdings).toEqual([holding('a', { quantity: 9 })]);
    expect(data.spots).toEqual([spot]);
    await vault.deleteSpot('silver');
    expect((await vault.readAll()).spots).toEqual([]);
    await vault.setLastBackup('2026-10-14T12:00:00.000Z');
    expect((await vault.readAll()).lastBackup).toBe('2026-10-14T12:00:00.000Z');
    vault.close();
  });

  it('replaces everything in one go', async () => {
    const vault = await openVault(new IDBFactory());
    await vault.putHolding(holding('old'));
    await vault.replaceAll([holding('new1'), holding('new2')], [spot]);
    const data = await vault.readAll();
    expect(data.holdings.map((h) => h.id).sort()).toEqual(['new1', 'new2']);
    expect(data.spots).toEqual([spot]);
    vault.close();
  });
});

describe('migrations', () => {
  it('upgrades a version 1 database to the current one and keeps every row', async () => {
    const factory = new IDBFactory();
    const { enteredUnit: _unit, ...v1a } = holding('a');
    const { enteredUnit: _unit2, ...v1b } = holding('b', { name: 'Second' });
    await makeV1(factory, [v1a, v1b]);
    const vault = await openVault(factory);
    const data = await vault.readAll();
    expect(DB_VERSION).toBe(2);
    expect(data.holdings.map((h) => h.id).sort()).toEqual(['a', 'b']);
    expect(data.holdings.every((h) => h.enteredUnit === 'g')).toBe(true);
    expect(data.holdings.find((h) => h.id === 'b')!.name).toBe('Second');
    expect(data.unreadable).toBe(0);
    await vault.putSpot(spot); // the new stores exist
    expect((await vault.readAll()).spots).toEqual([spot]);
    vault.close();
  });

  it('does not overwrite a unit that version 1 rows already had', async () => {
    const factory = new IDBFactory();
    await makeV1(factory, [holding('a', { enteredUnit: 'ozt' })]);
    const vault = await openVault(factory);
    expect((await vault.readAll()).holdings[0]!.enteredUnit).toBe('ozt');
    vault.close();
  });

  it('a second open of an up-to-date database changes nothing', async () => {
    const factory = new IDBFactory();
    const first = await openVault(factory);
    await first.putHolding(holding('a'));
    first.close();
    const second = await openVault(factory);
    expect((await second.readAll()).holdings).toEqual([holding('a')]);
    second.close();
  });

  it('refuses a database saved by a newer app, and leaves it alone', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const open = factory.open(DB_NAME, 99);
      open.onupgradeneeded = () => open.result.createObjectStore('holdings', { keyPath: 'id' });
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });
    await expect(openVault(factory)).rejects.toMatchObject({ name: 'VaultError', code: 'too-new' });
    const still = await new Promise<number>((resolve) => {
      const open = factory.open(DB_NAME);
      open.onsuccess = () => {
        const v = open.result.version;
        open.result.close();
        resolve(v);
      };
    });
    expect(still).toBe(99);
  });

  it('skips rows that fail validation and says how many', async () => {
    const factory = new IDBFactory();
    await makeV1(factory, [{ id: 'bad', name: '' }, holding('ok')]);
    const vault = await openVault(factory);
    const data = await vault.readAll();
    expect(data.holdings.map((h) => h.id)).toEqual(['ok']);
    expect(data.unreadable).toBe(1);
    vault.close();
  });
});

describe('a browser with no database', () => {
  it('fails with a clear message instead of a stack trace', async () => {
    const error = await openVault(null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultError);
    expect((error as VaultError).code).toBe('unavailable');
    const broken = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    await expect(openVault(broken)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
