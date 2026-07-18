// Single source of truth for the USD <-> CRC exchange rate.
//
// Before this module the rate was hardcoded in three different places
// (account.http.ts = 520, cryptoPrices.ts / CryptoView.tsx = 515, the country
// mock = 526.5), so the "USD Total", the crypto conversions and the balance
// summary all disagreed. Everything now derives from the backend's public
// /api/v1/exchange-rates endpoint (via the country repository), with a cached
// value and a safe fallback for when the endpoint hasn't served a rate yet.

import { getApiLayer } from '@/api';

// Fallback used until the backend serves a rate (empty table / offline / mock
// without the pair). Matches the seed in migration 043_seed_exchange_rates.sql.
export const DEFAULT_USD_TO_CRC = 515;

const TTL_MS = 10 * 60 * 1000; // re-fetch at most every 10 minutes

let cachedRate = DEFAULT_USD_TO_CRC;
let cachedAt = 0;
let inFlight: Promise<number> | null = null;

interface RateLike {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
}

function extractUsdToCrc(rates: RateLike[]): number | null {
  const direct = rates.find((r) => r.fromCurrency === 'USD' && r.toCurrency === 'CRC');
  if (direct && direct.rate > 0) return direct.rate;
  const inverse = rates.find((r) => r.fromCurrency === 'CRC' && r.toCurrency === 'USD');
  if (inverse && inverse.rate > 0) return 1 / inverse.rate;
  return null;
}

/**
 * Resolve the current USD->CRC rate. Fetches from the backend (deduped +
 * cached with a TTL) and always resolves to a finite number — the last known
 * value or the fallback if the fetch fails or returns no CRC pair.
 */
export async function getUsdToCrcRate(force = false): Promise<number> {
  const fresh = Date.now() - cachedAt < TTL_MS;
  if (!force && fresh) return cachedRate;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await getApiLayer().country?.getExchangeRates();
      if (res?.success && Array.isArray(res.data)) {
        const rate = extractUsdToCrc(res.data);
        if (rate && Number.isFinite(rate)) {
          cachedRate = rate;
          cachedAt = Date.now();
        }
      }
    } catch {
      // keep last-known / fallback rate
    } finally {
      inFlight = null;
    }
    return cachedRate;
  })();

  return inFlight;
}

/** Last resolved USD->CRC rate (or fallback). Safe to call during render. */
export function getCachedUsdToCrcRate(): number {
  return cachedRate;
}

/** Convert a USD amount to CRC using the cached rate. */
export function usdToCrc(usd: number): number {
  return usd * cachedRate;
}

/** Convert a CRC amount to USD using the cached rate. */
export function crcToUsd(crc: number): number {
  return cachedRate > 0 ? crc / cachedRate : 0;
}
