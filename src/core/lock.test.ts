import { describe, expect, it } from 'vitest';
import {
  checkNewPassphrase,
  fromBase64,
  LockError,
  lockText,
  MAX_ITERATIONS,
  MESSAGES,
  MIN_ITERATIONS,
  PBKDF2_ITERATIONS,
  toBase64,
  unlockText,
} from './lock';

const FAST = MIN_ITERATIONS; // the real default is 600,000; the floor keeps the suite quick
const secret = JSON.stringify({ holdings: ['é € 🪙'], n: 1 });

async function lockedFile() {
  return lockText(secret, 'correct horse battery', FAST);
}

describe('locking an export with a passphrase', () => {
  it('opens again with the same passphrase and gives back the exact text', async () => {
    const file = await lockedFile();
    expect(await unlockText(file, 'correct horse battery')).toBe(secret);
  });

  it('reads the file after it has been written out and parsed again', async () => {
    const file = JSON.parse(JSON.stringify(await lockedFile())) as unknown;
    expect(await unlockText(file, 'correct horse battery')).toBe(secret);
  });

  it('uses 600,000 rounds by default and a fresh salt and nonce every time', async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const a = await lockedFile();
    const b = await lockedFile();
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
    expect(JSON.stringify(a)).not.toContain('holdings');
  });

  it('treats a passphrase typed with different Unicode forms as the same one', async () => {
    const composed = 'café society 1';
    const decomposed = 'café society 1';
    const file = await lockText(secret, composed, FAST);
    expect(await unlockText(file, decomposed)).toBe(secret);
  });

  it('rejects a wrong passphrase with the one honest message', async () => {
    const file = await lockedFile();
    await expect(unlockText(file, 'not the passphrase')).rejects.toMatchObject({ code: 'bad-passphrase', message: MESSAGES.badPassphrase });
    await expect(unlockText(file, '')).rejects.toMatchObject({ code: 'bad-passphrase' });
  });

  it('rejects a flipped ciphertext byte the same way', async () => {
    const file = await lockedFile();
    const bytes = fromBase64(file.data);
    bytes[3] = bytes[3]! ^ 1;
    await expect(unlockText({ ...file, data: toBase64(bytes) }, 'correct horse battery')).rejects.toMatchObject({ code: 'bad-passphrase' });
  });

  it('rejects an edited header: salt, nonce or round count', async () => {
    const file = await lockedFile();
    const salt = fromBase64(file.kdf.salt);
    salt[0] = salt[0]! ^ 1;
    const iv = fromBase64(file.cipher.iv);
    iv[0] = iv[0]! ^ 1;
    const pass = 'correct horse battery';
    await expect(unlockText({ ...file, kdf: { ...file.kdf, salt: toBase64(salt) } }, pass)).rejects.toBeInstanceOf(LockError);
    await expect(unlockText({ ...file, cipher: { ...file.cipher, iv: toBase64(iv) } }, pass)).rejects.toBeInstanceOf(LockError);
    await expect(unlockText({ ...file, kdf: { ...file.kdf, iterations: FAST + 1 } }, pass)).rejects.toMatchObject({ code: 'bad-passphrase' });
  });

  it('refuses silly round counts before doing any work', async () => {
    const file = await lockedFile();
    for (const iterations of [1, 0, -5, MIN_ITERATIONS - 1, MAX_ITERATIONS + 1, 1e9, 1.5, '600000', null]) {
      await expect(unlockText({ ...file, kdf: { ...file.kdf, iterations } }, 'x'), String(iterations)).rejects.toMatchObject({ code: 'bad-file' });
    }
  });

  it('rejects truncated and malformed envelopes as a damaged file', async () => {
    const file = await lockedFile();
    const bad: unknown[] = [
      null,
      'text',
      {},
      { ...file, data: file.data.slice(0, 8) },
      { ...file, data: '' },
      { ...file, data: 'not base64!' },
      { ...file, v: 2 },
      { ...file, kdf: { ...file.kdf, name: 'scrypt' } },
      { ...file, kdf: { ...file.kdf, salt: 'AAAA' } },
      { ...file, cipher: { ...file.cipher, iv: 'AAAA' } },
      { ...file, cipher: null },
    ];
    for (const b of bad) await expect(unlockText(b, 'correct horse battery')).rejects.toMatchObject({ code: 'bad-file' });
  });

  it('will not lock with a short or empty passphrase', async () => {
    expect(checkNewPassphrase('')).not.toBeNull();
    expect(checkNewPassphrase('seven77')).not.toBeNull();
    expect(checkNewPassphrase('eight888')).toBeNull();
    expect(checkNewPassphrase('🪙'.repeat(8))).toBeNull();
    await expect(lockText('x', 'short', FAST)).rejects.toThrow();
    await expect(lockText('x', 'long enough pass', 5)).rejects.toThrow();
  });
});
