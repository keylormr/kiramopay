import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getApiLayer } from '@/api';
import type { ApiResponse } from '@/api/types';
import { SIMBOLOS_DEL_CATALOGO } from '@/api/catalogoCripto';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '@/i18n/LanguageContext';
import { BottomSheet } from '@/components/BottomSheet';
import { CampoMonto } from '@/components/CampoMonto';
import { Icons } from '@/components/Icons';
import { fechaYHora } from '@/utils/fechaPlazo';
import type { CryptoAsset, NuevaAlertaDePrecio, PriceAlert } from '@/types';

// Alertas de precio: la persona elige un activo, un precio objetivo en dolares
// y si espera que suba o que baje hasta ahi. Un barrido del servidor las
// compara contra el precio que tiene al dia y, cuando se cumple, avisa UNA vez
// (en la app y por push si la persona lo activo). Esta pantalla solo crea,
// lista y quita: nunca decide que una alerta se cumplio.

/** Espejo de crypto.AlertasActivasMaximas en el backend. */
export const MAXIMO_DE_ALERTAS_ACTIVAS = 20;

type Direccion = NuevaAlertaDePrecio['condition'];

export interface AlertasDePrecio {
  alertas: PriceAlert[];
  /** Hubo al menos una lectura buena: solo entonces un conteo es un dato. */
  cargadas: boolean;
  cargando: boolean;
  errorDeCarga: boolean;
  recargar: () => void;
  crear: (nueva: NuevaAlertaDePrecio) => Promise<ApiResponse<PriceAlert>>;
  quitar: (id: string) => Promise<ApiResponse<void>>;
}

/**
 * La lista de alertas que confirmo el servidor. Crear y quitar esperan su
 * respuesta antes de tocar la lista, y el estado global solo copia el
 * resultado.
 */
export function useAlertasDePrecio(): AlertasDePrecio {
  const { dispatch } = useApp();
  // dispatch cambia de identidad con cada cambio del estado global: como
  // dependencia de un efecto, copiar la lista al estado lo volveria a disparar.
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  const [alertas, setAlertas] = useState<PriceAlert[]>([]);
  const [cargadas, setCargadas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [errorDeCarga, setErrorDeCarga] = useState(false);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let cancelada = false;
    const cargar = async () => {
      setCargando(true);
      try {
        const res = await getApiLayer().crypto.getPriceAlerts();
        if (cancelada) return;
        if (res.success && res.data) {
          setAlertas(res.data);
          setCargadas(true);
          setErrorDeCarga(false);
        } else {
          setErrorDeCarga(true);
        }
      } catch {
        if (!cancelada) setErrorDeCarga(true);
      } finally {
        if (!cancelada) setCargando(false);
      }
    };
    cargar();
    return () => {
      cancelada = true;
    };
  }, [vuelta]);

  useEffect(() => {
    if (cargadas) dispatchRef.current({ type: 'SET_PRICE_ALERTS', payload: alertas });
  }, [alertas, cargadas]);

  const recargar = useCallback(() => setVuelta((v) => v + 1), []);

  const crear = useCallback(async (nueva: NuevaAlertaDePrecio) => {
    const res = await getApiLayer().crypto.addPriceAlert(nueva);
    if (res.success && res.data) {
      const creada = res.data;
      setAlertas((previas) => [creada, ...previas.filter((a) => a.id !== creada.id)]);
    }
    return res;
  }, []);

  const quitar = useCallback(async (id: string) => {
    const res = await getApiLayer().crypto.removePriceAlert(id);
    if (res.success) setAlertas((previas) => previas.filter((a) => a.id !== id));
    return res;
  }, []);

  return { alertas, cargadas, cargando, errorDeCarga, recargar, crear, quitar };
}

// ── Formato ─────────────────────────────────────────────────────────────────

/**
 * Un precio en dolares con los decimales que le sirven al activo: dos para
 * BTC, mas para los que valen centavos (ADA a 0,35 con dos decimales no dice
 * nada). Miles con coma, como el resto de la app (utils/money.ts).
 */
