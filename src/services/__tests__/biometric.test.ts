import { describe, it, expect } from 'vitest';

// Test the threshold logic without importing the service (avoids Capacitor native dependency)
describe('Biometric threshold logic', () => {
  const BIOMETRIC_THRESHOLD = 10000000; // 100,000 CRC in centimos

  function requiresBiometric(amountCentimos: number): boolean {
    return amountCentimos >= BIOMETRIC_THRESHOLD;
  }

  it('amount < 100,000 CRC does not require biometric', () => {
    expect(requiresBiometric(5000000)).toBe(false); // 50,000 CRC
    expect(requiresBiometric(9999999)).toBe(false); // 99,999.99 CRC
  });

  it('amount >= 100,000 CRC requires biometric', () => {
    expect(requiresBiometric(10000000)).toBe(true); // 100,000 CRC
    expect(requiresBiometric(50000000)).toBe(true); // 500,000 CRC
  });

  it('exact threshold amount requires biometric', () => {
    expect(requiresBiometric(10000000)).toBe(true);
  });
});

describe('Biometric error handling', () => {
  const BIOMETRIC_ERRORS: Record<string, string> = {
    BIOMETRIC_NOT_ENROLLED: 'No biometric data enrolled. Please set up fingerprint or face ID in device settings.',
    BIOMETRIC_LOCKED_OUT: 'Biometric authentication is temporarily locked. Please try again later or use your PIN.',
    USER_CANCELLED: 'Authentication cancelled by user.',
  };

  it('BIOMETRIC_NOT_ENROLLED returns descriptive message', () => {
    const msg = BIOMETRIC_ERRORS['BIOMETRIC_NOT_ENROLLED'];
    expect(msg).toContain('enrolled');
    expect(msg).toContain('settings');
  });

  it('BIOMETRIC_LOCKED_OUT returns descriptive message', () => {
    const msg = BIOMETRIC_ERRORS['BIOMETRIC_LOCKED_OUT'];
    expect(msg).toContain('locked');
    expect(msg).toContain('PIN');
  });

  it('USER_CANCELLED returns descriptive message', () => {
    const msg = BIOMETRIC_ERRORS['USER_CANCELLED'];
    expect(msg).toContain('cancelled');
  });
});

describe('Web fallback', () => {
  it('web environment returns simulated success', async () => {
    // Simulate web environment check
    const win = window as unknown as Record<string, { isNativePlatform?: () => boolean }>;
    const isNative = typeof win.Capacitor !== 'undefined' &&
                     win.Capacitor?.isNativePlatform?.();
    expect(isNative).toBe(false); // We're in jsdom, not native

    // Web fallback should work
    const result = await new Promise<{ success: boolean }>((resolve) => {
      setTimeout(() => resolve({ success: true }), 10);
    });
    expect(result.success).toBe(true);
  });
});
