// Las hojas de la boveda de herencia: crearla, compartir la llave de heredero,
// el kit del heredero, llenarla, renovarla o sacarla al saldo, y quitarla.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { QrScannerPanel } from '@/components/QrScannerPanel';
import { entregarArchivo } from '@/utils/entregarArchivo';
import { localeDe } from '@/utils/periodos';
import { rellenar } from '@/utils/planes';
import { confirmarConHuella } from '@/billetera/boveda';
import { RechazoBitcoin, type BilleteraBitcoin, type EnvioBitcoinPreparado } from '@/billetera/bitcoin';
import { direccionCorta, satsABtc } from '@/billetera/formato';
import { anotarMovimiento, borrarBovedaGuardada, guardarBoveda, leerBovedaGuardada, type BovedaGuardada } from '@/billetera/herencia/almacen';
import { direccionDeLaBoveda } from '@/billetera/herencia/direcciones';
import { TransaccionRechazada, type FuenteDeLaRed } from '@/billetera/herencia/esplora';
import { diasAproximados, type EstadoDeLaBoveda } from '@/billetera/herencia/estado';
import { contenidoDelKit, nombreDelKit, textoDelKit } from '@/billetera/herencia/kit';
import { leerLlave, LlaveInvalida, mismaLlave, textoDeLaLlave, type LlaveConOrigen } from '@/billetera/herencia/llaves';
import {
  anotarLlenado,
  cabeEnLaBoveda,
  llenadoSinVer,
  movimientoVigente,
  PLAZO_POR_DEFECTO,
  PLAZOS,
  TOPE_POR_BOVEDA_SATS,
} from '@/billetera/herencia/reglas';
import { prepararMovimiento, RechazoMovimiento, type MovimientoPreparado } from '@/billetera/herencia/transacciones';
import type { Intento, IntentosDeEnvio } from '../billetera/HojasBilletera';

const BOTON_PRINCIPAL =
  'kp-toque kp-foco h-12 w-full rounded-[16px] bg-[var(--color-primary-fill)] px-6 font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50';
const BOTON_SECUNDARIO =
  'kp-toque kp-foco h-12 w-full rounded-[16px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-6 font-semibold uv-text-primary disabled:opacity-50';
const CAMPO =
  'kp-foco w-full rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-surface-1 px-3 py-3 uv-text-primary';
const ERROR = 'text-sm font-semibold text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]';
const TEXTO_MONO = 'break-all rounded-xl uv-surface-2 px-3 py-2 font-mono text-xs uv-text-primary';

/**
 * Cuanto vale lo revisado: pasado ese tiempo la comision de la red pudo
 * cambiar y se vuelve a calcular antes de firmar (igual que HojaEnviar).
 */
const VIGENCIA_MS = 90_000;

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
      <span className="inline-flex items-center gap-2"><Icons.Copy size={16} aria-hidden /> {copiado ? t('copied') : t('copy')}</span>
    </button>
  );
}

