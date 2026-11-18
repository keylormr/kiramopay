// La boveda de herencia bitcoin, dentro de la billetera propia.
//
// El titular arma una boveda taproot con la llave publica de su heredero: el
// titular la mueve cuando quiera; el heredero solo puede gastarla si las
// monedas pasan el plazo sin moverse (ver src/billetera/herencia/). Todo vive en
// el telefono: el servidor solo dice si la seccion se ofrece.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiLayer } from '@/api';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { localeDe } from '@/utils/periodos';
import { rellenar } from '@/utils/planes';
import type { BilleteraBitcoin } from '@/billetera/bitcoin';
import { satsABtc } from '@/billetera/formato';
import { leerBovedaGuardada, type BovedaGuardada, type BovedaLeida } from '@/billetera/herencia/almacen';
import { esplora } from '@/billetera/herencia/esplora';
import { diasAproximados, leerEstado, type EstadoDeLaBoveda, type NivelDelPlazo } from '@/billetera/herencia/estado';
import { llaveDeLaCuenta, mismaLlave } from '@/billetera/herencia/llaves';
import { TOPE_POR_BOVEDA_SATS } from '@/billetera/herencia/reglas';
import {
  HojaCrearHerencia,
  HojaKitHerencia,
  HojaLlenarHerencia,
  HojaMoverHerencia,
  HojaQuitarHerencia,
  HojaSerHeredero,
} from './HojasHerencia';

const BOTON_PRINCIPAL =
  'kp-toque kp-foco h-12 w-full rounded-[16px] bg-[var(--color-primary-fill)] px-4 font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50';
const BOTON_SECUNDARIO =
  'kp-toque kp-foco h-12 w-full rounded-[16px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 font-semibold uv-text-primary disabled:opacity-50';
const TARJETA = 'uv-surface-1 rounded-[20px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)]';

type Hoja = 'crear' | 'kit' | 'llenar' | 'renovar' | 'sacar' | 'heredero' | 'quitar';

const AVISO: Record<NivelDelPlazo, { llave: string; clase: string; barra: string }> = {
  tranquilo: { llave: 'hb_plazo_tranquilo', clase: 'uv-surface-2 uv-text-secondary', barra: 'bg-[var(--color-primary-fill)]' },
  'renovar-pronto': { llave: 'hb_plazo_mitad', clase: 'uv-chip-warning', barra: 'bg-[var(--color-warning)]' },
  urgente: { llave: 'hb_plazo_urgente', clase: 'uv-chip-danger', barra: 'bg-[var(--color-danger)]' },
  vencido: { llave: 'hb_plazo_vencido', clase: 'uv-chip-danger', barra: 'bg-[var(--color-danger)]' },
};

interface Props {
  semilla: string;
  btc: BilleteraBitcoin | null;
  userId: string;
}

