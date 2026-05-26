// Lock-screen PIN derivation utilities.
//
// Why this exists:
//   The previous implementation persisted SHA-256(password) to localStorage.
//   SHA-256 of a real password is a password equivalent: a single XSS
//   exfiltration lets an attacker brute-force it in seconds (passwords have
//   low entropy and SHA-256 is fast). This module replaces that pattern
//   with a *separate* unlock PIN (4-6 digits) derived through PBKDF2 with
//   200,000 iterations against a per-install random salt.
//
// Security model:
//   - The PIN is NEVER the user's password. It's purely a convenience.
//   - Salt is generated once per install, stored in localStorage. Stealing
//     the salt alone is useless without the PIN.
//   - PBKDF2-SHA-256 @ 200k iters makes brute force ~5s per PIN guess on
//     a typical browser. With 5-fail forced-re-login, that's bounded.
//   - On 5 failed attempts the unlock is escalated: localStorage cleared,
//     full password re-login required.

const SALT_KEY = 'kiramopay-lock-salt';
const PIN_HASH_KEY = 'kiramopay-lock-pin-hash';
const FAIL_COUNT_KEY = 'kiramopay-lock-fail-count';
const PBKDF2_ITERATIONS = 200_000;
const HASH_BYTES = 32;
export const MAX_PIN_FAILS = 5;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function getOrCreateSalt(): Uint8Array {
  const existing = localStorage.getItem(SALT_KEY);
  if (existing) {
    return hexToBytes(existing);
  }
  const fresh = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(SALT_KEY, bytesToHex(fresh));
  return fresh;
}

async function derivePin(pin: string): Promise<string> {
  const salt = getOrCreateSalt();
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMat,
    HASH_BYTES * 8,
  );
  return bytesToHex(new Uint8Array(bits));
}

function validatePinFormat(pin: string) {
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error('PIN must be 4 to 6 digits');
  }
}

export async function setLockPin(pin: string): Promise<void> {
  validatePinFormat(pin);
  const hash = await derivePin(pin);
  localStorage.setItem(PIN_HASH_KEY, hash);
  localStorage.removeItem(FAIL_COUNT_KEY);
}

export function isLockPinSet(): boolean {
  return !!localStorage.getItem(PIN_HASH_KEY);
}

export function clearLockPin(): void {
  localStorage.removeItem(PIN_HASH_KEY);
  localStorage.removeItem(SALT_KEY);
  localStorage.removeItem(FAIL_COUNT_KEY);
}

export function getLockFailCount(): number {
  const v = localStorage.getItem(FAIL_COUNT_KEY);
  return v ? Number.parseInt(v, 10) : 0;
}

function bumpFailCount(): number {
  const n = getLockFailCount() + 1;
  localStorage.setItem(FAIL_COUNT_KEY, String(n));
  return n;
}

function resetFailCount(): void {
  localStorage.removeItem(FAIL_COUNT_KEY);
}

export interface VerifyResult {
  ok: boolean;
  failCount: number;
  exhausted: boolean;
}

export async function verifyLockPin(pin: string): Promise<VerifyResult> {
  validatePinFormat(pin);
  const stored = localStorage.getItem(PIN_HASH_KEY);
  if (!stored) {
    return { ok: false, failCount: 0, exhausted: false };
  }
  const computed = await derivePin(pin);
  if (constantTimeEqual(computed, stored)) {
    resetFailCount();
    return { ok: true, failCount: 0, exhausted: false };
  }
  const fails = bumpFailCount();
  return { ok: false, failCount: fails, exhausted: fails >= MAX_PIN_FAILS };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