export function formatoPrecio(valor: number): string {
  const abs = Math.abs(valor);
  const maximo = abs > 0 && abs < 1 ? 6 : abs < 10 ? 4 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: maximo,
  }).format(valor);
}

function formatoPorcentaje(fraccion: number): string {
  return `${(Math.abs(fraccion) * 100).toFixed(1)}%`;
}

/** Decimales que acepta el campo segun el precio del activo. */
function decimalesPara(precio: number | null): number {
  if (precio === null) return 6;
  return precio < 1 ? 6 : precio < 10 ? 4 : 2;
}

/** El objetivo que se cumpliria con el precio de ahora, si se conoce. */
export function yaSeCumple(direccion: Direccion, objetivo: number, precio: number | null): boolean {
  if (precio === null || !(objetivo > 0)) return false;
  return direccion === 'above' ? precio >= objetivo : precio <= objetivo;
}

type T = (clave: string) => string;

function rellenar(texto: string, valores: Record<string, string | number>): string {
  return Object.entries(valores).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), texto);
}

function mensajeDeCreacion(res: ApiResponse<PriceAlert>, t: T): string {
  switch (res.error?.code) {
    case 'ALERT_LIMIT_REACHED': {
      const limite = Number(res.error.details?.limite) || MAXIMO_DE_ALERTAS_ACTIVAS;
      return rellenar(t('crypto_alert_err_limit'), { n: limite });
    }
    case 'ALERT_ALREADY_MET':
      return t('crypto_alert_err_already_met');
    case 'ALERT_PRICE_OUT_OF_RANGE':
      return t('crypto_alert_err_out_of_range');
    case 'ALERT_UNSUPPORTED_ASSET':
      return t('crypto_alert_err_unsupported');
    // Los codigos genericos del modulo traen el texto de diagnostico del
    // servidor, en ingles: la pantalla pone el suyo.
    case undefined:
    case 'ALERT_FAILED':
    case 'ALERT_INVALID_DIRECTION':
    case 'INVALID_BODY':
      return t('crypto_alert_err_create');
    default:
      // RATE_LIMITED, NETWORK_ERROR, SESSION_EXPIRED...: el cliente HTTP ya
      // los tradujo al idioma activo.
      return res.error?.message || t('crypto_alert_err_create');
  }
}

function mensajeDeBaja(res: ApiResponse<void>, t: T): string {
  const codigo = res.error?.code;
  if (!codigo || codigo === 'REMOVE_FAILED') return t('crypto_alert_err_remove');
  return res.error?.message || t('crypto_alert_err_remove');
}

// ── Hoja ────────────────────────────────────────────────────────────────────

interface HojaAlertasProps {
  isOpen: boolean;
  onClose: () => void;
  alertas: AlertasDePrecio;
  /** El catalogo de la vista, con los precios que ya tiene. */
  activos: CryptoAsset[];
  /** Con un activo, la hoja abre directo en "Nueva alerta" para ese activo. */
  activoInicial?: string | null;
}

const PASOS_RAPIDOS = [-10, -5, 5, 10];

