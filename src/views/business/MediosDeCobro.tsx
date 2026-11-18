import React, { useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { MediosDeCobro } from '@/api/repositories/qrpayment.repository';
import { mensajeDeRechazo } from '@/i18n/mensajesDeError';
import {
  CLAVES_DEL_RECHAZO_DE_MEDIOS,
  normalizarSinpeMovil,
  pareceDireccionLightning,
  sinpeMovilLegible,
} from '@/utils/lightning';

const CAMPO =
  'w-full min-h-11 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent px-3 text-sm uv-text-primary outline-none focus:border-[var(--color-primary)]';

/**
 * Ajustes > Cobrar fuera de KiramoPay. La direccion Lightning de la billetera
 * propia del comercio y su SINPE Movil. Todo el equipo los ve; solo el dueno
 * los cambia (el servidor lo hace cumplir).
 */
export const SeccionMediosDeCobro: React.FC<{ merchantId: string }> = ({ merchantId }) => {
  const { t } = useLanguage();
  const idTitulo = useId();
  // undefined = cargando; null = no se pudo leer.
  const [medios, setMedios] = useState<MediosDeCobro | null | undefined>(undefined);
  const [intento, setIntento] = useState(0);
  const [editando, setEditando] = useState(false);
  const [direccion, setDireccion] = useState('');
  const [sinpe, setSinpe] = useState('');
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const api = getApiLayer().qrPayments;
    if (!api) return;
    let cancelado = false;
    void Promise.resolve()
      .then(() => api.getPaymentMethods(merchantId))
      .then((res) => {
        if (!cancelado) setMedios(res.success && res.data ? res.data : null);
      })
      .catch(() => {
        if (!cancelado) setMedios(null);
      });
    return () => {
      cancelado = true;
    };
  }, [merchantId, intento]);

  if (medios === undefined) return null;

  if (medios === null) {
    return (
      <div className="uv-surface-1 rounded-2xl uv-shadow-soft flex items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm uv-text-muted">{t('mc_err_lectura')}</p>
        <Button variant="ghost" size="sm" onClick={() => { setMedios(undefined); setIntento((n) => n + 1); }}>
          {t('error_retry')}
        </Button>
      </div>
    );
  }

  // Con la bandera cerrada y sin numero, un cajero no tiene nada que ver aca.
  if (!medios.lightningHabilitado && !medios.sinpeMovil && !medios.puedeEditar) return null;

  const abrir = () => {
    setDireccion(medios.lightningAddress ?? '');
    setSinpe(medios.sinpeMovil ? sinpeMovilLegible(medios.sinpeMovil) : '');
    setError('');
    setEditando(true);
  };

  const guardar = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || guardandoRef.current) return;
    const dir = direccion.trim();
    const numero = sinpe.trim();
    // Lo que de seguro se rechaza no viaja; si responde lo decide el servidor.
    if (medios.lightningHabilitado && dir !== '' && !pareceDireccionLightning(dir)) {
      setError(t('mc_err_direccion'));
      return;
    }
    if (numero !== '' && !normalizarSinpeMovil(numero)) {
      setError(t('mc_err_sinpe'));
      return;
    }
    // Solo viaja lo que cambio: lo demas el servidor lo deja como esta.
    const cambios: { lightningAddress?: string; sinpeMovil?: string } = {};
    if (medios.lightningHabilitado && dir.toLowerCase() !== (medios.lightningAddress ?? '')) cambios.lightningAddress = dir;
    if ((numero === '' ? '' : normalizarSinpeMovil(numero)) !== (medios.sinpeMovil ?? '')) cambios.sinpeMovil = numero;
    if (Object.keys(cambios).length === 0) {
      setEditando(false);
      return;
    }
    guardandoRef.current = true;
    setGuardando(true);
    setError('');
    try {
      const res = await api.updatePaymentMethods(merchantId, cambios);
      if (res.success && res.data) {
        setMedios(res.data);
        setEditando(false);
      } else {
        setError(mensajeDeRechazo(res.error, CLAVES_DEL_RECHAZO_DE_MEDIOS, 'mc_err_guardar', t));
      }
    } catch {
      setError(t('mc_err_guardar'));
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  const fila = (rotulo: string, valor: string | undefined, vacio: string) => (
    <div className="flex justify-between gap-3 px-4 py-3">
      <span className="text-sm uv-text-muted shrink-0">{rotulo}</span>
      <span className={`text-sm text-right break-all ${valor ? 'font-semibold uv-text-primary' : 'uv-text-muted'}`}>
        {valor ?? vacio}
      </span>
    </div>
  );

  return (
    <section aria-labelledby={idTitulo} className="uv-surface-1 rounded-2xl uv-shadow-soft overflow-hidden">
      <h3 id={idTitulo} className="px-4 pt-3.5 pb-1 text-xs font-semibold uv-text-muted">
        {t('mc_titulo')}
      </h3>
      <div className="divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
        {medios.lightningHabilitado && fila(t('mc_lightning'), medios.lightningAddress, t('mc_sin_conectar'))}
        {fila(t('mc_sinpe'), medios.sinpeMovil ? sinpeMovilLegible(medios.sinpeMovil) : undefined, t('mc_sin_numero'))}
      </div>
      <div className="px-4 pt-1 pb-3.5 space-y-2.5">
        <p className="text-xs leading-relaxed uv-text-muted">
          {t(medios.lightningHabilitado ? 'mc_ayuda' : 'mc_ayuda_sinpe')}
        </p>
        {medios.puedeEditar ? (
          <Button variant="secondary" onClick={abrir} fullWidth leftIcon={<Icons.Edit size={18} />}>
            {t('mc_editar')}
          </Button>
        ) : (
          <p className="text-xs uv-text-muted">{t('mc_solo_dueno')}</p>
        )}
      </div>

      <BottomSheet isOpen={editando} onClose={() => setEditando(false)} title={t('mc_editar')}>
        <div className="space-y-4">
          {medios.lightningHabilitado && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium uv-text-secondary">{t('mc_lightning')}</span>
              <input
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="nombre@breez.tips"
                maxLength={320}
                className={CAMPO}
              />
              <span className="mt-1 block text-xs leading-relaxed uv-text-muted">{t('mc_lightning_ayuda')}</span>
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium uv-text-secondary">{t('mc_sinpe')}</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={sinpe}
              onChange={(e) => setSinpe(e.target.value)}
              placeholder="8888-7777"
              maxLength={20}
              className={CAMPO}
            />
            <span className="mt-1 block text-xs leading-relaxed uv-text-muted">{t('mc_sinpe_ayuda')}</span>
          </label>
          <p className="text-xs uv-text-muted">{t('mc_vacio_quita')}</p>
          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]">
              {error}
            </p>
          )}
          <Button onClick={() => void guardar()} loading={guardando} disabled={guardando} size="lg" fullWidth>
            {guardando ? t('loading') : t('save')}
          </Button>
        </div>
      </BottomSheet>
    </section>
  );
};
