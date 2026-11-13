// Las hojas de la billetera propia: recibir, enviar, ver las 12 palabras y
// quitarla del telefono.
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { QrScannerPanel } from '@/components/QrScannerPanel';
import { rellenar } from '@/utils/planes';
import { localeDe } from '@/utils/periodos';
import { confirmarConHuella } from '@/billetera/boveda';
import { RechazoBitcoin, type BilleteraBitcoin, type EnvioBitcoinPreparado } from '@/billetera/bitcoin';
import {
  comisionLegible,
  destinoDeUnQrEvm,
  enlaceDeDireccion,
  enlaceDeTransaccion,
  enviarEvm,
  MONEDA_DE_LA_RED,
  NOMBRE_DE_LA_RED,
  prepararEnvioEvm,
  RechazoEvm,
  saldoLegible,
  type ActivoEvm,
  type EnvioEvmPreparado,
} from '@/billetera/evm';
import { direccionCorta, recortarDecimales } from '@/billetera/formato';
import { GrillaDePalabras } from './CrearBilletera';
import { palabrasDe } from '@/billetera/semilla';

export type ActivoDeLaBilletera =
  | { tipo: 'btc'; simbolo: 'BTC'; nombre: string; simboloDelCatalogo: 'BTC' }
  | { tipo: 'evm'; simbolo: ActivoEvm['simbolo']; nombre: string; simboloDelCatalogo: string; evm: ActivoEvm };

const BOTON_PRINCIPAL =
  'kp-toque kp-foco h-12 w-full rounded-[16px] bg-[var(--color-primary-fill)] px-6 font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50';
const BOTON_SECUNDARIO =
  'kp-toque kp-foco h-12 w-full rounded-[16px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-6 font-semibold uv-text-primary disabled:opacity-50';
const CAMPO =
  'kp-foco w-full rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-surface-1 px-3 py-3 uv-text-primary';
const ERROR = 'text-sm font-semibold text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]';

function BotonCopiar({ texto }: { texto: string }) {
  const { t } = useLanguage();
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className={BOTON_SECUNDARIO}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        } catch {
          setCopiado(false);
        }
      }}
    >
      <span className="inline-flex items-center gap-2">
        <Icons.Copy size={16} aria-hidden /> {copiado ? t('copied') : t('copy')}
      </span>
    </button>
  );
}

function CodigoParaRecibir({ valor }: { valor: string }) {
  return (
    <div className="space-y-3">
      <div className="mx-auto w-fit rounded-2xl bg-white p-3">
        <QRCodeSVG value={valor} size={208} />
      </div>
      <p className="break-all rounded-xl uv-surface-2 px-3 py-2 font-mono text-xs uv-text-primary">{valor}</p>
      <BotonCopiar texto={valor} />
    </div>
  );
}

// ---------------------------------------------------------------- Recibir

interface HojaRecibirProps {
  activo: ActivoDeLaBilletera | null;
  onClose: () => void;
  direccionEvm: string | null;
  btc: BilleteraBitcoin | null;
}

