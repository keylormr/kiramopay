import { useId } from 'react';
import { Icons } from '../../components/Icons';
import { useLanguage } from '../../i18n/LanguageContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import type { EstadoAvisos } from '@/utils/avisosPush';
import type { TranslationKeys } from '../../i18n/translations';

const CLAVE_DE_ESTADO: Record<EstadoAvisos, keyof TranslationKeys> = {
  cargando: 'loading',
  no_soportado: 'push_unsupported',
  sin_configurar: 'push_unavailable',
  bloqueado: 'push_blocked',
  inactivo: 'push_off',
  activo: 'push_on',
};

/**
 * La fila de Notificaciones de Perfil. Antes era un interruptor que cambiaba
 * una preferencia que nada leia: se encendia y se apagaba sin efecto. Ahora
 * activa de verdad los avisos del sistema en este dispositivo, y donde no se
 * puede (la app de Android, un navegador sin Push API, el permiso bloqueado)
 * lo dice en vez de fingir.
 */
export function AvisosDelDispositivo() {
  const { estado, ocupado, fallo, alternar } = usePushNotifications();
  return <FilaDeAvisos estado={estado} ocupado={ocupado} fallo={fallo} onAlternar={() => void alternar()} />;
}

interface FilaDeAvisosProps {
  estado: EstadoAvisos;
  ocupado: boolean;
  fallo: boolean;
  onAlternar: () => void;
}

/** La fila sin logica: lo que se ve en cada estado. */
export function FilaDeAvisos({ estado, ocupado, fallo, onAlternar }: FilaDeAvisosProps) {
  const { t } = useLanguage();
  const idDetalle = useId();
  const conmutable = estado === 'activo' || estado === 'inactivo';
  const encendido = estado === 'activo';
  const detalle = fallo ? t('push_failed') : t(CLAVE_DE_ESTADO[estado]);

  const icono = (
    <div className="w-10 h-10 bg-pink-100 dark:bg-pink-900/30 rounded-xl flex items-center justify-center mr-3 shrink-0">
      {encendido ? (
        <Icons.Bell size={18} className="text-pink-600" />
      ) : (
        <Icons.BellOff size={18} className="text-pink-600" />
      )}
    </div>
  );
  const textos = (
    <div className="flex-1 text-left min-w-0 pr-3">
      <p className="font-semibold uv-text-primary text-sm">{t('notifications_setting')}</p>
      <p
        id={idDetalle}
        aria-live="polite"
        className={`text-xs mt-0.5 ${fallo ? 'text-[var(--color-danger)]' : 'uv-text-muted'}`}
      >
        {detalle}
      </p>
    </div>
  );

  if (!conmutable) {
    return (
      <div className="w-full flex items-center px-4 py-3.5" aria-busy={estado === 'cargando'}>
        {icono}
        {textos}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={encendido}
      aria-label={t('notifications_setting')}
      aria-describedby={idDetalle}
      aria-busy={ocupado}
      disabled={ocupado}
      onClick={onAlternar}
      className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors disabled:opacity-60"
    >
      {icono}
      {textos}
      <div
        aria-hidden="true"
        className={`w-12 h-7 rounded-full p-1 shrink-0 transition-colors ${encendido ? 'bg-pink-500' : 'bg-gray-300 dark:bg-slate-600'}`}
      >
        <div
          className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
            encendido ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </div>
    </button>
  );
}
