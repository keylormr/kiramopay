// La billetera propia: la parte de Cripto donde la persona guarda sus llaves.
//
// Al reves del portafolio (filas en la base de KiramoPay), aqui el dinero vive
// en las redes y solo este telefono puede moverlo. La semilla se abre con la
// huella al entrar y se suelta al salir de la pestana: no queda en memoria
// mientras la persona hace otra cosa.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { AvatarCripto } from '@/components/cripto/AvatarCripto';
import { formatMoney } from '@/utils/money';
import { localeDe } from '@/utils/periodos';
import { abrirSemilla, borrarSemilla, bovedaDisponible, confirmarConHuella, guardarSemilla, hayBilletera } from '@/billetera/boveda';
import { abrirBitcoin, bitcoinConfigurado, type BilleteraBitcoin, type MovimientoBitcoin } from '@/billetera/bitcoin';
import { ACTIVOS_EVM, direccionEvm as derivarDireccionEvm, enlaceDeDireccion, saldoEvm, saldoLegible } from '@/billetera/evm';
import { recortarDecimales, satsABtc, valorEnUsd } from '@/billetera/formato';
import { CrearBilletera } from './CrearBilletera';
import { HojaEnviar, HojaPalabras, HojaQuitar, HojaRecibir, type ActivoDeLaBilletera } from './HojasBilletera';

type Fase = 'cargando' | 'web' | 'sin-billetera' | 'crear' | 'restaurar' | 'cerrada' | 'abierta';

/** Lo que falta sumar: el catalogo de la app las lista, la billetera propia todavia no. */
const PROXIMAMENTE = ['SOL', 'ADA', 'DOT', 'ATOM'] as const;

const BTC: ActivoDeLaBilletera = { tipo: 'btc', simbolo: 'BTC', nombre: 'Bitcoin', simboloDelCatalogo: 'BTC' };
const OTRAS: ActivoDeLaBilletera[] = ACTIVOS_EVM.map(evm => ({
  tipo: 'evm',
  simbolo: evm.simbolo,
  nombre: evm.nombre,
  simboloDelCatalogo: evm.simboloDelCatalogo,
  evm,
}));

const BOTON_PRINCIPAL =
  'kp-toque kp-foco h-12 w-full rounded-[16px] bg-[var(--color-primary-fill)] px-6 font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50';
const BOTON_SECUNDARIO =
  'kp-toque kp-foco h-12 w-full rounded-[16px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-6 font-semibold uv-text-primary disabled:opacity-50';
const TARJETA = 'uv-surface-1 rounded-[20px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)]';

type Saldo = { texto: string | null; error: boolean };

