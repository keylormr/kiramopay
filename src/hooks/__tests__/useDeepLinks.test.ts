import { describe, it, expect } from 'vitest';
import { parseDeepLink } from '../useDeepLinks';

describe('parseDeepLink', () => {
  it('parses kiramopay://pay?amount=5000', () => {
    const result = parseDeepLink('kiramopay://pay?amount=5000');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('sinpe');
    expect(result!.params.amount).toBe('5000');
  });

  it('parses kiramopay://transfer/123', () => {
    const result = parseDeepLink('kiramopay://transfer/123');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('sinpe');
    expect(result!.params.id).toBe('123');
  });

  it('returns null for invalid URL', () => {
    const result = parseDeepLink('not a url at all %%%');
    expect(result).toBeNull();
  });

  it('parses https://app.kiramopay.com/crypto', () => {
    const result = parseDeepLink('https://app.kiramopay.com/crypto');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('crypto');
  });

  it('returns null for unknown path', () => {
    const result = parseDeepLink('kiramopay://unknown-route');
    expect(result).toBeNull();
  });

  it('parses home path', () => {
    const result = parseDeepLink('kiramopay://home');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('home');
  });

  it('handles empty path as home', () => {
    const result = parseDeepLink('https://app.kiramopay.com/');
    expect(result).not.toBeNull();
    expect(result!.tab).toBe('home');
  });
});
