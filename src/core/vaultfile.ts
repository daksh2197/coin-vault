/**
 * The export file: plain JSON, or the same JSON locked inside an encrypted envelope.
 * This module reads and checks files. It never trusts them: every row goes through schema.ts.
 */

import { type Result, fail } from './decimal';
import { sanitizeHolding, sanitizeSpot } from './schema';
import { type Holding, METALS, type Spot } from './types';

export const EXPORT_FORMAT = 'coin-vault';
export const ENCRYPTED_FORMAT = 'coin-vault-enc';
/** Bump when the shape of the export changes. Older files must keep importing. */
export const EXPORT_SCHEMA = 1;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_HOLDINGS = 10_000;

export interface VaultExport {
  format: typeof EXPORT_FORMAT;
  schema: number;
  exportedAt: string;
  holdings: Holding[];
  spots: Spot[];
}

export interface EncryptedExport {
  format: typeof ENCRYPTED_FORMAT;
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  /** Base64 of the ciphertext with its 16-byte authentication tag at the end. */
  data: string;
}

export const NOT_A_VAULT = 'This is not a Coin Vault file.';

export function buildExport(holdings: readonly Holding[], spots: readonly Spot[], now: Date): VaultExport {
  return { format: EXPORT_FORMAT, schema: EXPORT_SCHEMA, exportedAt: now.toISOString(), holdings: [...holdings], spots: [...spots] };
}

export const serializeExport = (file: VaultExport): string => JSON.stringify(file, null, 2);

export type ParsedFile = { kind: 'plain'; vault: VaultExport } | { kind: 'encrypted'; file: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** First look at a file's text. An encrypted envelope is only recognised here; decrypt.ts opens it. */
export function parseVaultText(text: string): Result<ParsedFile> {
  if (text.length > MAX_FILE_BYTES) return fail('That file is too large to be a Coin Vault backup.');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail(NOT_A_VAULT);
  }
  if (!isRecord(json)) return fail(NOT_A_VAULT);
  if (json.format === ENCRYPTED_FORMAT) return { ok: true, value: { kind: 'encrypted', file: json } };
  return validateExport(json);
}

/** Check a decoded export. Also used on the plaintext inside an encrypted file. */
export function validateExport(json: unknown): Result<ParsedFile> {
  if (!isRecord(json) || json.format !== EXPORT_FORMAT) return fail(NOT_A_VAULT);
  const { schema, exportedAt, holdings, spots } = json;
  if (!Number.isSafeInteger(schema) || (schema as number) < 1) return fail(NOT_A_VAULT);
  if ((schema as number) > EXPORT_SCHEMA) {
    return fail('This file was made by a newer version of Coin Vault. Update the app and try again.');
  }
  if (!Array.isArray(holdings) || !Array.isArray(spots)) return fail(NOT_A_VAULT);
  if (holdings.length > MAX_HOLDINGS) return fail('That file has too many holdings.');
  const cleanHoldings: Holding[] = [];
  const seen = new Set<string>();
  for (const raw of holdings) {
    const h = sanitizeHolding(raw);
    if (!h.ok) return fail(h.error);
    if (seen.has(h.value.id)) return fail(`Two holdings share the id ${h.value.id}.`);
    seen.add(h.value.id);
    cleanHoldings.push(h.value);
  }
  const cleanSpots: Spot[] = [];
  const metals = new Set<string>();
  for (const raw of spots) {
    const s = sanitizeSpot(raw);
    if (!s.ok) return fail(s.error);
    if (metals.has(s.value.metal)) return fail(`Two spot prices for ${s.value.metal}.`);
    metals.add(s.value.metal);
    cleanSpots.push(s.value);
  }
  return {
    ok: true,
    value: {
      kind: 'plain',
      vault: {
        format: EXPORT_FORMAT,
        schema: schema as number,
        exportedAt: typeof exportedAt === 'string' ? exportedAt.slice(0, 40) : '',
        holdings: cleanHoldings,
        spots: cleanSpots,
      },
    },
  };
}

/** Add an import to what is already here. Same id: the imported row wins. Same metal: the newer spot date wins. */
export function mergeVaults(
  current: { holdings: readonly Holding[]; spots: readonly Spot[] },
  incoming: { holdings: readonly Holding[]; spots: readonly Spot[] },
): { holdings: Holding[]; spots: Spot[] } {
  const holdings = new Map(current.holdings.map((h) => [h.id, h]));
  for (const h of incoming.holdings) holdings.set(h.id, h);
  const spots = new Map<string, Spot>(current.spots.map((s) => [s.metal, s]));
  for (const s of incoming.spots) {
    const have = spots.get(s.metal);
    if (!have || s.enteredOn >= have.enteredOn) spots.set(s.metal, s);
  }
  return {
    holdings: [...holdings.values()],
    spots: METALS.flatMap((m) => {
      const s = spots.get(m);
      return s ? [s] : [];
    }),
  };
}