export function BilleteraPropia() {
  const { t } = useLanguage();
  const { state } = useApp();
  const userId = state.user?.id ?? '';

  // En la web no hay almacen seguro: la billetera propia no se ofrece (boveda.ts).
  const [fase, setFase] = useState<Fase>(() => (bovedaDisponible() ? 'cargando' : 'web'));
  const [semilla, setSemilla] = useState<string | null>(null);
  const [btc, setBtc] = useState<BilleteraBitcoin | null>(null);
  const [btcEstado, setBtcEstado] = useState<'sin-configurar' | 'conectando' | 'lista' | 'error'>('conectando');
  const [saldos, setSaldos] = useState<Record<string, Saldo>>({});
  const [movimientos, setMovimientos] = useState<MovimientoBitcoin[]>([]);
  const [direccionDeCobro, setDireccionDeCobro] = useState<string | null>(null);
  const [recibir, setRecibir] = useState<ActivoDeLaBilletera | null>(null);
  const [enviar, setEnviar] = useState<ActivoDeLaBilletera | null>(null);
  const [palabrasVisibles, setPalabrasVisibles] = useState<string | null>(null);
  const [quitando, setQuitando] = useState(false);
  const btcRef = useRef<BilleteraBitcoin | null>(null);

  const direccionEvm = semilla ? derivarDireccionEvm(semilla) : null;

  // Al salir de la pestana se suelta todo: la semilla y la conexion de bitcoin.
  useEffect(() => () => {
    void btcRef.current?.desconectar().catch(() => undefined);
    btcRef.current = null;
  }, []);

  useEffect(() => {
    let vigente = true;
    if (!bovedaDisponible() || !userId) return;
    void hayBilletera(userId).then(hay => { if (vigente) setFase(hay ? 'cerrada' : 'sin-billetera'); });
    return () => { vigente = false; };
  }, [userId]);

  const precioDe = (simboloDelCatalogo: string) =>
    state.crypto.assets.find(a => a.symbol === simboloDelCatalogo)?.currentPrice;
  const activoDelCatalogo = (simbolo: string) => state.crypto.assets.find(a => a.symbol === simbolo);

  const leerSaldos = useCallback(async (frase: string, billeteraBtc: BilleteraBitcoin | null) => {
    const direccion = derivarDireccionEvm(frase);
    const pendientes: Record<string, Saldo> = {};
    for (const a of ACTIVOS_EVM) pendientes[a.simbolo] = { texto: null, error: false };
    if (billeteraBtc) pendientes.BTC = { texto: null, error: false };
    setSaldos(s => ({ ...s, ...pendientes }));

    await Promise.all([
      ...ACTIVOS_EVM.map(async a => {
        try {
          const minimo = await saldoEvm(a, direccion);
          setSaldos(s => ({ ...s, [a.simbolo]: { texto: recortarDecimales(saldoLegible(a, minimo), 8), error: false } }));
        } catch {
          setSaldos(s => ({ ...s, [a.simbolo]: { texto: null, error: true } }));
        }
      }),
      (async () => {
        if (!billeteraBtc) return;
        try {
          const [sats, lista, cobro] = await Promise.all([
            billeteraBtc.saldoSats(),
            billeteraBtc.movimientos(),
            billeteraBtc.direccionLightning(),
          ]);
          setSaldos(s => ({ ...s, BTC: { texto: satsABtc(sats), error: false } }));
          setMovimientos(lista);
          setDireccionDeCobro(cobro);
        } catch {
          setSaldos(s => ({ ...s, BTC: { texto: null, error: true } }));
        }
      })(),
    ]);
  }, []);

  const entrar = useCallback(async (frase: string) => {
    setSemilla(frase);
    setFase('abierta');
    let billeteraBtc: BilleteraBitcoin | null = null;
    if (!bitcoinConfigurado()) {
      setBtcEstado('sin-configurar');
    } else {
      setBtcEstado('conectando');
      try {
        billeteraBtc = await abrirBitcoin(frase, userId);
        btcRef.current = billeteraBtc;
        setBtc(billeteraBtc);
        setBtcEstado('lista');
      } catch {
        setBtcEstado('error');
      }
    }
    await leerSaldos(frase, billeteraBtc);
  }, [leerSaldos, userId]);

  const abrir = async () => {
    const r = await abrirSemilla(userId, t('bp_abrir_razon'));
    if (r.estado === 'abierta') await entrar(r.semilla);
    else if (r.estado === 'sin-billetera') setFase('sin-billetera');
  };

  const guardar = async (frase: string) => {
    await guardarSemilla(userId, frase);
    await entrar(frase);
  };

  const quitar = async () => {
    await btcRef.current?.desconectar().catch(() => undefined);
    btcRef.current = null;
    await borrarSemilla(userId);
    setBtc(null);
    setSemilla(null);
    setSaldos({});
    setMovimientos([]);
    setDireccionDeCobro(null);
    setQuitando(false);
    setFase('sin-billetera');
  };

  if (fase === 'cargando') {
    return <p className="p-4 text-sm uv-text-muted">{t('loading')}</p>;
  }

  if (fase === 'web') {
    return (
      <section className={`${TARJETA} space-y-2 p-5`}>
        <Icons.Lock size={24} className="uv-text-secondary" aria-hidden />
        <h3 className="text-lg font-bold uv-text-primary">{t('bp_web_titulo')}</h3>
        <p className="text-sm uv-text-secondary">{t('bp_web_cuerpo')}</p>
      </section>
    );
  }

  if (fase === 'crear' || fase === 'restaurar') {
    return <CrearBilletera modo={fase} onListo={guardar} onCancelar={() => setFase('sin-billetera')} />;
  }

  if (fase === 'sin-billetera') {
    return (
      <section className={`${TARJETA} space-y-4 p-5`}>
        <h3 className="text-lg font-bold uv-text-primary">{t('bp_intro_titulo')}</h3>
        <ul className="space-y-3 text-sm uv-text-secondary">
          <li className="flex gap-3"><Icons.Shield size={18} className="shrink-0 uv-text-primary" aria-hidden />{t('bp_intro_llaves')}</li>
          <li className="flex gap-3"><Icons.Bitcoin size={18} className="shrink-0 uv-text-primary" aria-hidden />{t('bp_intro_redes')}</li>
          <li className="flex gap-3"><Icons.AlertTriangle size={18} className="shrink-0 uv-text-primary" aria-hidden />{t('bp_intro_riesgo')}</li>
        </ul>
        <div className="space-y-2">
          <button type="button" className={BOTON_PRINCIPAL} onClick={() => setFase('crear')}>{t('bp_crear')}</button>
          <button type="button" className={BOTON_SECUNDARIO} onClick={() => setFase('restaurar')}>{t('bp_restaurar')}</button>
        </div>
      </section>
    );
  }

  if (fase === 'cerrada' || !semilla) {
    return (
      <section className={`${TARJETA} space-y-4 p-5 text-center`}>
        <Icons.Fingerprint size={40} className="mx-auto uv-text-primary" aria-hidden />
        <h3 className="text-lg font-bold uv-text-primary">{t('bp_cerrada_titulo')}</h3>
        <p className="text-sm uv-text-secondary">{t('bp_cerrada_cuerpo')}</p>
        <button type="button" className={BOTON_PRINCIPAL} onClick={abrir}>{t('bp_abrir')}</button>
      </section>
    );
  }

  const saldoBtc = saldos.BTC;
  const usdBtc = saldoBtc?.texto ? valorEnUsd(saldoBtc.texto, precioDe('BTC')) : null;

  return (
    <div className="space-y-4">
      {/* Bitcoin va primero y en grande: es la moneda de la casa. */}
      <section className={`${TARJETA} space-y-4 p-5`} aria-labelledby="bp-btc">
        <div className="flex items-center gap-3">
          <AvatarCripto simbolo="BTC" color={activoDelCatalogo('BTC')?.color ?? '#F7931A'} icono={activoDelCatalogo('BTC')?.icon ?? '₿'} tamano={48} />
          <h3 id="bp-btc" className="min-w-0 flex-1 font-bold uv-text-primary">Bitcoin</h3>
        </div>

        {btcEstado === 'sin-configurar' ? (
          <p className="rounded-xl uv-surface-2 p-3 text-sm uv-text-secondary">{t('bp_btc_sin_configurar')}</p>
        ) : (
          <>
            <div>
              <p className="text-3xl font-extrabold tabular-nums uv-text-primary">
                {saldoBtc?.texto ?? (saldoBtc?.error || btcEstado === 'error' ? '—' : '…')} <span className="text-base font-bold uv-text-secondary">BTC</span>
              </p>
              {usdBtc !== null && <p className="text-sm tabular-nums uv-text-muted">≈ {formatMoney(usdBtc, 'USD')}</p>}
              {(saldoBtc?.error || btcEstado === 'error') && <p className="text-sm text-[var(--color-danger)]">{t('bp_saldo_error')}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={BOTON_PRINCIPAL} disabled={btcEstado !== 'lista'} onClick={() => setRecibir(BTC)}>
                <span className="inline-flex items-center gap-2"><Icons.Receive size={18} aria-hidden /> {t('receive')}</span>
              </button>
              <button type="button" className={BOTON_SECUNDARIO} disabled={btcEstado !== 'lista'} onClick={() => setEnviar(BTC)}>
                <span className="inline-flex items-center gap-2"><Icons.Send size={18} aria-hidden /> {t('send')}</span>
              </button>
            </div>
            <DireccionDeCobro btc={btc} actual={direccionDeCobro} sugerida={state.user?.username} onCreada={setDireccionDeCobro} />
            <MovimientosBitcoin lista={movimientos} />
          </>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="bp-otras">
        <div className="flex items-center justify-between">
          <h3 id="bp-otras" className="text-lg font-bold uv-text-primary">{t('bp_otras')}</h3>
          <button type="button" className="kp-foco rounded-lg p-2 uv-text-secondary" aria-label={t('bp_actualizar')} onClick={() => void leerSaldos(semilla, btc)}>
            <Icons.RefreshCw size={18} aria-hidden />
          </button>
        </div>
        {OTRAS.map(a => {
          const s = saldos[a.simbolo];
          const usd = s?.texto ? valorEnUsd(s.texto, precioDe(a.simboloDelCatalogo)) : null;
          const delCatalogo = activoDelCatalogo(a.simboloDelCatalogo);
          return (
            <div key={a.simbolo} className={`${TARJETA} flex items-center gap-3 p-4`}>
              <AvatarCripto simbolo={a.simbolo} color={delCatalogo?.color ?? '#627EEA'} icono={delCatalogo?.icon ?? a.simbolo[0]} tamano={40} />
              <div className="min-w-0 flex-1">
                <p className="font-bold uv-text-primary">{a.nombre}</p>
                <p className="text-sm tabular-nums uv-text-secondary">{s?.texto ?? (s?.error ? '—' : '…')} {a.simbolo}</p>
                {usd !== null && <p className="text-xs tabular-nums uv-text-muted">≈ {formatMoney(usd, 'USD')}</p>}
              </div>
              <button type="button" className="kp-toque kp-foco rounded-xl p-3 uv-surface-2 uv-text-primary" aria-label={`${t('receive')} ${a.simbolo}`} onClick={() => setRecibir(a)}>
                <Icons.Receive size={18} aria-hidden />
              </button>
              <button type="button" className="kp-toque kp-foco rounded-xl p-3 uv-surface-2 uv-text-primary" aria-label={`${t('send')} ${a.simbolo}`} onClick={() => setEnviar(a)}>
                <Icons.Send size={18} aria-hidden />
              </button>
            </div>
          );
        })}
        {direccionEvm && (
          <a
            className="block text-center text-sm font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline"
            href={enlaceDeDireccion('ethereum', direccionEvm)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('bp_explorador_cuenta')}
          </a>
        )}
        {PROXIMAMENTE.map(simbolo => {
          const delCatalogo = activoDelCatalogo(simbolo);
          return (
            <div key={simbolo} className={`${TARJETA} flex items-center gap-3 p-4 opacity-60`}>
              <AvatarCripto simbolo={simbolo} color={delCatalogo?.color ?? '#888'} icono={delCatalogo?.icon ?? simbolo[0]} tamano={40} />
              <p className="min-w-0 flex-1 font-bold uv-text-primary">{delCatalogo?.name ?? simbolo}</p>
              <span className="uv-chip-warning rounded-full px-3 py-1 text-xs font-semibold">{t('bp_proximamente')}</span>
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <button
          type="button"
          className={BOTON_SECUNDARIO}
          onClick={async () => { if (await confirmarConHuella(t('bp_ver_palabras_razon'))) setPalabrasVisibles(semilla); }}
        >
          {t('bp_ver_palabras')}
        </button>
        <button type="button" className="kp-foco w-full py-3 text-sm font-semibold text-[var(--color-danger)]" onClick={() => setQuitando(true)}>
          {t('bp_quitar')}
        </button>
      </section>

      <HojaRecibir activo={recibir} onClose={() => setRecibir(null)} direccionEvm={direccionEvm} btc={btc} />
      <HojaEnviar activo={enviar} onClose={() => setEnviar(null)} semilla={semilla} btc={btc} onEnviado={() => void leerSaldos(semilla, btc)} />
      <HojaPalabras semilla={palabrasVisibles} onClose={() => setPalabrasVisibles(null)} />
      <HojaQuitar abierta={quitando} onClose={() => setQuitando(false)} onQuitar={quitar} />
    </div>
  );
}

function DireccionDeCobro({ btc, actual, sugerida, onCreada }: {
  btc: BilleteraBitcoin | null;
  actual: string | null;
  sugerida?: string;
  onCreada: (d: string) => void;
}) {
  const { t } = useLanguage();
  const [nombre, setNombre] = useState(() => (sugerida ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, ''));
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  if (actual) {
    return (
      <div className="rounded-xl uv-surface-2 p-3">
        <p className="text-xs uv-text-muted">{t('bp_direccion_lightning')}</p>
        <p className="break-all font-semibold uv-text-primary">{actual}</p>
      </div>
    );
  }
  if (!btc) return null;

  const crear = async () => {
    const limpio = nombre.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(limpio)) {
      setError(t('bp_direccion_lightning_formato'));
      return;
    }
    setOcupado(true);
    setError('');
    try {
      if (!(await btc.nombreLibre(limpio))) {
        setError(t('bp_direccion_lightning_ocupada'));
        return;
      }
      onCreada(await btc.registrarDireccionLightning(limpio));
    } catch {
      setError(t('bp_err_red'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl uv-surface-2 p-3">
      <p className="text-sm font-semibold uv-text-primary">{t('bp_direccion_lightning')}</p>
      <p className="text-xs uv-text-secondary">{t('bp_direccion_lightning_ayuda')}</p>
      <div className="flex gap-2">
        <input
          className="kp-foco min-w-0 flex-1 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-surface-1 px-3 py-2 uv-text-primary"
          aria-label={t('bp_direccion_lightning_nombre')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={nombre}
          onChange={e => { setError(''); setNombre(e.target.value); }}
        />
        <button type="button" className="kp-toque kp-foco rounded-xl bg-[var(--color-primary-fill)] px-4 font-semibold text-white disabled:opacity-50" disabled={ocupado || !nombre.trim()} onClick={crear}>
          {t('bp_direccion_lightning_crear')}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function MovimientosBitcoin({ lista }: { lista: MovimientoBitcoin[] }) {
  const { t, language } = useLanguage();
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold uv-text-secondary">{t('bp_movimientos')}</p>
      {lista.length === 0 ? (
        <p className="text-sm uv-text-muted">{t('bp_sin_movimientos')}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
          {lista.slice(0, 10).map(m => {
            const estado = m.estado === 'completado' ? (m.tipo === 'recibido' ? t('bp_mov_recibido') : t('bp_mov_enviado'))
              : m.estado === 'pendiente' ? t('bp_mov_pendiente') : t('bp_mov_fallido');
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-semibold uv-text-primary">{estado}</p>
                  <p className="text-xs uv-text-muted">{new Date(m.fecha * 1000).toLocaleString(localeDe(language))}</p>
                </div>
                <p className={`font-semibold tabular-nums ${m.tipo === 'recibido' ? 'text-[var(--color-success)]' : 'uv-text-primary'}`}>
                  {m.tipo === 'recibido' ? '+' : '−'}{m.sats.toLocaleString(localeDe(language))} sats
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
