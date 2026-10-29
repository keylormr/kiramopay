// Single source of truth for the USD <-> CRC exchange rate.
//
// Before this module the rate was hardcoded in three different places
// (account.http.ts = 520, cryptoPrices.ts / CryptoView.tsx = 515, the country
// mock = 526.5), so the "USD Total", the crypto conversions and the balance
// summary all disagreed. Everything now derives from the backend's public
// /api/v1/exchange-rates endpoint (via the country repository), with a cached
// value.
//
// THERE IS NO FALLBACK NUMBER. The rate comes from the Banco Central de Costa
// Rica through the server and from nowhere else. When the server has not served
// one (empty table / offline / error) there is no rate, and every caller gets
// `null` and must say the figure is unavailable instead of painting one. A
// constant 515 used to stand in here: it was the seed of migration 043, nobody
// had confirmed it, and it put a total on Home, Profile and crypto built on a
// rate nobody gave.

import { getApiLayer } from '@/api';

const TTL_MS = 10 * 60 * 1000; // re-fetch at most every 10 minutes

// The last rate the SERVER served, or null if it never has.
let cachedRate: number | null = null;
let cachedAt = 0;
let inFlight: Promise<number | null> | null = null;

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
 * cached with a TTL) and resolves to the rate the server gave, or `null` when
 * there is none: the fetch failed, or it returned no CRC pair and no earlier
 * call got one. Never a made-up number. A missing rate is not cached, so the
 * next call asks again; a rate the server did give is kept if a later fetch
 * fails.
 */
export async function getUsdToCrcRate(force = false): Promise<number | null> {
  const fresh = cachedRate !== null && Date.now() - cachedAt < TTL_MS;
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
      // keep the last rate the server gave, if any
    } finally {
      inFlight = null;
    }
    return cachedRate;
  })();

  return inFlight;
}

/** Last USD->CRC rate the server gave, or null. Safe to call during render. */
export function getCachedUsdToCrcRate(): number | null {
  return cachedRate;
}

/** Convert a USD amount to CRC using the cached rate; null without a rate. */
export function usdToCrc(usd: number): number | null {
  return cachedRate !== null ? usd * cachedRate : null;
}

/** Convert a CRC amount to USD using the cached rate; null without a rate. */
export function crcToUsd(crc: number): number | null {
  return cachedRate !== null && cachedRate > 0 ? crc / cachedRate : null;
}
