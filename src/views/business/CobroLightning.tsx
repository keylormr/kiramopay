import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { getApiLayer } from '@/api';
import type { FacturaLightning, QRCharge } from '@/api/repositories/qrpayment.repository';
import { formatMoney, MONEY_LOCALE, type CurrencyCode } from '@/utils/money';
import { rellenar } from '@/utils/planes';
import { mensajeDelRechazoDelCobro } from '@/utils/erroresQr';
import {
  CLAVES_DEL_RECHAZO_LIGHTNING,
  RECHAZOS_DEL_COBRO,
  relojDeCuentaRegresiva,
  segundosRestantes,
  textoDelQrLightning,
} from '@/utils/lightning';

export type MedioDeCobro = 'kiramopay' | 'lightning';

/**
 * El selector "KiramoPay | Lightning" de la hoja de cobro. Nunca dos QR juntos
 * en pantalla: la camara del cliente toma el primero que ve.
 */
export const SelectorDeMedio: React.FC<{ medio: MedioDeCobro; onCambio: (m: MedioDeCobro) => void }> = ({
  medio,
  onCambio,
}) => {
  const { t } = useLanguage();
  const opciones: { valor: MedioDeCobro; texto: string }[] = [
    { valor: 'kiramopay', texto: 'KiramoPay' },
    { valor: 'lightning', texto: 'Lightning' },
  ];
  return (
    <div
      role="group"
      aria-label={t('ln_medio_grupo')}
      className="grid w-full max-w-[280px] grid-cols-2 gap-1 rounded-xl bg-[var(--color-surface-2)] p-1 dark:bg-[var(--color-surface-2-dark)]"
    >
      {opciones.map((o) => {
        const activo = medio === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={activo}
            onClick={() => onCambio(o.valor)}
            className={`min-h-11 rounded-lg px-3 text-sm font-bold uv-focus-ring transition-colors motion-reduce:transition-none ${
              activo
                ? 'bg-[var(--color-surface-1)] uv-text-primary shadow-sm dark:bg-[var(--color-surface-1-dark)]'
                : 'uv-text-muted'
            }`}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
};

interface PanelProps {
  cobro: QRCharge;
  /** El servidor dijo que el cobro ya no esta pendiente: la hoja lo vuelve a leer. */
  onCobroDesactualizado: () => void;
}

// Una factura BOLT11 es larga (300 a 400 caracteres): el QR sale denso y se
// dibuja tan grande como entre, hasta 280 px, para que la camara lo lea desde
// la pantalla del mostrador.
const LADO_DEL_QR = 280;
const CAJA = 'flex aspect-square w-full items-center justify-center rounded-2xl border border-gray-200 bg-white p-3';

/**
 * La factura Lightning de un cobro. La pide al servidor, que cotiza en sats y
 * se la pide a la billetera propia del comercio; esta pantalla no calcula
 * ningun precio. Que se pago lo dice el cobro (la hoja lo consulta cada pocos
 * segundos), nunca esta pantalla.
 */
export const PanelLightning: React.FC<PanelProps> = ({ cobro, onCobroDesactualizado }) => {
  const { t } = useLanguage();
  const [factura, setFactura] = useState<FacturaLightning | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [ahora, setAhora] = useState(() => Date.now());
  const [copiada, setCopiada] = useState(false);
  // Solo cuenta la respuesta del ultimo pedido: una lenta de antes no pisa la nueva.
  const turno = useRef(0);
  const avisar = useRef(onCobroDesactualizado);
  useEffect(() => {
    avisar.current = onCobroDesactualizado;
  }, [onCobroDesactualizado]);
  // El idioma se lee al responder: cambiarlo no es motivo para pedir otra factura.
  const traducir = useRef(t);
  useEffect(() => {
    traducir.current = t;
  }, [t]);

  const pedir = useCallback(async () => {
    const api = getApiLayer().qrPayments;
    if (!api) return;
    const mio = ++turno.current;
    setCargando(true);
    setError('');
    setCopiada(false);
    let res: Awaited<ReturnType<typeof api.createChargeLightning>>;
    try {
      res = await api.createChargeLightning(cobro.id);
    } catch {
      res = { success: false, error: { code: 'NETWORK_ERROR', message: '' } };
    }
    if (mio !== turno.current) return;
    setCargando(false);
    setAhora(Date.now());
    if (res.success && res.data) {
      setFactura(res.data);
      return;
    }
    setFactura(null);
    const codigo = res.error?.code ?? '';
    const tr = traducir.current;
    setError(
      Object.prototype.hasOwnProperty.call(CLAVES_DEL_RECHAZO_LIGHTNING, codigo)
        ? tr(CLAVES_DEL_RECHAZO_LIGHTNING[codigo] as Parameters<typeof tr>[0])
        : mensajeDelRechazoDelCobro(tr, res.error, 'ln_err_generico'),
    );
    if (RECHAZOS_DEL_COBRO.has(codigo)) avisar.current();
  }, [cobro.id]);

  useEffect(() => {
    // Fuera del cuerpo del efecto: el primer render ya dice "cargando". Si el
    // panel se cierra antes, no se pide nada.
    let vivo = true;
    void Promise.resolve().then(() => (vivo ? pedir() : undefined));
    return () => {
      vivo = false;
      turno.current += 1;
    };
  }, [pedir]);

  const restante = factura ? segundosRestantes(factura.cotizacionVence, ahora) : 0;
  const vencida = !!factura && restante === 0;

  // La cuenta regresiva corre mientras la cotizacion vale; al llegar a cero se
  // detiene y la pantalla ofrece pedir otra.
  useEffect(() => {
    if (!factura || vencida) return;
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(reloj);
  }, [factura, vencida]);

  const copiar = async () => {
    if (!factura) return;
    try {
      await navigator.clipboard.writeText(factura.invoice);
      setCopiada(true);
    } catch {
      // Sin portapapeles queda el QR, que es lo que se usa en el mostrador.
    }
  };

  const dinero = (valor: number, moneda: string, decimales: number) =>
    formatMoney(valor, moneda as CurrencyCode, { decimals: decimales });

  const caja = (contenido: React.ReactNode) => (
    <div className={CAJA} style={{ maxWidth: LADO_DEL_QR + 24 }}>
      {contenido}
    </div>
  );

  if (cargando) {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        {caja(<div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent motion-reduce:animate-none" />)}
        <p role="status" className="text-xs uv-text-muted">{t('ln_cargando')}</p>
      </div>
    );
  }

  if (!factura) {
    return (
      <div className="flex w-full flex-col items-center gap-3">
        <p role="alert" className="max-w-[300px] text-center text-sm text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]">
          {error}
        </p>
        <Button variant="secondary" onClick={() => void pedir()} leftIcon={<Icons.RefreshCw size={16} aria-hidden="true" />}>
          {t('error_retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {vencida ? (
        caja(
          <div className="flex flex-col items-center gap-3 px-3 text-center">
            <Icons.Clock size={28} className="text-gray-400" aria-hidden="true" />
            <p role="status" className="text-sm font-semibold text-gray-700">{t('ln_cotizacion_vencida')}</p>
          </div>,
        )
      ) : (
        <div className={CAJA} style={{ maxWidth: LADO_DEL_QR + 24 }} data-testid="qr-lightning">
          <QRCodeSVG
            value={textoDelQrLightning(factura.invoice)}
            size={LADO_DEL_QR}
            style={{ width: '100%', height: 'auto' }}
            title={t('ln_medio_lightning_qr')}
          />
        </div>
      )}

      <p className="text-2xl font-black tracking-tight tabular-nums uv-text-primary">
        {new Intl.NumberFormat(MONEY_LOCALE).format(factura.sats)} sats
      </p>
      <p className="text-xs uv-text-muted tabular-nums">
        {dinero(factura.monto, factura.currency, 2)} ·{' '}
        {rellenar(t('ln_precio_btc'), { precio: dinero(Number(factura.precioBtc), factura.currency, 0) })}
      </p>

      {vencida ? (
        <Button onClick={() => void pedir()} leftIcon={<Icons.RefreshCw size={16} aria-hidden="true" />}>
          {t('ln_nueva_cotizacion')}
        </Button>
      ) : (
        <>
          <p className="text-xs font-semibold uv-text-secondary tabular-nums">
            {rellenar(t('ln_cotizacion_vence'), { tiempo: relojDeCuentaRegresiva(restante) })}
          </p>
          <button
            type="button"
            onClick={() => void copiar()}
            className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[var(--color-primary)] uv-focus-ring dark:text-[var(--color-primary-light)]"
          >
            {copiada ? <Icons.Check size={16} aria-hidden="true" /> : <Icons.Copy size={16} aria-hidden="true" />}
            <span aria-live="polite">{copiada ? t('ln_factura_copiada') : t('ln_copiar_factura')}</span>
          </button>
        </>
      )}
      <p className="max-w-[300px] text-center text-xs uv-text-muted">{t('ln_escanea')}</p>
    </div>
  );
};
