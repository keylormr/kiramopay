import React from 'react';
import { IconosLinea } from '@/components/Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { useSettingsStore } from '@/stores/settings.store';

// Ocultar montos fuera del Inicio. Es la MISMA preferencia que el ojo de la
// tarjeta de saldo (`saldoOculto` en settings.store, del dispositivo): quien
// la tapa en el Inicio no vuelve a ver sus cifras al abrir Movimientos, Metas
// o Cripto, y la puede destapar desde cualquiera de esas pantallas.
//
// Se tapan saldos y montos de listas (lo que alguien ve por encima del hombro).
// No se tapa lo que la persona esta tecleando ni lo que confirma antes de mover
// dinero: ahi necesita ver la cifra para no equivocarse.

/** true si la persona eligio ocultar sus montos. */
export function useMontosOcultos(): boolean {
  return useSettingsStore((s) => s.saldoOculto);
}

interface MontoProps {
  /** El monto ya formateado (o un nodo con el), visible cuando no se oculta. */
  children: React.ReactNode;
  /** Forzar el estado; por defecto sigue la preferencia. */
  oculto?: boolean;
  /** Los puntos que reemplazan la cifra (mas en una cifra grande). */
  puntos?: string;
  className?: string;
}

/**
 * Un monto que respeta la preferencia: oculto, el lector de pantalla oye
 * "Monto oculto" y la vista ve puntos.
 */
export const Monto: React.FC<MontoProps> = ({ children, oculto, puntos = '••••', className }) => {
  const { t } = useLanguage();
  const preferencia = useMontosOcultos();
  const tapar = oculto ?? preferencia;
  if (!tapar) return className ? <span className={className}>{children}</span> : <>{children}</>;
  return (
    <span className={className}>
      <span aria-hidden="true">{puntos}</span>
      <span className="sr-only">{t('monto_oculto')}</span>
    </span>
  );
};

interface BotonOcultarMontosProps {
  className?: string;
  /** Lado del icono en px. */
  tamano?: number;
  /** Sobre la tarjeta metal (oscura en los dos temas): letra clara. */
  sobreOscuro?: boolean;
}

/** El ojo: alterna la preferencia para toda la app. */
export const BotonOcultarMontos: React.FC<BotonOcultarMontosProps> = ({ className = '', tamano = 20, sobreOscuro = false }) => {
  const { t } = useLanguage();
  const oculto = useMontosOcultos();
  const alternar = useSettingsStore((s) => s.alternarSaldoOculto);
  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={oculto}
      aria-label={t('montos_ocultar')}
      title={t('montos_ocultar')}
      className={`kp-toque kp-foco flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
        sobreOscuro
          ? 'text-white/70 hover:bg-white/10 hover:text-white'
          : 'uv-text-secondary hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]'
      } ${className}`}
    >
      {oculto ? <IconosLinea.OjoTachado size={tamano} /> : <IconosLinea.Ojo size={tamano} />}
    </button>
  );
};
