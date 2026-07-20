import { useCallback, useEffect, useState } from 'react';
import { getApiLayer } from '@/api';
import { useBusinessStore } from '@/stores/business.store';
import type { QRMerchant, QRPayment } from '@/api/repositories/qrpayment.repository';

export interface BusinessData {
  merchants: QRMerchant[];
  /** The merchant the app is currently acting as, or null in personal mode. */
  active: QRMerchant | null;
  /** Payments collected by the active merchant, newest first. */
  payments: QRPayment[];
  loading: boolean;
  error: string;
  reload: () => void;
}

/**
 * Loads the owner's merchants and, for the active one, its collected payments.
 * Shared by the business views so each screen doesn't re-implement the fetch.
 */
export function useBusinessData(): BusinessData {
  const activeMerchantId = useBusinessStore((s) => s.activeMerchantId);
  const [merchants, setMerchants] = useState<QRMerchant[]>([]);
  const [payments, setPayments] = useState<QRPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = getApiLayer().qrPayments;
      if (!api) {
        if (!cancelled) setLoading(false);
        return;
      }
      const mRes = await api.getMerchants();
      if (cancelled) return;
      const list = mRes.success && mRes.data ? mRes.data : [];
      setMerchants(list);
      if (!mRes.success) setError(mRes.error?.message || '');

      if (activeMerchantId) {
        // The MERCHANT-scoped feed: every sale of the shop, no matter which
        // team member generated the charge. The user-scoped history would
        // miss the sales a cashier collected.
        const pRes = await api.getMerchantPayments(activeMerchantId);
        if (cancelled) return;
        if (pRes.success && pRes.data) {
          setPayments([...pRes.data].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
        }
      } else {
        setPayments([]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeMerchantId, nonce]);

  const active = activeMerchantId
    ? merchants.find((m) => m.id === activeMerchantId) ?? null
    : null;

  return { merchants, active, payments, loading, error, reload };
}
