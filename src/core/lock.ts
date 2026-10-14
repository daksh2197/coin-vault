/**
 * Locking an export with a passphrase.
 *
 *   passphrase --PBKDF2-HMAC-SHA256, 600,000 rounds, random salt--> 256-bit key
 *   key + random 96-bit nonce --AES-GCM--> ciphertext + authentication tag
 *
 * AES-GCM does two jobs: it hides the contents, and it detects any change to them.
 * The envelope's own settings (rounds, salt, nonce) are fed in as "additional data",
 * so editing them breaks the tag the same way editing the ciphertext does.
 * A wrong passphrase and a tampered file are indistinguishable by design, so one message covers both.
 */

import { ENCRYPTED_FORMAT, type EncryptedExport, MAX_FILE_BYTES } from './vaultfile';

export const PBKDF2_ITERATIONS = 600_000;
/** Refuse anything outside this range before deriving a key. 1 would be trivially weak; 1e9 would hang the tab. */
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 2_000_000;
export const MIN_PASSPHRASE_CHARS = 8;

export type LockErrorCode = 'bad-file' | 'bad-passphrase';

export class LockError extends Error {
  constructor(
    readonly code: LockErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LockError';
  }
}

export const MESSAGES = {
  badFile: 'This is not a Coin Vault file, or it is damaged.',
  badPassphrase: 'That passphrase does not open this file, or the file was changed after it was saved.',
} as const;

const encoder = new TextEncoder();

/** Passphrases are normalised (NFC) so "é" typed two ways on two keyboards is the same passphrase. */
export const normalizePassphrase = (p: string): string => p.normalize('NFC');

export function checkNewPassphrase(p: string): string | null {
  if ([...p].length < MIN_PASSPHRASE_CHARS) return `Use at least ${MIN_PASSPHRASE_CHARS} characters.`;
  return null;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string, expectedLength?: number): Uint8Array {
  if (typeof text !== 'string' || text.length > MAX_FILE_BYTES * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new LockError('bad-file', MESSAGES.badFile);
  }
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (expectedLength !== undefined && bytes.length !== expectedLength) throw new LockError('bad-file', MESSAGES.badFile);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** The bytes the tag also covers: every setting in the envelope, in a fixed order. */
function additionalData(iterations: number, salt: string, iv: string): Uint8Array {
  return encoder.encode(`${ENCRYPTED_FORMAT}|1|PBKDF2|SHA-256|${iterations}|${salt}|AES-GCM|${iv}`);
}

export async function lockText(plaintext: string, passphrase: string, iterations: number = PBKDF2_ITERATIONS): Promise<EncryptedExport> {
  if (checkNewPassphrase(passphrase)) throw new Error('The passphrase is too short.');
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('Unsafe iteration count.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const saltText = toBase64(salt);
  const ivText = toBase64(iv);
  const key = await deriveKey(passphrase, salt, iterations);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: additionalData(iterations, saltText, ivText) as BufferSource },
    key,
    encoder.encode(plaintext),
  );
  return {
    format: ENCRYPTED_FORMAT,
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: saltText },
    cipher: { name: 'AES-GCM', iv: ivText },
    data: toBase64(new Uint8Array(sealed)),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function unlockText(file: unknown, passphrase: string): Promise<string> {
  if (!isRecord(file) || file.format !== ENCRYPTED_FORMAT || file.v !== 1) throw new LockError('bad-file', MESSAGES.badFile);
  const { kdf, cipher, data } = file;
  if (!isRecord(kdf) || !isRecord(cipher)) throw new LockError('bad-file', MESSAGES.badFile);
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || cipher.name !== 'AES-GCM') throw new LockError('bad-file', MESSAGES.badFile);
  const iterations = kdf.iterations;
  if (!Number.isInteger(iterations) || (iterations as number) < MIN_ITERATIONS || (iterations as number) > MAX_ITERATIONS) {
    throw new LockError('bad-file', MESSAGES.badFile);
  }
  if (typeof kdf.salt !== 'string' || typeof cipher.iv !== 'string' || typeof data !== 'string') throw new LockError('bad-file', MESSAGES.badFile);
  const salt = fromBase64(kdf.salt, 16);
  fromBase64(cipher.iv, 12);
  const sealed = fromBase64(data);
  if (sealed.length < 16) throw new LockError('bad-file', MESSAGES.badFile);
  const iv = fromBase64(cipher.iv, 12);
  const key = await deriveKey(passphrase, salt, iterations as number);
  try {
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: additionalData(iterations as number, kdf.salt, cipher.iv) as BufferSource },
      key,
      sealed as BufferSource,
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(opened);
  } catch {
    throw new LockError('bad-passphrase', MESSAGES.badPassphrase);
  }
}