export function HojaRecibir({ activo, onClose, direccionEvm, btc }: HojaRecibirProps) {
  const { t } = useLanguage();
  const [via, setVia] = useState<'lightning' | 'red'>('lightning');
  const [sats, setSats] = useState('');
  const [factura, setFactura] = useState<string | null>(null);
  const [direccionBtc, setDireccionBtc] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setVia('lightning');
    setSats('');
    setFactura(null);
    setDireccionBtc(null);
    setError('');
  }, [activo]);

  useEffect(() => {
    if (activo?.tipo !== 'btc' || via !== 'red' || direccionBtc || !btc) return;
    let vigente = true;
    btc.direccionBitcoin()
      .then(d => { if (vigente) setDireccionBtc(d); })
      .catch(() => { if (vigente) setError(t('bp_err_red')); });
    return () => { vigente = false; };
  }, [activo, via, direccionBtc, btc, t]);

  const crearFactura = async () => {
    if (!btc) return;
    const n = sats.trim() ? Number(sats.trim()) : undefined;
    if (n !== undefined && (!Number.isInteger(n) || n <= 0)) {
      setError(t('bp_err_monto'));
      return;
    }
    setOcupado(true);
    setError('');
    try {
      setFactura(await btc.facturaLightning('KiramoPay', n));
    } catch {
      setError(t('bp_err_red'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <BottomSheet isOpen={activo !== null} onClose={onClose} title={activo ? `${t('receive')} ${activo.simbolo}` : ''}>
      {activo?.tipo === 'evm' && direccionEvm && (
        <div className="space-y-4">
          <p className="uv-chip-warning rounded-xl p-3 text-sm">{t('bp_evm_redes')}</p>
          <CodigoParaRecibir valor={direccionEvm} />
        </div>
      )}

      {activo?.tipo === 'btc' && (
        <div className="space-y-4">
          <div className="flex rounded-xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] p-1" role="tablist">
            {(['lightning', 'red'] as const).map(v => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={via === v}
                onClick={() => { setVia(v); setError(''); }}
                className={`flex-1 rounded-lg py-2 text-sm font-bold ${via === v ? 'uv-surface-1 uv-shadow-soft uv-text-primary' : 'uv-text-muted'}`}
              >
                {v === 'lightning' ? t('bp_btc_lightning') : t('bp_btc_red')}
              </button>
            ))}
          </div>

          {via === 'lightning' && (
            factura ? (
              <CodigoParaRecibir valor={factura} />
            ) : (
              <div className="space-y-3">
                <p className="text-sm uv-text-secondary">{t('bp_btc_lightning_ayuda')}</p>
                <label className="block space-y-1">
                  <span className="text-sm font-semibold uv-text-secondary">{t('bp_monto_sats_opcional')}</span>
                  <input className={CAMPO} inputMode="numeric" value={sats} onChange={e => { setError(''); setSats(e.target.value.replace(/[^0-9]/g, '')); }} />
                </label>
                <button type="button" className={BOTON_PRINCIPAL} disabled={ocupado || !btc} onClick={crearFactura}>
                  {t('bp_crear_factura')}
                </button>
              </div>
            )
          )}

          {via === 'red' && (
            <div className="space-y-3">
              <p className="text-sm uv-text-secondary">{t('bp_btc_red_ayuda')}</p>
              {direccionBtc ? <CodigoParaRecibir valor={direccionBtc} /> : !error && <p className="text-sm uv-text-muted">{t('loading')}</p>}
            </div>
          )}

          {error && <p role="alert" className={ERROR}>{error}</p>}
        </div>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- Enviar

interface HojaEnviarProps {
  activo: ActivoDeLaBilletera | null;
  onClose: () => void;
  semilla: string;
  btc: BilleteraBitcoin | null;
  /** Para refrescar los saldos despues de enviar. */
  onEnviado: () => void;
}

type Preparado = { en: number } & (
  | { tipo: 'evm'; envio: EnvioEvmPreparado }
  | { tipo: 'btc'; envio: EnvioBitcoinPreparado; destino: string }
);

/**
 * Cuanto vale lo revisado. Pasado ese tiempo la comision de la red pudo cambiar
 * (y la cotizacion de bitcoin por la red vence): se vuelve a calcular y la
 * persona confirma lo nuevo.
 */
const VIGENCIA_MS = 90_000;

/**
 * Un intento de pago: el mismo destino y el mismo monto. Si un intento falla
 * a medias (la red recibio el envio pero la respuesta no llego), repetirlo no
 * puede cobrar dos veces:
 * - bitcoin: la llave de idempotencia es la misma, y el SDK devuelve el pago
 *   que ya existe;
 * - redes EVM: el nonce es el mismo, y la red acepta una sola transaccion con
 *   ese numero.
 * Cambiar el destino o el monto es otro pago y empieza otro intento.
 */
interface Intento {
  llave: string;
  nonceIntentado?: number;
}
const nuevoIntento = (): Intento => ({ llave: crypto.randomUUID() });

export function HojaEnviar({ activo, onClose, semilla, btc, onEnviado }: HojaEnviarProps) {
  const { t, language } = useLanguage();
  const [destino, setDestino] = useState('');
  const [monto, setMonto] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [preparado, setPreparado] = useState<Preparado | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [hecho, setHecho] = useState<{ enlace?: string } | null>(null);
  // Se marca en el mismo toque, antes de cualquier espera: dos toques seguidos
  // en Confirmar no alcanzan a mandar dos veces.
  const enviando = useRef(false);
  const intento = useRef<Intento>(nuevoIntento());

  useEffect(() => {
    setDestino('');
    setMonto('');
    setEscaneando(false);
    setPreparado(null);
    setError('');
    setAviso('');
    setOcupado(false);
    setHecho(null);
    intento.current = nuevoIntento();
  }, [activo]);

  const cambiarDestino = (valor: string) => {
    setError('');
    setDestino(valor);
    intento.current = nuevoIntento();
  };
  const cambiarMonto = (valor: string) => {
    setError('');
    setMonto(valor);
    intento.current = nuevoIntento();
  };

  const mensajeEvm = (e: RechazoEvm, a: ActivoEvm) => {
    switch (e.motivo) {
      case 'direccion-invalida': return t('bp_err_direccion');
      case 'a-si-mismo': return t('bp_err_a_si_mismo');
      case 'monto-invalido': return t('bp_err_monto');
      case 'saldo-insuficiente': return t('bp_err_saldo');
      case 'sin-saldo-para-comision': return rellenar(t('bp_err_comision'), { moneda: MONEDA_DE_LA_RED[a.red] });
    }
  };

  const mensajeBtc = (e: RechazoBitcoin) => {
    switch (e.motivo) {
      case 'destino-desconocido': return t('bp_err_destino_btc');
      case 'monto-invalido': return t('bp_err_monto');
      case 'saldo-insuficiente': return t('bp_err_saldo');
      case 'fuera-de-rango':
        return rellenar(t('bp_err_rango'), { min: e.rango?.minimoSats ?? 0, max: e.rango?.maximoSats ?? 0 });
    }
  };

  /** Calcula el envio. Devuelve null y deja el mensaje si no se puede. */
  const preparar = async (): Promise<Preparado | null> => {
    if (!activo) return null;
    try {
      if (activo.tipo === 'evm') {
        const envio = await prepararEnvioEvm(semilla, activo.evm, destino, monto, { nonce: intento.current.nonceIntentado });
        return { tipo: 'evm', envio, en: Date.now() };
      }
      if (!btc) return null;
      const sats = monto.trim() ? Number(monto.trim()) : undefined;
      return { tipo: 'btc', envio: await btc.prepararEnvio(destino, sats), destino: destino.trim(), en: Date.now() };
    } catch (e) {
      if (e instanceof RechazoEvm && activo.tipo === 'evm') setError(mensajeEvm(e, activo.evm));
      else if (e instanceof RechazoBitcoin) setError(mensajeBtc(e));
      else setError(t('bp_err_red'));
      return null;
    }
  };

  const revisar = async () => {
    setOcupado(true);
    setError('');
    setAviso('');
    try {
      const listo = await preparar();
      if (listo) setPreparado(listo);
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async () => {
    if (!preparado || enviando.current) return;
    enviando.current = true;
    setOcupado(true);
    setError('');
    setAviso('');
    try {
      if (Date.now() - preparado.en > VIGENCIA_MS) {
        // No se firma lo que ya no es lo que se mostro: se recalcula y la
        // persona vuelve a confirmar.
        const nuevo = await preparar();
        setPreparado(nuevo);
        if (nuevo) setAviso(t('bp_cotizacion_vencida'));
        return;
      }
      if (!(await confirmarConHuella(t('bp_confirmar_razon')))) return;
      if (preparado.tipo === 'evm') {
        intento.current.nonceIntentado = preparado.envio.nonce;
        const hash = await enviarEvm(semilla, preparado.envio);
        setHecho({ enlace: enlaceDeTransaccion(preparado.envio.activo.red, hash) });
      } else if (btc) {
        await btc.enviar(preparado.envio, intento.current.llave);
        setHecho({});
      }
      onEnviado();
    } catch {
      setError(t('bp_err_envio'));
    } finally {
      enviando.current = false;
      setOcupado(false);
    }
  };

  /** La red por donde sale el envio, para que nadie mande por la red equivocada. */
  const redDelEnvio = (p: Preparado): string => {
    if (p.tipo === 'evm') return NOMBRE_DE_LA_RED[p.envio.activo.red];
    switch (p.envio.destino.tipo) {
      case 'direccion-bitcoin': return t('bp_btc_red');
      case 'direccion-spark': return 'Spark';
      default: return t('bp_btc_lightning');
    }
  };

  const esBtc = activo?.tipo === 'btc';

  return (
    <BottomSheet
      isOpen={activo !== null}
      onClose={onClose}
      dismissable={!ocupado}
      title={activo ? `${t('send')} ${activo.simbolo}` : ''}
    >
      {hecho ? (
        <div className="space-y-4 text-center">
          <Icons.CheckCircle size={48} className="mx-auto text-[var(--color-success)]" aria-hidden />
          <p className="text-lg font-bold uv-text-primary">{t('bp_enviado')}</p>
          <p className="text-sm uv-text-secondary">{t('bp_enviado_ayuda')}</p>
          {hecho.enlace && (
            <a className={`${BOTON_SECUNDARIO} inline-flex items-center justify-center`} href={hecho.enlace} target="_blank" rel="noopener noreferrer">
              {t('bp_ver_explorador')}
            </a>
          )}
          <button type="button" className={BOTON_PRINCIPAL} onClick={onClose}>{t('close')}</button>
        </div>
      ) : preparado ? (
        <div className="space-y-4">
          {aviso && <p role="status" className="uv-chip-warning rounded-xl p-3 text-sm">{aviso}</p>}
          <dl className="space-y-3 rounded-2xl uv-surface-2 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="uv-text-secondary">{t('bp_resumen_red')}</dt>
              <dd className="text-right font-semibold uv-text-primary">{redDelEnvio(preparado)}</dd>
            </div>
            {/* La direccion completa: es lo que la persona compara con la que le pasaron. */}
            <div className="space-y-1">
              <dt className="uv-text-secondary">{t('bp_resumen_para')}</dt>
              <dd className="break-all font-mono uv-text-primary">
                {preparado.tipo === 'evm'
                  ? preparado.envio.hacia
                  : preparado.envio.destino.tipo === 'factura' ? direccionCorta(preparado.destino, 12) : preparado.destino}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="uv-text-secondary">{t('bp_resumen_envias')}</dt>
              <dd className="text-right font-semibold tabular-nums uv-text-primary">
                {preparado.tipo === 'evm'
                  ? `${saldoLegible(preparado.envio.activo, preparado.envio.monto)} ${preparado.envio.activo.simbolo}`
                  : `${preparado.envio.montoSats.toLocaleString(localeDe(language))} sats`}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="uv-text-secondary">{preparado.tipo === 'evm' ? t('bp_resumen_comision_max') : t('bp_resumen_comision')}</dt>
              <dd className="text-right tabular-nums uv-text-primary">
                {preparado.tipo === 'evm'
                  ? `${recortarDecimales(comisionLegible(preparado.envio), 8)} ${MONEDA_DE_LA_RED[preparado.envio.activo.red]}`
                  : `${preparado.envio.comisionSats.toLocaleString(localeDe(language))} sats`}
              </dd>
            </div>
          </dl>
          {error && <p role="alert" className={ERROR}>{error}</p>}
          {error && preparado.tipo === 'evm' && (
            <a
              className="block text-center text-sm font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline"
              href={enlaceDeDireccion(preparado.envio.activo.red, preparado.envio.desde)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('bp_explorador_cuenta')}
            </a>
          )}
          <button type="button" className={BOTON_PRINCIPAL} disabled={ocupado} onClick={confirmar}>
            <span className="inline-flex items-center gap-2"><Icons.Fingerprint size={18} aria-hidden /> {t('bp_confirmar')}</span>
          </button>
          <button type="button" className={BOTON_SECUNDARIO} disabled={ocupado} onClick={() => { setPreparado(null); setError(''); setAviso(''); }}>
            {t('back')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-semibold uv-text-secondary">{t('bp_destino')}</span>
            <input
              className={`${CAMPO} font-mono text-sm`}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={destino}
              onChange={e => cambiarDestino(e.target.value)}
            />
            <span className="block text-xs uv-text-muted">{esBtc ? t('bp_destino_btc_ayuda') : t('bp_destino_evm_ayuda')}</span>
          </label>
          {escaneando ? (
            <QrScannerPanel
              active={escaneando}
              onDecode={crudo => {
                setEscaneando(false);
                if (activo?.tipo !== 'evm') {
                  cambiarDestino(crudo.trim());
                  return;
                }
                const direccion = destinoDeUnQrEvm(crudo, activo.evm);
                if (direccion) cambiarDestino(direccion);
                else setError(t('bp_err_qr'));
              }}
            />
          ) : (
            <button type="button" className={BOTON_SECUNDARIO} onClick={() => setEscaneando(true)}>
              <span className="inline-flex items-center gap-2"><Icons.QrCode size={16} aria-hidden /> {t('scan_qr')}</span>
            </button>
          )}
          <label className="block space-y-1">
            <span className="text-sm font-semibold uv-text-secondary">{esBtc ? t('bp_monto_sats') : `${t('bp_monto')} (${activo?.simbolo ?? ''})`}</span>
            <input
              className={`${CAMPO} tabular-nums`}
              inputMode={esBtc ? 'numeric' : 'decimal'}
              value={monto}
              onChange={e => cambiarMonto(esBtc ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
            />
          </label>
          {error && <p role="alert" className={ERROR}>{error}</p>}
          <button type="button" className={BOTON_PRINCIPAL} disabled={ocupado || !destino.trim() || (esBtc && !btc)} onClick={revisar}>
            {ocupado ? t('loading') : t('bp_revisar')}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- Palabras y quitar

export function HojaPalabras({ semilla, onClose }: { semilla: string | null; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <BottomSheet isOpen={semilla !== null} onClose={onClose} title={t('bp_palabras_titulo')}>
      {semilla && (
        <div className="space-y-4">
          <p className="uv-chip-warning flex gap-2 rounded-xl p-3 text-sm">
            <Icons.AlertTriangle size={18} className="shrink-0" aria-hidden />
            <span>{t('bp_palabras_aviso')}</span>
          </p>
          <GrillaDePalabras palabras={palabrasDe(semilla)} />
          <button type="button" className={BOTON_PRINCIPAL} onClick={onClose}>{t('close')}</button>
        </div>
      )}
    </BottomSheet>
  );
}

export function HojaQuitar({ abierta, onClose, onQuitar }: { abierta: boolean; onClose: () => void; onQuitar: () => Promise<void> }) {
  const { t } = useLanguage();
  const [ocupado, setOcupado] = useState(false);
  return (
    <BottomSheet isOpen={abierta} onClose={onClose} dismissable={!ocupado} title={t('bp_quitar')}>
      <div className="space-y-4">
        <p className="uv-chip-danger rounded-xl p-3 text-sm">{t('bp_quitar_aviso')}</p>
        <button
          type="button"
          className="kp-toque kp-foco h-12 w-full rounded-[16px] bg-[var(--color-danger-fill)] px-6 font-semibold text-white disabled:opacity-50"
          disabled={ocupado}
          onClick={async () => {
            setOcupado(true);
            try {
              await onQuitar();
            } finally {
              setOcupado(false);
            }
          }}
        >
          {t('bp_quitar_confirmar')}
        </button>
        <button type="button" className={BOTON_SECUNDARIO} disabled={ocupado} onClick={onClose}>{t('cancel')}</button>
      </div>
    </BottomSheet>
  );
}