export function SeccionHerencia({ semilla, btc, userId }: Props) {
  const { t, language } = useLanguage();
  const [ofrecida, setOfrecida] = useState(false);
  const [guardada, setGuardada] = useState<BovedaLeida | null>(null);
  const [estado, setEstado] = useState<EstadoDeLaBoveda | null>(null);
  const [errorDeRed, setErrorDeRed] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const red = useMemo(() => esplora(), []);
  const miLlave = useMemo(() => llaveDeLaCuenta(semilla, 'bitcoin'), [semilla]);
  const numero = (n: number) => n.toLocaleString(localeDe(language));

  // Sin respuesta del servidor no se ofrece: es una funcion en espera.
  useEffect(() => {
    let vigente = true;
    void getApiLayer().crypto.getAvailability()
      .then(r => { if (vigente) setOfrecida(r.success === true && r.data?.inheritanceVaultActive === true); })
      .catch(() => { if (vigente) setOfrecida(false); });
    return () => { vigente = false; };
  }, []);

  const cargar = useCallback(async () => {
    setGuardada(await leerBovedaGuardada(userId));
  }, [userId]);

  useEffect(() => {
    if (ofrecida) void cargar();
  }, [ofrecida, cargar]);

  const boveda: BovedaGuardada | null = guardada?.estado === 'hay' ? guardada.boveda : null;
  const esMia = boveda ? mismaLlave(boveda.titular, miLlave) : false;

  const leer = useCallback(async (b: BovedaGuardada, vigente: () => boolean = () => true) => {
    setLeyendo(true);
    setErrorDeRed(false);
    try {
      const nuevo = await leerEstado(b, red);
      if (vigente()) setEstado(nuevo);
    } catch {
      // Una lectura fallida no se pinta como una boveda vacia.
      if (vigente()) { setEstado(null); setErrorDeRed(true); }
    } finally {
      if (vigente()) setLeyendo(false);
    }
  }, [red]);

  useEffect(() => {
    if (!boveda) { setEstado(null); return; }
    let vigente = true;
    void leer(boveda, () => vigente);
    return () => { vigente = false; };
  }, [boveda, leer]);

  if (!ofrecida || guardada === null) return null;

  const cerrar = () => setHoja(null);
  const refrescar = () => { if (boveda) void leer(boveda); };

  const cuerpo = () => {
    if (guardada.estado === 'error') {
      return (
        <div role="alert" className="space-y-3">
          <p className="text-sm uv-text-secondary">{t('hb_err_almacen')}</p>
          <button type="button" className={BOTON_SECUNDARIO} onClick={() => void cargar()}>{t('error_retry')}</button>
        </div>
      );
    }

    if (!boveda) {
      return (
        <div className="space-y-4">
          <p className="text-sm uv-text-secondary">{t('hb_intro')}</p>
          <div className="space-y-2">
            <button type="button" className={BOTON_PRINCIPAL} onClick={() => setHoja('crear')}>{t('hb_crear')}</button>
            <button type="button" className={BOTON_SECUNDARIO} onClick={() => setHoja('heredero')}>{t('hb_soy_heredero')}</button>
          </div>
        </div>
      );
    }

    if (!esMia) {
      return (
        <div className="space-y-3">
          <p className="uv-chip-warning rounded-xl p-3 text-sm">{t('hb_otras_palabras')}</p>
          <button type="button" className={BOTON_SECUNDARIO} onClick={() => setHoja('kit')}>{t('hb_kit')}</button>
        </div>
      );
    }

    const total = estado ? estado.confirmadoSats + estado.pendienteSats : 0;
    const plazo = estado?.plazo ?? null;
    const aviso = plazo ? AVISO[plazo.nivel] : null;
    const nombre = boveda.nombreDelHeredero || rellenar(t('hb_heredero_sin_nombre'), { huella: boveda.heredero.huella });

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uv-text-muted">{t('hb_saldo')}</p>
            <p className="text-2xl font-extrabold tabular-nums uv-text-primary">
              {estado ? satsABtc(estado.confirmadoSats) : errorDeRed ? '—' : '…'} <span className="text-sm font-bold uv-text-secondary">BTC</span>
            </p>
            {estado && estado.pendienteSats > 0 && (
              <p className="text-xs tabular-nums uv-text-muted">{rellenar(t('hb_en_camino'), { sats: numero(estado.pendienteSats) })}</p>
            )}
          </div>
          <button type="button" className="kp-foco rounded-lg p-2 uv-text-secondary disabled:opacity-50" aria-label={t('bp_actualizar')} disabled={leyendo} onClick={refrescar}>
            <Icons.RefreshCw size={18} aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Icons.User size={16} className="shrink-0 uv-text-secondary" aria-hidden />
          <span className="uv-text-secondary">{t('hb_heredero')}:</span>
          <span className="min-w-0 truncate font-semibold uv-text-primary">{nombre}</span>
        </div>

        {errorDeRed && (
          <p role="alert" className="text-sm font-semibold text-[var(--color-danger)]">{t('hb_err_lectura')}</p>
        )}

        {plazo && aviso && (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full uv-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.round(plazo.fraccion * 100))} aria-label={t('hb_plazo_barra')}>
              <div className={`h-full rounded-full ${aviso.barra}`} style={{ width: `${Math.min(100, Math.max(2, plazo.fraccion * 100))}%` }} />
            </div>
            <p className={`rounded-xl p-3 text-sm ${aviso.clase}`} role={plazo.nivel === 'tranquilo' ? undefined : 'status'}>
              {rellenar(t(aviso.llave), { dias: numero(diasAproximados(plazo.bloquesQueFaltan)) })}
            </p>
          </div>
        )}
        {estado && !plazo && estado.pendienteSats > 0 && (
          <p className="rounded-xl uv-surface-2 p-3 text-sm uv-text-secondary">{t('hb_plazo_pendiente')}</p>
        )}
        {estado && total === 0 && <p className="text-sm uv-text-secondary">{t('hb_vacia')}</p>}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={BOTON_PRINCIPAL} disabled={!estado || !btc} onClick={() => setHoja('llenar')}>
            <span className="inline-flex items-center gap-2"><Icons.Receive size={18} aria-hidden /> {t('hb_llenar')}</span>
          </button>
          <button type="button" className={BOTON_SECUNDARIO} disabled={!estado || estado.confirmadoSats === 0} onClick={() => setHoja('renovar')}>
            <span className="inline-flex items-center gap-2"><Icons.RefreshCw size={18} aria-hidden /> {t('hb_renovar')}</span>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={BOTON_SECUNDARIO} onClick={() => setHoja('kit')}>
            <span className="inline-flex items-center gap-2"><Icons.FileText size={18} aria-hidden /> {t('hb_kit')}</span>
          </button>
          <button type="button" className={BOTON_SECUNDARIO} disabled={!estado || estado.confirmadoSats === 0 || !btc} onClick={() => setHoja('sacar')}>
            <span className="inline-flex items-center gap-2"><Icons.Send size={18} aria-hidden /> {t('hb_sacar')}</span>
          </button>
        </div>
        <p className="text-xs uv-text-muted">{rellenar(t('hb_tope'), { btc: satsABtc(TOPE_POR_BOVEDA_SATS) })}</p>
        {estado && total === 0 && (
          <button type="button" className="kp-foco w-full py-2 text-sm font-semibold text-[var(--color-danger)]" onClick={() => setHoja('quitar')}>
            {t('hb_quitar')}
          </button>
        )}
      </div>
    );
  };

  return (
    <section className={`${TARJETA} space-y-4 p-5`} aria-labelledby="hb-titulo">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full uv-surface-2 uv-text-primary">
          <Icons.Users size={20} aria-hidden />
        </span>
        <h3 id="hb-titulo" className="min-w-0 flex-1 font-bold uv-text-primary">{t('hb_titulo')}</h3>
      </div>
      {cuerpo()}

      <HojaCrearHerencia
        abierta={hoja === 'crear'}
        onClose={cerrar}
        userId={userId}
        miLlave={miLlave}
        onCreada={async () => { await cargar(); setHoja('kit'); }}
      />
      <HojaSerHeredero abierta={hoja === 'heredero'} onClose={cerrar} miLlave={miLlave} />
      {boveda && <HojaKitHerencia abierta={hoja === 'kit'} onClose={cerrar} boveda={boveda} />}
      {boveda && estado && (
        <>
          <HojaLlenarHerencia abierta={hoja === 'llenar'} onClose={cerrar} boveda={boveda} estado={estado} btc={btc} onHecho={refrescar} />
          <HojaMoverHerencia
            modo={hoja === 'sacar' ? 'sacar' : 'renovar'}
            abierta={hoja === 'renovar' || hoja === 'sacar'}
            onClose={cerrar}
            boveda={boveda}
            estado={estado}
            semilla={semilla}
            btc={btc}
            red={red}
            onHecho={refrescar}
          />
          <HojaQuitarHerencia
            abierta={hoja === 'quitar'}
            onClose={cerrar}
            userId={userId}
            vacia={estado.confirmadoSats + estado.pendienteSats === 0}
            onQuitada={async () => { setHoja(null); setEstado(null); await cargar(); }}
          />
        </>
      )}
    </section>
  );
}