export function HojaAlertasDePrecio({ isOpen, onClose, alertas, activos, activoInicial }: HojaAlertasProps) {
  const { t, language } = useLanguage();
  const idActivo = useId();
  const idObjetivo = useId();
  const idDireccion = useId();

  // Solo los activos que el servidor cotiza admiten alertas, una vez cada uno.
  const conAlertas = activos.filter(
    (a, i) => SIMBOLOS_DEL_CATALOGO.includes(a.symbol) && activos.findIndex((b) => b.symbol === a.symbol) === i,
  );
  const activas = alertas.alertas.filter((a) => a.status === 'active');
  const cumplidas = alertas.alertas.filter((a) => a.status === 'triggered');
  const lleno = alertas.cargadas && activas.length >= MAXIMO_DE_ALERTAS_ACTIVAS;

  const [vista, setVista] = useState<'lista' | 'nueva'>(activoInicial ? 'nueva' : 'lista');
  const [simbolo, setSimbolo] = useState(activoInicial || conAlertas[0]?.symbol || '');
  const [direccion, setDireccion] = useState<Direccion>('above');
  const [objetivo, setObjetivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [listo, setListo] = useState('');
  const [quitando, setQuitando] = useState<string | null>(null);
  const [errorDeBaja, setErrorDeBaja] = useState('');

  // Cada apertura arranca limpia, en la vista que corresponde a por donde se
  // entro. Se ajusta durante el render (y no en un efecto) para que el primer
  // cuadro ya muestre la vista correcta.
  const [abiertaAntes, setAbiertaAntes] = useState(isOpen);
  if (isOpen !== abiertaAntes) {
    setAbiertaAntes(isOpen);
    if (isOpen) {
      setVista(activoInicial ? 'nueva' : 'lista');
      setSimbolo(activoInicial || conAlertas[0]?.symbol || '');
      setDireccion('above');
      setObjetivo('');
      setError('');
      setListo('');
      setErrorDeBaja('');
    }
  }

  // Si el simbolo guardado no esta entre las opciones (la hoja se abrio antes de
  // que llegara el catalogo), rige la primera opcion: es la que el selector
  // muestra, y un estado distinto dejaba "Crear alerta" sin responder.
  const activo = conAlertas.find((a) => a.symbol === simbolo) ?? conAlertas[0] ?? null;
  const precio = activo && activo.currentPrice > 0 ? activo.currentPrice : null;
  const objetivoNum = parseFloat(objetivo);
  const objetivoValido = Number.isFinite(objetivoNum) && objetivoNum > 0;
  const cumpleYa = objetivoValido && yaSeCumple(direccion, objetivoNum, precio);
  const puedeCrear = !!activo && objetivoValido && !cumpleYa && !lleno && !enviando;

  const nombreDe = (sim: string) => activos.find((a) => a.symbol === sim) ?? null;

  const elegirPaso = (paso: number) => {
    if (precio === null) return;
    const valor = precio * (1 + paso / 100);
    const decimales = decimalesPara(precio);
    setObjetivo(valor.toFixed(decimales).replace(/\.?0+$/, ''));
    setDireccion(paso > 0 ? 'above' : 'below');
    setError('');
  };

  const crear = async () => {
    if (!activo || !puedeCrear) return;
    setEnviando(true);
    setError('');
    const res = await alertas.crear({ asset: activo.symbol, targetPrice: objetivoNum, condition: direccion });
    setEnviando(false);
    if (!res.success || !res.data) {
      setError(mensajeDeCreacion(res, t));
      // El tope lo decide el servidor con SUS numeros: si rechazo por tope, la
      // lista de esta pantalla estaba desactualizada (otra sesion, otro
      // telefono). Se relee para que el conteo diga la verdad.
      if (res.error?.code === 'ALERT_LIMIT_REACHED') alertas.recargar();
      return;
    }
    setListo(rellenar(t('crypto_alert_created'), { asset: res.data.asset, price: formatoPrecio(res.data.targetPrice) }));
    setObjetivo('');
    setVista('lista');
  };

  const quitar = async (alerta: PriceAlert) => {
    if (quitando) return;
    setQuitando(alerta.id);
    setErrorDeBaja('');
    const res = await alertas.quitar(alerta.id);
    setQuitando(null);
    if (!res.success) setErrorDeBaja(mensajeDeBaja(res, t));
  };

  const abrirNueva = () => {
    setListo('');
    setError('');
    setVista('nueva');
  };

  const fila = (alerta: PriceAlert) => {
    const datos = nombreDe(alerta.asset);
    const cumplida = alerta.status === 'triggered';
    const actual = datos && datos.currentPrice > 0 ? datos.currentPrice : null;
    const objetivoTxt = formatoPrecio(alerta.targetPrice);
    const titulo = cumplida
      ? rellenar(t(alerta.condition === 'above' ? 'crypto_alert_row_reached_above' : 'crypto_alert_row_reached_below'), { price: objetivoTxt })
      : rellenar(t(alerta.condition === 'above' ? 'crypto_alert_row_above' : 'crypto_alert_row_below'), { price: objetivoTxt });

    let detalle = '';
    if (cumplida) {
      detalle = rellenar(t('crypto_alert_row_triggered'), {
        date: fechaYHora(alerta.triggeredAt, language),
        price: alerta.triggeredPrice !== undefined ? formatoPrecio(alerta.triggeredPrice) : '—',
      });
    } else if (actual !== null) {
      const fraccion = (alerta.targetPrice - actual) / actual;
      detalle = rellenar(t(fraccion >= 0 ? 'crypto_alert_diff_above' : 'crypto_alert_diff_below'), {
        pct: formatoPorcentaje(fraccion),
      });
    } else if (alerta.createdAt) {
      detalle = rellenar(t('crypto_alert_row_created'), { date: fechaYHora(alerta.createdAt, language) });
    }

    const Flecha = alerta.condition === 'above' ? Icons.TrendingUp : Icons.TrendingDown;
    return (
      <li key={alerta.id} className="flex items-center gap-3 py-3 pl-4 pr-2">
        {cumplida ? (
          <div className="w-10 h-10 rounded-full uv-chip-success flex items-center justify-center shrink-0" aria-hidden="true">
            <Icons.BellRing size={18} />
          </div>
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0"
            style={{ backgroundColor: datos?.color || 'var(--color-primary)' }}
            aria-hidden="true"
          >
            {datos?.icon || alerta.asset.slice(0, 1)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          {/* Sin truncar: el precio objetivo y el de cumplimiento son el dato
              de la fila, y a 390 px quedaban cortados. */}
          <p className="text-sm font-bold uv-text-primary leading-snug break-words">
            {alerta.asset} <span className="uv-text-muted font-normal">·</span> <span className="tabular-nums">{titulo}</span>
          </p>
          {detalle && (
            <p className="text-xs uv-text-muted mt-0.5 flex items-start gap-1 min-w-0 leading-snug">
              {!cumplida && (
                <Flecha
                  size={12}
                  aria-hidden="true"
                  className={`shrink-0 mt-px ${alerta.condition === 'above' ? 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]' : 'text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]'}`}
                />
              )}
              <span className="break-words tabular-nums">{detalle}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => quitar(alerta)}
          disabled={quitando !== null}
          aria-label={rellenar(t('crypto_alert_remove_aria'), { asset: alerta.asset, price: objetivoTxt })}
          className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 uv-text-muted hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-40 transition-colors uv-focus-ring"
        >
          {quitando === alerta.id ? <Icons.RefreshCw size={16} className="animate-spin motion-reduce:animate-none" /> : <Icons.Trash size={18} />}
        </button>
      </li>
    );
  };

  const esqueleto = (
    <ul aria-hidden="true" className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
      {[0, 1].map((i) => (
        <li key={i} className="flex items-center gap-3 p-4 animate-pulse motion-reduce:animate-none">
          <div className="w-10 h-10 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/5 rounded bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
            <div className="h-2.5 w-2/5 rounded bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
          </div>
        </li>
      ))}
    </ul>
  );

  const errorCarga = alertas.errorDeCarga && (
    <div role="alert" className="uv-chip-danger rounded-xl px-4 py-3 flex items-center gap-3">
      <Icons.AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
      <p className="text-sm font-medium flex-1">{t('crypto_alerts_load_error')}</p>
      <button type="button" onClick={alertas.recargar} className="text-sm font-bold underline underline-offset-2 shrink-0">
        {t('error_retry')}
      </button>
    </div>
  );

  const vistaLista = (
    <div className="space-y-5">
      {listo && (
        <p role="status" className="uv-chip-success rounded-xl px-4 py-3 text-sm font-medium flex items-start gap-2">
          <Icons.CheckCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>{listo}</span>
        </p>
      )}

      {errorCarga}

      <button
        type="button"
        onClick={abrirNueva}
        disabled={lleno || conAlertas.length === 0}
        className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors uv-focus-ring"
      >
        <Icons.Plus size={18} aria-hidden="true" /> {t('crypto_alert_new')}
      </button>
      {lleno && (
        <p className="text-sm uv-text-secondary text-center -mt-2">
          {rellenar(t('crypto_alert_err_limit'), { n: MAXIMO_DE_ALERTAS_ACTIVAS })}
        </p>
      )}

      <section aria-labelledby={`${idActivo}-activas`} className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 id={`${idActivo}-activas`} className="text-base font-bold uv-text-primary">
            {t('crypto_alerts_active')}
          </h3>
          {alertas.cargadas && (
            <span className="uv-chip-info text-xs font-bold px-2.5 py-1 rounded-full tabular-nums">
              {rellenar(t('crypto_alerts_count'), { n: activas.length, max: MAXIMO_DE_ALERTAS_ACTIVAS })}
            </span>
          )}
        </div>
        {errorDeBaja && (
          <p role="alert" className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
            {errorDeBaja}
          </p>
        )}
        {!alertas.cargadas ? (
          alertas.cargando ? esqueleto : null
        ) : activas.length === 0 ? (
          <div className="uv-surface-2 rounded-2xl px-5 py-6 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center mx-auto mb-3">
              <Icons.Bell size={22} aria-hidden="true" />
            </div>
            <p className="font-bold uv-text-primary">{t('crypto_alerts_empty_title')}</p>
            <p className="text-sm uv-text-secondary mt-1 max-w-[18rem] mx-auto">{t('crypto_alerts_empty')}</p>
          </div>
        ) : (
          <ul className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
            {activas.map(fila)}
          </ul>
        )}
      </section>

      {cumplidas.length > 0 && (
        <section aria-labelledby={`${idActivo}-cumplidas`} className="space-y-2">
          <h3 id={`${idActivo}-cumplidas`} className="text-base font-bold uv-text-primary">
            {t('crypto_alerts_triggered')}
          </h3>
          <ul className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
            {cumplidas.map(fila)}
          </ul>
        </section>
      )}

      <div className="flex gap-2 text-xs uv-text-muted leading-relaxed">
        <Icons.Info size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
        <p>
          {t('crypto_alerts_how')} {t('crypto_alerts_how_price')}
        </p>
      </div>
    </div>
  );

  const fraccionObjetivo = objetivoValido && precio !== null ? (objetivoNum - precio) / precio : null;

  const vistaNueva = (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => setVista('lista')}
        className="flex items-center gap-1 text-sm font-bold text-[var(--color-primary)] -mt-1 min-h-11 uv-focus-ring rounded-lg"
      >
        <Icons.ChevronLeft size={16} aria-hidden="true" />
        {t('crypto_alerts_see_all')}
        {alertas.cargadas && activas.length > 0 && (
          <>
            {' '}
            <span className="tabular-nums">({activas.length})</span>
          </>
        )}
      </button>

      <div className="uv-surface-2 rounded-xl p-4">
        <label htmlFor={idActivo} className="text-xs uv-text-muted font-bold">
          {t('crypto_alert_asset')}
        </label>
        <select
          id={idActivo}
          className="w-full bg-transparent text-lg font-bold uv-text-primary mt-2 outline-none"
          value={activo?.symbol ?? ''}
          onChange={(e) => {
            setSimbolo(e.target.value);
            setObjetivo('');
            setError('');
          }}
        >
          {conAlertas.map((a) => (
            <option key={a.symbol} value={a.symbol}>
              {a.name} ({a.symbol}){a.currentPrice > 0 ? ` - ${formatoPrecio(a.currentPrice)}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p id={idDireccion} className="text-xs uv-text-muted font-bold mb-2">
          {t('crypto_alert_when')}
        </p>
        <div role="group" aria-labelledby={idDireccion} className="flex bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl p-1">
          {(['above', 'below'] as const).map((d) => {
            const Flecha = d === 'above' ? Icons.TrendingUp : Icons.TrendingDown;
            const elegida = direccion === d;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={elegida}
                onClick={() => {
                  setDireccion(d);
                  setError('');
                }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 transition-all uv-focus-ring ${elegida ? 'uv-surface-1 uv-shadow-soft uv-text-primary' : 'uv-text-muted hover:uv-text-secondary'}`}
              >
                <Flecha
                  size={16}
                  aria-hidden="true"
                  className={elegida ? (d === 'above' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]') : ''}
                />
                {t(d === 'above' ? 'crypto_alert_above' : 'crypto_alert_below')}
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-center">
        <label htmlFor={idObjetivo} className="text-sm uv-text-muted">
          {t('crypto_alert_target')}
        </label>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="text-4xl font-bold uv-text-primary" aria-hidden="true">
            $
          </span>
          <CampoMonto
            id={idObjetivo}
            value={objetivo}
            onChange={(v) => {
              setObjetivo(v);
              setError('');
            }}
            decimals={decimalesPara(precio)}
            placeholder="0.00"
            autoWidth
            className="text-5xl font-bold bg-transparent max-w-full text-center outline-none uv-text-primary tabular-nums"
          />
        </div>
        <p className="text-sm uv-text-secondary mt-2 tabular-nums">
          {activo && precio !== null
            ? rellenar(t('crypto_alert_now'), { asset: activo.symbol, price: formatoPrecio(precio) })
            : activo
              ? rellenar(t('crypto_alert_now_unavailable'), { asset: activo.symbol })
              : null}
        </p>
        {fraccionObjetivo !== null && !cumpleYa && (
          <p
            className={`inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-full text-xs font-bold tabular-nums ${fraccionObjetivo >= 0 ? 'uv-chip-success' : 'uv-chip-danger'}`}
          >
            {rellenar(t(fraccionObjetivo >= 0 ? 'crypto_alert_diff_above' : 'crypto_alert_diff_below'), {
              pct: formatoPorcentaje(fraccionObjetivo),
            })}
          </p>
        )}
      </div>

      {precio !== null && (
        <div className="flex gap-2">
          {PASOS_RAPIDOS.map((paso) => (
            <button
              key={paso}
              type="button"
              onClick={() => elegirPaso(paso)}
              className="flex-1 py-2 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-lg text-sm font-bold uv-text-secondary tabular-nums uv-focus-ring"
            >
              {paso > 0 ? `+${paso}%` : `${paso}%`}
            </button>
          ))}
        </div>
      )}

      {cumpleYa && activo && (
        <div role="status" className="uv-chip-warning rounded-xl px-4 py-3 text-sm">
          <p className="font-medium">
            {rellenar(t(direccion === 'above' ? 'crypto_alert_met_above' : 'crypto_alert_met_below'), { asset: activo.symbol })}
          </p>
          <button
            type="button"
            onClick={() => setDireccion(direccion === 'above' ? 'below' : 'above')}
            className="mt-1.5 font-bold underline underline-offset-2"
          >
            {t(direccion === 'above' ? 'crypto_alert_use_below' : 'crypto_alert_use_above')}
          </button>
        </div>
      )}

      {/* Con un rechazo en pantalla, el rechazo ya lo explica: no se repite. */}
      {lleno && !error && (
        <p className="text-sm text-center uv-text-secondary">
          {rellenar(t('crypto_alert_err_limit'), { n: MAXIMO_DE_ALERTAS_ACTIVAS })}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-center text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={crear}
        disabled={!puedeCrear}
        className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors uv-focus-ring"
      >
        {enviando ? (
          t('processing')
        ) : (
          <>
            <Icons.Bell size={18} aria-hidden="true" /> {t('crypto_alert_create')}
          </>
        )}
      </button>
    </div>
  );

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={vista === 'nueva' ? t('crypto_alert_new') : t('crypto_alerts_title')}>
      {vista === 'nueva' ? vistaNueva : vistaLista}
    </BottomSheet>
  );
}
