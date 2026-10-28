import { useEffect, useState } from 'react';
import { getUsdToCrcRate, getCachedUsdToCrcRate } from '@/services/fxRate';

/**
 * Returns the current USD->CRC rate for render-time use, or null while the
 * server has not given one (first load, offline, empty table). Starts from the
 * cached value and updates once the backend rate loads. Callers must treat null
 * as "unavailable" and not substitute a number.
 */
export function useUsdToCrcRate(): number | null {
  const [rate, setRate] = useState<number | null>(getCachedUsdToCrcRate());

  useEffect(() => {
    let active = true;
    getUsdToCrcRate().then((r) => {
      if (active) setRate(r);
    });
    return () => {
      active = false;
    };
  }, []);

  return rate;
}
