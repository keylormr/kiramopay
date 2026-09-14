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
  /**
   * La lista de cobros no se pudo traer. Distinto de "no hay cobros": una
   * pantalla que muestre 0 vendido sin saber esto le esta diciendo al duenno
   * que hoy no vendio nada.
   */
  paymentsFailed: boolean;
  /**
   * La lista de comercios no se pudo traer (red, limite de tasa, 5xx). Distinto
   * de "no tenes ese comercio": sin esta distincion, un solo fallo de
   * GET /qr/merchants justo al recargar o al cambiar de perfil vaciaba la lista,
   * y App "autocuraba" el perfil persistido sacando al cajero del modo negocio
   * sin decir nada.
   */
  merchantsFailed: boolean;
  /** Hay un reintento automatico programado tras ese fallo. */
  retrying: boolean;
  reload: () => void;
}

// Reintentos automaticos tras un fallo de la lista de comercios, con espera
// creciente (3s, 6s, 12s, 24s). Pasado el ultimo, queda el boton de reintentar:
// insistir sin tope contra un servidor que responde 429 solo alarga el bloqueo.
const REINTENTOS_MAX = 4;
const ESPERA_BASE_MS = 3000;

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
  const [paymentsFailed, setPaymentsFailed] = useState(false);
  const [merchantsFailed, setMerchantsFailed] = useState(false);
  const [reintentos, setReintentos] = useState(0);
  const [nonce, setNonce] = useState(0);

  // Un reintento pedido por la persona vuelve a habilitar los automaticos.
  const reload = useCallback(() => {
    setReintentos(0);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = getApiLayer().qrPayments;
      if (!api) {
        if (!cancelled) setLoading(false);
        return;
      }
      // Un reintento que sale bien tiene que borrar el error anterior; si no,
      // la pantalla se queda con el aviso viejo para siempre.
      setError('');
      const mRes = await api.getMerchants();
      if (cancelled) return;
      if (mRes.success) {
        setMerchants(mRes.data ?? []);
        setMerchantsFailed(false);
        setReintentos(0);
      } else {
        // Se CONSERVA la lista anterior: que la consulta falle no dice que el
        // comercio haya dejado de existir.
        setMerchantsFailed(true);
        setError(mRes.error?.message || 'MERCHANTS_FETCH_FAILED');
      }

      if (activeMerchantId) {
        // The MERCHANT-scoped feed: every sale of the shop, no matter which
        // team member generated the charge. The user-scoped history would
        // miss the sales a cashier collected.
        const pRes = await api.getMerchantPayments(activeMerchantId);
        if (cancelled) return;
        if (pRes.success && pRes.data) {
          setPayments([...pRes.data].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
          setPaymentsFailed(false);
        } else {
          // Antes esto se tragaba entero: la lista quedaba vacia (o con lo de
          // la carga anterior) y la pantalla de negocio pintaba las ventas en
          // cero como si fuera un hecho.
          setPayments([]);
          setPaymentsFailed(true);
        }
      } else {
        setPayments([]);
        setPaymentsFailed(false);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeMerchantId, nonce]);

  // Reintento automatico: solo en modo negocio, que es donde la lista decide
  // que se pinta.
  const retrying = merchantsFailed && activeMerchantId !== null && reintentos < REINTENTOS_MAX;
  useEffect(() => {
    if (!retrying) return;
    const temporizador = setTimeout(() => {
      setReintentos((r) => r + 1);
      setNonce((n) => n + 1);
    }, ESPERA_BASE_MS * 2 ** reintentos);
    return () => clearTimeout(temporizador);
  }, [retrying, reintentos]);

  const active = activeMerchantId
    ? merchants.find((m) => m.id === activeMerchantId) ?? null
    : null;

  return { merchants, active, payments, loading, error, paymentsFailed, merchantsFailed, retrying, reload };
}
