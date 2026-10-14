/**
 * The vault's database: IndexedDB, the browser's built-in database. It lives on this device only.
 *
 * Versions are how a database changes shape without losing rows. Each number below has one
 * migration. Opening the database runs, in order, every migration from the version on disk up to
 * DB_VERSION, inside one transaction: either all of them land or none do.
 *
 *   v1  holdings store
 *   v2  spots store, meta store; older holdings get the weight unit they were entered in
 *
 * A database newer than this app is refused rather than opened, because an old app writing into a
 * new shape is how data gets damaged.
 */

import { sanitizeHolding, sanitizeSpot } from './schema';
import { type Holding, type Metal, type Spot } from './types';

export const DB_NAME = 'coin-vault';
export const DB_VERSION = 2;

export class VaultError extends Error {
  constructor(
    readonly code: 'too-new' | 'unavailable' | 'quota' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

/** Index 0 is the migration to version 1, and so on. Never edit one that has shipped: add the next. */
export const MIGRATIONS: Migration[] = [
  (db) => {
    db.createObjectStore('holdings', { keyPath: 'id' });
  },
  (db, tx) => {
    db.createObjectStore('spots', { keyPath: 'metal' });
    db.createObjectStore('meta', { keyPath: 'key' });
    // Version 1 did not record the unit a weight was typed in. Grams is what it assumed.
    const holdings = tx.objectStore('holdings');
    holdings.openCursor().onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      const row = cursor.value as Record<string, unknown>;
      if (row.enteredUnit !== 'g' && row.enteredUnit !== 'ozt') cursor.update({ ...row, enteredUnit: 'g' });
      cursor.continue();
    };
  },
];

export interface VaultData {
  holdings: Holding[];
  spots: Spot[];
  lastBackup: string | null;
  /** Rows on disk that failed validation and were left out of the lists above. */
  unreadable: number;
}

export interface Vault {
  readAll(): Promise<VaultData>;
  putHolding(h: Holding): Promise<void>;
  deleteHolding(id: string): Promise<void>;
  putSpot(s: Spot): Promise<void>;
  deleteSpot(metal: Metal): Promise<void>;
  /** Replace everything in one transaction. */
  replaceAll(holdings: readonly Holding[], spots: readonly Spot[]): Promise<void>;
  setLastBackup(iso: string): Promise<void>;
  close(): void;
}

function asVaultError(error: unknown): VaultError {
  if (error instanceof VaultError) return error;
  const name = (error as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') return new VaultError('quota', 'This device has no room left for the vault. Export a backup and free some space.');
  if (name === 'VersionError') {
    return new VaultError('too-new', 'This vault was saved by a newer version of Coin Vault. Update the app; nothing was changed.');
  }
  return new VaultError('failed', 'The vault could not be read or saved on this device.');
}

const wrap = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(asVaultError(request.error));
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asVaultError(tx.error));
    tx.onabort = () => reject(asVaultError(tx.error));
  });

export function openVault(factory: IDBFactory | null = globalThis.indexedDB ?? null, name: string = DB_NAME): Promise<Vault> {
  if (!factory) {
    return Promise.reject(new VaultError('unavailable', 'This browser does not let Coin Vault keep data here. Private windows often block it.'));
  }
  return new Promise<Vault>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, DB_VERSION);
    } catch {
      reject(new VaultError('unavailable', 'This browser does not let Coin Vault keep data here. Private windows often block it.'));
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction as IDBTransaction;
      for (let v = event.oldVersion; v < DB_VERSION; v += 1) MIGRATIONS[v]?.(db, tx);
    };
    request.onblocked = () => reject(new VaultError('failed', 'Another tab has the vault open on an older version. Close it and reload.'));
    request.onerror = () => {
      const e = asVaultError(request.error);
      reject(e.code === 'failed' ? new VaultError('unavailable', 'This browser does not let Coin Vault keep data here. Private windows often block it.') : e);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(makeVault(db));
    };
  });
}

function makeVault(db: IDBDatabase): Vault {
  const run = async <T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> => {
    try {
      const tx = db.transaction(stores, mode);
      const finished = done(tx);
      const result = await work(tx);
      await finished;
      return result;
    } catch (error) {
      throw asVaultError(error);
    }
  };

  return {
    readAll: () =>
      run(['holdings', 'spots', 'meta'], 'readonly', async (tx) => {
        const [rawHoldings, rawSpots, backup] = await Promise.all([
          wrap(tx.objectStore('holdings').getAll()),
          wrap(tx.objectStore('spots').getAll()),
          wrap(tx.objectStore('meta').get('lastBackup')),
        ]);
        let unreadable = 0;
        const holdings: Holding[] = [];
        for (const raw of rawHoldings) {
          const h = sanitizeHolding(raw);
          if (h.ok) holdings.push(h.value);
          else unreadable += 1;
        }
        const spots: Spot[] = [];
        for (const raw of rawSpots) {
          const s = sanitizeSpot(raw);
          if (s.ok) spots.push(s.value);
          else unreadable += 1;
        }
        const when = (backup as { value?: unknown } | undefined)?.value;
        return { holdings, spots, lastBackup: typeof when === 'string' ? when : null, unreadable };
      }),
    putHolding: (h) => run(['holdings'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('holdings').put(h)))),
    deleteHolding: (id) => run(['holdings'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('holdings').delete(id)))),
    putSpot: (s) => run(['spots'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('spots').put(s)))),
    deleteSpot: (metal) => run(['spots'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('spots').delete(metal)))),
    replaceAll: (holdings, spots) =>
      run(['holdings', 'spots'], 'readwrite', async (tx) => {
        const hs = tx.objectStore('holdings');
        const ss = tx.objectStore('spots');
        await Promise.all([wrap(hs.clear()), wrap(ss.clear())]);
        await Promise.all([...holdings.map((h) => wrap(hs.put(h))), ...spots.map((s) => wrap(ss.put(s)))]);
      }),
    setLastBackup: (iso) => run(['meta'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('meta').put({ key: 'lastBackup', value: iso })))),
    close: () => db.close(),
  };
}
