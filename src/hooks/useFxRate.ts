import { useEffect, useState } from 'react';
import { getUsdToCrcRate, getCachedUsdToCrcRate } from '@/services/fxRate';

/**
 * Returns the current USD->CRC rate for render-time use. Starts from the cached
 * value (fallback on first ever call) and updates once the backend rate loads.
 */
export function useUsdToCrcRate(): number {
  const [rate, setRate] = useState<number>(getCachedUsdToCrcRate());

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