function Hecho({ texto, enlace, onClose }: { texto: string; enlace?: string; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-4 text-center">
      <Icons.CheckCircle size={48} className="mx-auto text-[var(--color-success)]" aria-hidden />
      <p className="text-sm uv-text-secondary">{texto}</p>
      {enlace && (
        <a className={`${BOTON_SECUNDARIO} inline-flex items-center justify-center`} href={enlace} target="_blank" rel="noopener noreferrer">
          {t('bp_ver_explorador')}
        </a>
      )}
      <button type="button" className={BOTON_PRINCIPAL} onClick={onClose}>{t('close')}</button>
    </div>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="uv-text-secondary">{etiqueta}</dt>
      <dd className="text-right font-semibold tabular-nums uv-text-primary">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- Crear

const MENSAJE_DE_LLAVE: Record<LlaveInvalida['motivo'], string> = {
  'son-palabras': 'hb_err_llave_palabras',
  'es-privada': 'hb_err_llave_privada',
  'sin-origen': 'hb_err_llave_origen',
  'otra-red': 'hb_err_llave_red',
  formato: 'hb_err_llave_formato',
};

type PasoCrear = 'como' | 'llave' | 'plazo' | 'revisar';

interface HojaCrearProps {
  abierta: boolean;
  onClose: () => void;
  userId: string;
  miLlave: LlaveConOrigen;
  onCreada: () => Promise<void>;
}

export function HojaCrearHerencia({ abierta, onClose, userId, miLlave, onCreada }: HojaCrearProps) {
  const { t, language } = useLanguage();
  const [paso, setPaso] = useState<PasoCrear>('como');
  const [entiendo, setEntiendo] = useState(false);
  const [heredero, setHeredero] = useState<LlaveConOrigen | null>(null);
  const [errorLlave, setErrorLlave] = useState('');
  const [nombre, setNombre] = useState('');
  const [plazo, setPlazo] = useState<number>(PLAZO_POR_DEFECTO);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const numero = (n: number) => n.toLocaleString(localeDe(language));

  useEffect(() => {
    if (!abierta) return;
    setPaso('como');
    setEntiendo(false);
    setHeredero(null);
    setErrorLlave('');
    setNombre('');
    setPlazo(PLAZO_POR_DEFECTO);
    setOcupado(false);
    setError('');
  }, [abierta]);

  const leerDelHeredero = (crudo: string): boolean => {
    try {
      const llave = leerLlave(crudo, 'bitcoin');
      if (mismaLlave(llave, miLlave)) {
        setErrorLlave(t('hb_err_llave_tuya'));
        return false;
      }
      setHeredero(llave);
      setErrorLlave('');
      return true;
    } catch (e) {
      setErrorLlave(t(e instanceof LlaveInvalida ? MENSAJE_DE_LLAVE[e.motivo] : 'hb_err_llave_formato'));
      return false;
    }
  };

  // La primera direccion, para que quien quiera la compare en Liana antes de llenar.
  const primera = heredero && paso === 'revisar'
    ? direccionDeLaBoveda({ red: 'bitcoin', titular: miLlave, heredero, plazoBloques: plazo }, 0, 0).direccion
    : '';

  const crear = async () => {
    if (!heredero || ocupado) return;
    setOcupado(true);
    setError('');
    try {
      if (!(await confirmarConHuella(t('hb_crear_razon')))) return;
      await guardarBoveda(userId, {
        red: 'bitcoin',
        titular: miLlave,
        heredero,
        plazoBloques: plazo,
        creada: new Date().toISOString(),
        ...(nombre.trim() ? { nombreDelHeredero: nombre.trim().slice(0, 60) } : {}),
      });
      await onCreada();
    } catch {
      setError(t('hb_err_crear'));
    } finally {
      setOcupado(false);
    }
  };

  const meses = (bloques: number) => PLAZOS.find(p => p.bloques === bloques)?.meses ?? 0;

  return (
    <BottomSheet isOpen={abierta} onClose={onClose} dismissable={!ocupado} title={t('hb_crear_titulo')}>
      {paso === 'como' && (
        <div className="space-y-4">
          <h4 className="font-bold uv-text-primary">{t('hb_paso_como')}</h4>
          <ul className="space-y-3 text-sm uv-text-secondary">
            <li className="flex gap-3"><Icons.Wallet size={18} className="shrink-0 uv-text-primary" aria-hidden />{t('hb_como_1')}</li>
            <li className="flex gap-3"><Icons.Clock size={18} className="shrink-0 uv-text-primary" aria-hidden />{t('hb_como_2')}</li>
            <li className="flex gap-3"><Icons.AlertTriangle size={18} className="shrink-0 text-[var(--color-danger)]" aria-hidden />{t('hb_como_3')}</li>
            <li className="flex gap-3"><Icons.FileText size={18} className="shrink-0 uv-text-primary" aria-hidden />{t('hb_como_4')}</li>
          </ul>
          <label className="flex items-start gap-3 rounded-xl uv-surface-2 p-3 text-sm uv-text-primary">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={entiendo} onChange={e => setEntiendo(e.target.checked)} />
            <span>{t('hb_entiendo')}</span>
          </label>
          <button type="button" className={BOTON_PRINCIPAL} disabled={!entiendo} onClick={() => setPaso('llave')}>{t('continue')}</button>
        </div>
      )}

      {paso === 'llave' && (
        <div className="space-y-4">
          <h4 className="font-bold uv-text-primary">{t('hb_paso_llave')}</h4>
          <p className="text-sm uv-text-secondary">{t('hb_llave_ayuda')}</p>
          {heredero ? (
            <>
              <div className="space-y-1 rounded-xl uv-surface-2 p-3">
                <p className="text-xs uv-text-muted">{t('hb_llave_leida')}</p>
                <p className="font-mono text-sm uv-text-primary">{heredero.huella} · {direccionCorta(heredero.xpub, 10)}</p>
              </div>
              <label className="block space-y-1">
                <span className="text-sm font-semibold uv-text-secondary">{t('hb_nombre_heredero')}</span>
                <input className={CAMPO} value={nombre} maxLength={60} onChange={e => setNombre(e.target.value)} />
              </label>
              <button type="button" className={BOTON_PRINCIPAL} onClick={() => setPaso('plazo')}>{t('continue')}</button>
              <button type="button" className={BOTON_SECUNDARIO} onClick={() => { setHeredero(null); setErrorLlave(''); }}>{t('hb_otra_llave')}</button>
            </>
          ) : (
            <QrScannerPanel active={abierta && paso === 'llave'} onDecode={leerDelHeredero} hint={t('hb_llave_hint')} error={errorLlave} />
          )}
          <button type="button" className="kp-foco w-full py-2 text-sm font-semibold uv-text-secondary" onClick={() => setPaso('como')}>{t('back')}</button>
        </div>
      )}

      {paso === 'plazo' && (
        <div className="space-y-4">
          <h4 className="font-bold uv-text-primary">{t('hb_paso_plazo')}</h4>
          <fieldset className="space-y-2">
            <legend className="sr-only">{t('hb_paso_plazo')}</legend>
            {PLAZOS.map(p => (
              <label key={p.bloques} className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${plazo === p.bloques ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'}`}>
                <input type="radio" name="hb-plazo" checked={plazo === p.bloques} onChange={() => setPlazo(p.bloques)} />
                <span className="flex-1 font-semibold uv-text-primary">{t(`hb_plazo_${p.meses}`)}</span>
                <span className="tabular-nums uv-text-muted">{rellenar(t('hb_dias'), { dias: numero(diasAproximados(p.bloques)) })}</span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm uv-text-secondary">{t('hb_plazo_ayuda')}</p>
          <button type="button" className={BOTON_PRINCIPAL} onClick={() => setPaso('revisar')}>{t('continue')}</button>
          <button type="button" className="kp-foco w-full py-2 text-sm font-semibold uv-text-secondary" onClick={() => setPaso('llave')}>{t('back')}</button>
        </div>
      )}

      {paso === 'revisar' && heredero && (
        <div className="space-y-4">
          <h4 className="font-bold uv-text-primary">{t('hb_paso_revisar')}</h4>
          <dl className="space-y-3 rounded-2xl uv-surface-2 p-4 text-sm">
            <Fila etiqueta={t('hb_heredero')}>{nombre.trim() || heredero.huella}</Fila>
            <Fila etiqueta={t('hb_paso_plazo')}>{t(`hb_plazo_${meses(plazo)}`)}</Fila>
            <div className="space-y-1">
              <dt className="uv-text-secondary">{t('hb_primera_direccion')}</dt>
              <dd className="break-all font-mono text-xs uv-text-primary">{primera}</dd>
            </div>
          </dl>
          <p className="uv-chip-warning rounded-xl p-3 text-sm">{t('hb_como_3')}</p>
          {error && <p role="alert" className={ERROR}>{error}</p>}
          <button type="button" className={BOTON_PRINCIPAL} disabled={ocupado} onClick={() => void crear()}>
            <span className="inline-flex items-center gap-2"><Icons.Fingerprint size={18} aria-hidden /> {t('hb_crear_confirmar')}</span>
          </button>
          <button type="button" className="kp-foco w-full py-2 text-sm font-semibold uv-text-secondary" disabled={ocupado} onClick={() => setPaso('plazo')}>{t('back')}</button>
        </div>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- Soy heredero

export function HojaSerHeredero({ abierta, onClose, miLlave }: { abierta: boolean; onClose: () => void; miLlave: LlaveConOrigen }) {
  const { t } = useLanguage();
  const texto = textoDeLaLlave(miLlave);
  return (
    <BottomSheet isOpen={abierta} onClose={onClose} title={t('hb_heredero_titulo')}>
      <div className="space-y-4">
        <p className="text-sm uv-text-secondary">{t('hb_heredero_ayuda')}</p>
        <div className="mx-auto w-fit rounded-2xl bg-white p-3">
          <QRCodeSVG value={texto} size={224} />
        </div>
        <p className={TEXTO_MONO}>{texto}</p>
        <BotonCopiar texto={texto} />
        <p className="uv-chip-info rounded-xl p-3 text-sm">{t('hb_heredero_cobrar')}</p>
      </div>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- Kit

export function HojaKitHerencia({ abierta, onClose, boveda }: { abierta: boolean; onClose: () => void; boveda: BovedaGuardada }) {
  const { t, language } = useLanguage();
  const contenido = useMemo(() => contenidoDelKit(boveda), [boveda]);
  const [entrega, setEntrega] = useState<'quieto' | 'listo' | 'error'>('quieto');
  const cerrar = () => { setEntrega('quieto'); onClose(); };

  const guardar = async () => {
    const fecha = new Date(boveda.creada).toLocaleDateString(localeDe(language));
    const texto = textoDelKit(contenido, t, fecha);
    const r = await entregarArchivo(new Blob([texto], { type: 'text/plain;charset=utf-8' }), nombreDelKit(boveda.creada));
    setEntrega(r === 'listo' || r === 'compartido' ? 'listo' : r === 'quieto' ? 'quieto' : 'error');
  };

  return (
    <BottomSheet isOpen={abierta} onClose={cerrar} title={t('hb_kit')}>
      <div className="space-y-4">
        <p className="text-sm uv-text-secondary">{t('hb_kit_ayuda')}</p>
        <button type="button" className={BOTON_PRINCIPAL} onClick={() => void guardar()}>
          <span className="inline-flex items-center gap-2"><Icons.Download size={18} aria-hidden /> {t('hb_kit_guardar')}</span>
        </button>
        {entrega === 'listo' && <p role="status" className="text-sm font-semibold text-[var(--color-success)]">{t('hb_kit_guardado')}</p>}
        {entrega === 'error' && <p role="alert" className={ERROR}>{t('hb_kit_err')}</p>}
        <div className="mx-auto w-fit rounded-2xl bg-white p-3">
          <QRCodeSVG value={contenido.descriptor} size={256} level="L" />
        </div>
        <p className={TEXTO_MONO}>{contenido.descriptor}</p>
        <BotonCopiar texto={contenido.descriptor} />
        <p className="uv-chip-warning rounded-xl p-3 text-sm">{t('hb_kit_testamento')}</p>
      </div>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- Llenar

interface HojaLlenarProps {
  abierta: boolean;
  onClose: () => void;
  userId: string;
  boveda: BovedaGuardada;
  /** Lo que se leyo al abrir la hoja: una relectura no la cambia a mitad de camino. */
  estado: EstadoDeLaBoveda;
  btc: BilleteraBitcoin | null;
  /** Lo guardado cambio (se anoto un movimiento o termino el envio): releer. */
  onCambio: () => void;
  /** Como en HojaEnviar: mientras dure el envio, la billetera no se cierra. */
  onEnviando?: (enviando: boolean) => void;
  /** Como en HojaEnviar: el intento de un envio dudoso sobrevive a la hoja. */
  intentos?: IntentosDeEnvio;
}

/** Solo digitos: "1e3" o "0x10" no son montos. */
const MONTO_EN_SATS = /^\d+$/;

export function HojaLlenarHerencia({ abierta, onClose, userId, boveda, estado, btc, onCambio, onEnviando, intentos: intentosDeFuera }: HojaLlenarProps) {
  const { t, language } = useLanguage();
  const [monto, setMonto] = useState('');
  const [preparado, setPreparado] = useState<{ envio: EnvioBitcoinPreparado; en: number; clave: string } | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [hecho, setHecho] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const enviando = useRef(false);
  const intentosPropios = useRef<IntentosDeEnvio>(new Map());
  const intentos = intentosDeFuera ?? intentosPropios.current;
  const numero = (n: number) => n.toLocaleString(localeDe(language));

  // Lo que ya salio hacia la boveda y la red todavia no muestra cuenta para el tope.
  const enCamino = llenadoSinVer(boveda.movimiento, estado.siguienteRecibir, ahora);
  const maximo = Math.max(0, cabeEnLaBoveda(estado.confirmadoSats, estado.pendienteSats) - enCamino);
  const direccion = useMemo(
    () => direccionDeLaBoveda(boveda, 0, estado.siguienteRecibir).direccion,
    [boveda, estado.siguienteRecibir],
  );

  useEffect(() => {
    if (!abierta) return;
    setMonto('');
    setPreparado(null);
    setError('');
    setAviso('');
    setOcupado(false);
    setHecho(false);
    setAhora(Date.now());
  }, [abierta]);

  const preparar = async () => {
    if (!btc) return null;
    const texto = monto.trim();
    const sats = Number(texto);
    if (!MONTO_EN_SATS.test(texto) || !Number.isSafeInteger(sats) || sats <= 0) {
      setError(t('bp_err_monto'));
      return null;
    }
    if (sats > maximo) {
      setError(rellenar(t('hb_err_tope'), { max: numero(maximo) }));
      return null;
    }
    try {
      const envio = await btc.prepararEnvio(direccion, sats);
      // La boveda solo se llena por la red de bitcoin, a su propia direccion.
      if (envio.destino.tipo !== 'direccion-bitcoin') throw new Error('destino inesperado');
      // Mismo destino y monto = mismo intento: repetirlo no cobra dos veces (ver HojaEnviar).
      return { envio, en: Date.now(), clave: `herencia|${direccion}|${sats}` };
    } catch (e) {
      if (e instanceof RechazoBitcoin && e.motivo === 'saldo-insuficiente') setError(t('bp_err_saldo'));
      else if (e instanceof RechazoBitcoin && e.motivo === 'monto-invalido') setError(t('bp_err_monto'));
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
    if (!preparado || !btc || enviando.current) return;
    enviando.current = true;
    onEnviando?.(true);
    setOcupado(true);
    setError('');
    setAviso('');
    try {
      if (Date.now() - preparado.en > VIGENCIA_MS) {
        const nuevo = await preparar();
        setPreparado(nuevo);
        if (nuevo) setAviso(t('bp_cotizacion_vencida'));
        return;
      }
      if (!(await confirmarConHuella(t('hb_llenar_razon')))) return;
      // Un reintento del mismo envio dudoso ya esta anotado: no se suma dos veces.
      const reintento = intentos.has(preparado.clave);
      let intento: Intento | undefined = intentos.get(preparado.clave);
      if (!intento) {
        intento = { llave: crypto.randomUUID() };
        intentos.set(preparado.clave, intento);
      }
      // Se anota ANTES de mandar: si la respuesta se pierde, la marca ya esta.
      const sats = preparado.envio.montoSats;
      await anotarMovimiento(userId, previo => anotarLlenado(previo, estado.siguienteRecibir, reintento ? 0 : sats, Date.now()));
      onCambio();
      await btc.enviar(preparado.envio, intento.llave);
      intentos.delete(preparado.clave);
      setHecho(true);
      onCambio();
    } catch {
      setError(t('bp_err_envio'));
    } finally {
      enviando.current = false;
      setOcupado(false);
      onEnviando?.(false);
    }
  };

  return (
    <BottomSheet isOpen={abierta} onClose={onClose} dismissable={!ocupado} title={t('hb_llenar_titulo')}>
      {hecho ? (
        <Hecho texto={t('hb_llenar_hecho')} onClose={onClose} />
      ) : preparado ? (
        <div className="space-y-4">
          {aviso && <p role="status" className="uv-chip-warning rounded-xl p-3 text-sm">{aviso}</p>}
          <dl className="space-y-3 rounded-2xl uv-surface-2 p-4 text-sm">
            <div className="space-y-1">
              <dt className="uv-text-secondary">{t('bp_resumen_para')}</dt>
              <dd className="break-all font-mono uv-text-primary">{direccion}</dd>
            </div>
            <Fila etiqueta={t('bp_resumen_envias')}>{numero(preparado.envio.montoSats)} sats</Fila>
            <Fila etiqueta={t('bp_resumen_comision')}>{numero(preparado.envio.comisionSats)} sats</Fila>
          </dl>
          {error && <p role="alert" className={ERROR}>{error}</p>}
          <button type="button" className={BOTON_PRINCIPAL} disabled={ocupado} onClick={() => void confirmar()}>
            <span className="inline-flex items-center gap-2"><Icons.Fingerprint size={18} aria-hidden /> {t('hb_llenar_confirmar')}</span>
          </button>
          <button type="button" className={BOTON_SECUNDARIO} disabled={ocupado} onClick={() => setPreparado(null)}>{t('back')}</button>
        </div>
      ) : (
        <div className="space-y-4">
          {enCamino > 0 && (
            <p role="status" className="uv-chip-warning rounded-xl p-3 text-sm">{rellenar(t('hb_llenar_en_camino'), { sats: numero(enCamino) })}</p>
          )}
          {maximo === 0 ? (
            <p className="uv-chip-warning rounded-xl p-3 text-sm">{rellenar(t('hb_tope'), { btc: satsABtc(TOPE_POR_BOVEDA_SATS) })}</p>
          ) : (
            <>
              <p className="text-sm uv-text-secondary">{rellenar(t('hb_llenar_ayuda'), { max: numero(maximo) })}</p>
              <label className="block space-y-1">
                <span className="text-sm font-semibold uv-text-secondary">{t('bp_monto_sats')}</span>
                <input
                  className={CAMPO}
                  inputMode="numeric"
                  value={monto}
                  onChange={e => { setError(''); setMonto(e.target.value); }}
                />
              </label>
              {error && <p role="alert" className={ERROR}>{error}</p>}
              <button type="button" className={BOTON_PRINCIPAL} disabled={ocupado || !btc} onClick={() => void revisar()}>
                {ocupado ? t('loading') : t('bp_revisar')}
              </button>
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- Renovar o sacar

interface HojaMoverProps {
  modo: 'renovar' | 'sacar';
  abierta: boolean;
  onClose: () => void;
  userId: string;
  boveda: BovedaGuardada;
  /** Lo que se leyo al abrir la hoja: una relectura no la cambia a mitad de camino. */
  estado: EstadoDeLaBoveda;
  semilla: string;
  btc: BilleteraBitcoin | null;
  red: FuenteDeLaRed;
  /** Lo guardado o la red cambiaron: releer. */
  onCambio: () => void;
}

const MENSAJE_DE_MOVIMIENTO: Record<RechazoMovimiento['motivo'], string> = {
  'sin-monedas': 'hb_err_sin_monedas',
  'no-alcanza': 'hb_err_no_alcanza',
  'comision-excesiva': 'hb_err_comision',
  'tasa-fuera-de-rango': 'hb_err_tasa',
  'otras-palabras': 'hb_otras_palabras',
};

export function HojaMoverHerencia({ modo, abierta, onClose, userId, boveda, estado, semilla, btc, red, onCambio }: HojaMoverProps) {
  const { t, language } = useLanguage();
  const [preparado, setPreparado] = useState<{ movimiento: MovimientoPreparado; en: number } | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  const enviando = useRef(false);
  const numero = (n: number) => n.toLocaleString(localeDe(language));

  const preparar = async (): Promise<{ movimiento: MovimientoPreparado; en: number } | null> => {
    try {
      const destino = modo === 'renovar'
        ? direccionDeLaBoveda(boveda, 1, estado.siguienteCambio).direccion
        : btc ? await btc.direccionBitcoin() : null;
      if (!destino) return null;
      const tasas = await red.tasas();
      const movimiento = prepararMovimiento({ datos: boveda, semilla, monedas: estado.monedas, destino, tasaSatsVb: tasas.media });
      return { movimiento, en: Date.now() };
    } catch (e) {
      setError(t(e instanceof RechazoMovimiento ? MENSAJE_DE_MOVIMIENTO[e.motivo] : 'bp_err_red'));
      return null;
    }
  };

  useEffect(() => {
    if (!abierta) return;
    let vigente = true;
    setPreparado(null);
    setError('');
    setAviso('');
    setHecho(null);
    setOcupado(true);
    void preparar().then(p => { if (vigente) setPreparado(p); }).finally(() => { if (vigente) setOcupado(false); });
    return () => { vigente = false; };
    // Se prepara al abrir; lo demas no cambia mientras la hoja esta abierta.
  }, [abierta, modo]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmar = async () => {
    if (!preparado || enviando.current) return;
    enviando.current = true;
    setOcupado(true);
    setError('');
    setAviso('');
    try {
      if (Date.now() - preparado.en > VIGENCIA_MS) {
        const nuevo = await preparar();
        setPreparado(nuevo);
        if (nuevo) setAviso(t('bp_cotizacion_vencida'));
        return;
      }
      if (!(await confirmarConHuella(t('hb_mover_razon')))) return;
      // Se anota ANTES de emitir: un "sacar" en la mempool hace que la boveda se
      // vea vacia, y si esa transaccion se cae las monedas vuelven.
      await anotarMovimiento(userId, previo => ({ ...previo, en: new Date().toISOString() }));
      // Emitir la misma transaccion dos veces no mueve nada dos veces.
      await red.emitir(preparado.movimiento.hex);
      setHecho(red.enlaceDeTransaccion(preparado.movimiento.txid));
      onCambio();
    } catch (e) {
      setError(t(e instanceof TransaccionRechazada ? 'hb_err_rechazada' : 'bp_err_envio'));
      // Pudo haber salido aunque la respuesta no llego: se relee.
      onCambio();
    } finally {
      enviando.current = false;
      setOcupado(false);
    }
  };

  const m = preparado?.movimiento;
  return (
    <BottomSheet
      isOpen={abierta}
      onClose={onClose}
      dismissable={!ocupado}
      title={t(modo === 'renovar' ? 'hb_renovar_titulo' : 'hb_sacar_titulo')}
    >
      {hecho ? (
        <Hecho texto={t(modo === 'renovar' ? 'hb_mover_hecho_renovar' : 'hb_mover_hecho_sacar')} enlace={hecho} onClose={onClose} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm uv-text-secondary">{t(modo === 'renovar' ? 'hb_renovar_ayuda' : 'hb_sacar_ayuda')}</p>
          {aviso && <p role="status" className="uv-chip-warning rounded-xl p-3 text-sm">{aviso}</p>}
          {m ? (
            <dl className="space-y-3 rounded-2xl uv-surface-2 p-4 text-sm">
              <Fila etiqueta={t('hb_mover_monedas')}>{m.monedas.length}</Fila>
              <Fila etiqueta={t('bp_resumen_comision')}>{numero(m.comisionSats)} sats</Fila>
              <Fila etiqueta={t('hb_mover_llega')}>{numero(m.llegaSats)} sats</Fila>
              <div className="space-y-1">
                <dt className="uv-text-secondary">{t('bp_resumen_para')}</dt>
                <dd className="break-all font-mono uv-text-primary">{m.destino}</dd>
              </div>
            </dl>
          ) : (
            ocupado && <p className="text-sm uv-text-muted">{t('loading')}</p>
          )}
          {error && <p role="alert" className={ERROR}>{error}</p>}
          {m && (
            <button type="button" className={BOTON_PRINCIPAL} disabled={ocupado} onClick={() => void confirmar()}>
              <span className="inline-flex items-center gap-2">
                <Icons.Fingerprint size={18} aria-hidden /> {t(modo === 'renovar' ? 'hb_mover_confirmar_renovar' : 'hb_mover_confirmar_sacar')}
              </span>
            </button>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- Quitar

interface HojaQuitarProps {
  abierta: boolean;
  onClose: () => void;
  userId: string;
  vacia: boolean;
  onQuitada: () => Promise<void>;
}

export function HojaQuitarHerencia({ abierta, onClose, userId, vacia, onQuitada }: HojaQuitarProps) {
  const { t } = useLanguage();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (abierta) { setOcupado(false); setError(''); } }, [abierta]);

  const quitar = async () => {
    if (!vacia || ocupado) return;
    setOcupado(true);
    setError('');
    try {
      if (!(await confirmarConHuella(t('hb_quitar_razon')))) return;
      // Se mira lo guardado, no la pantalla: un movimiento recien anotado manda.
      const actual = await leerBovedaGuardada(userId);
      if (actual.estado === 'error') throw new Error('almacen');
      if (actual.estado === 'hay' && movimientoVigente(actual.boveda.movimiento, Date.now())) {
        setError(t('hb_err_quitar_reciente'));
        return;
      }
      await borrarBovedaGuardada(userId);
      await onQuitada();
    } catch {
      setError(t('hb_err_almacen'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <BottomSheet isOpen={abierta} onClose={onClose} dismissable={!ocupado} title={t('hb_quitar')}>
      <div className="space-y-4">
        <p className="text-sm uv-text-secondary">{t('hb_quitar_cuerpo')}</p>
        {error && <p role="alert" className={ERROR}>{error}</p>}
        <button
          type="button"
          className="kp-toque kp-foco h-12 w-full rounded-[16px] bg-[var(--color-danger-fill)] px-6 font-semibold text-white disabled:opacity-50"
          disabled={!vacia || ocupado}
          onClick={() => void quitar()}
        >
          {t('hb_quitar_confirmar')}
        </button>
        <button type="button" className={BOTON_SECUNDARIO} disabled={ocupado} onClick={onClose}>{t('cancel')}</button>
      </div>
    </BottomSheet>
  );
}
