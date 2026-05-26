import { describe, it, expect, beforeEach } from 'vitest';
import {
  setLockPin,
  verifyLockPin,
  isLockPinSet,
  clearLockPin,
  getLockFailCount,
  MAX_PIN_FAILS,
} from '../lockKdf';

describe('lockKdf', () => {
  beforeEach(() => {
    clearLockPin();
  });

  it('returns false from isLockPinSet before any PIN is set', () => {
    expect(isLockPinSet()).toBe(false);
  });

  it('stores and verifies a 6-digit PIN', async () => {
    await setLockPin('123456');
    expect(isLockPinSet()).toBe(true);
    const r = await verifyLockPin('123456');
    expect(r.ok).toBe(true);
    expect(r.failCount).toBe(0);
  });

  it('rejects wrong PIN and increments fail counter', async () => {
    await setLockPin('111111');
    const r1 = await verifyLockPin('222222');
    expect(r1.ok).toBe(false);
    expect(r1.failCount).toBe(1);
    const r2 = await verifyLockPin('333333');
    expect(r2.ok).toBe(false);
    expect(r2.failCount).toBe(2);
  });

  it('marks exhausted after MAX_PIN_FAILS', async () => {
    await setLockPin('111111');
    let last;
    for (let i = 0; i < MAX_PIN_FAILS; i++) {
      last = await verifyLockPin('999999');
    }
    expect(last!.exhausted).toBe(true);
  });

  it('resets fail counter on successful verify', async () => {
    await setLockPin('111111');
    await verifyLockPin('999999');
    await verifyLockPin('999999');
    expect(getLockFailCount()).toBe(2);
    const ok = await verifyLockPin('111111');
    expect(ok.ok).toBe(true);
    expect(getLockFailCount()).toBe(0);
  });

  it('rejects malformed PINs', async () => {
    await expect(setLockPin('abc')).rejects.toThrow();
    await expect(setLockPin('1234567')).rejects.toThrow();
    await expect(setLockPin('123')).rejects.toThrow();
  });

  it('derives different hashes for different PINs', async () => {
    await setLockPin('111111');
    const hash1 = localStorage.getItem('kiramopay-lock-pin-hash');
    clearLockPin();
    await setLockPin('222222');
    const hash2 = localStorage.getItem('kiramopay-lock-pin-hash');
    expect(hash1).not.toBe(hash2);
  });

  it('uses different salt across installs (clearLockPin clears salt)', async () => {
    await setLockPin('111111');
    const salt1 = localStorage.getItem('kiramopay-lock-salt');
    clearLockPin();
    await setLockPin('111111');
    const salt2 = localStorage.getItem('kiramopay-lock-salt');
    expect(salt1).not.toBe(salt2);
  });
});
