import type { ReactNode } from 'react';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import type { DestinatarioRegistrado } from '@/hooks/useDestinatarioRegistrado';

/**
 * Una sola pasada y con funcion de reemplazo: el nombre registrado lo escribio
 * una persona, y con replace(texto, cadena) un "$&" o un "$'" se interpretan.
 */
function conNombre(plantilla: string, nombre: string): string {
  return plantilla.replace(/\{nombre\}/g, () => nombre);
}

interface LineaProps {
  estado: DestinatarioRegistrado;
  /** Lo que se dice cuando el servidor no aporta un nombre (guardado, sin verificar). */
  porDefecto: ReactNode;
  className?: string;
}

/**
 * La linea bajo el telefono: que se sabe de la persona. Con el nombre REGISTRADO
 * en KiramoPay dice "Registrado en KiramoPay como Keilor M. R."; mientras
 * consulta lo dice; y en cualquier otro caso (sin red, limite de consultas,
 * contacto ya guardado) queda el texto de siempre, sin afirmar nada de mas.
 */
export function LineaDelDestinatario({ estado, porDefecto, className = 'text-xs uv-text-muted mt-0.5' }: LineaProps) {
  const { t } = useLanguage();
  if (estado.fase === 'registrado') {
    return (
      <p className={`${className} flex items-center gap-1 font-semibold text-[var(--color-success)]`}>
        <Icons.CheckCircle size={14} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{conNombre(t('dest_registrado'), estado.nombre)}</span>
      </p>
    );
  }
  if (estado.fase === 'consultando') {
    return <p className={className} role="status">{t('dest_verificando')}</p>;
  }
  return <p className={className}>{porDefecto}</p>;
}

interface AvisoProps {
  tipo: 'no_coincide' | 'sin_cuenta';
  /** Con el boton "El numero es correcto" cuando hay que confirmar antes de enviar. */
  onConfirmar?: () => void;
  confirmado?: boolean;
}

/**
 * Lo que el nombre registrado le dice a quien paga. `no_coincide`: el QR dice
 * otro nombre que el registrado a ese numero (se pide confirmar). `sin_cuenta`:
 * el numero no tiene cuenta de KiramoPay y no se le puede enviar (sin salida).
 */
export function AvisoDelDestinatario({ tipo, onConfirmar, confirmado }: AvisoProps) {
  const { t } = useLanguage();
  const duro = tipo === 'sin_cuenta';
  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-2xl p-4 text-left ${duro ? 'bg-[var(--color-danger-soft)]' : 'bg-[var(--color-warning-soft)]'}`}
    >
      <Icons.AlertCircle
        size={20}
        className={`mt-0.5 shrink-0 ${duro ? 'text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]' : 'text-[var(--color-warning-strong)] dark:text-[var(--color-warning-strong-dark)]'}`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-sm font-bold uv-text-primary">{t(duro ? 'dest_sin_cuenta' : 'dest_no_coincide')}</p>
        {onConfirmar && !confirmado && (
          <button
            type="button"
            onClick={onConfirmar}
            className="mt-2 min-h-11 text-sm font-bold text-[var(--color-primary)] dark:text-[var(--color-primary-light)] hover:underline uv-focus-ring rounded-md"
          >
            {t('contact_homonym_confirm')}
          </button>
        )}
      </div>
    </div>
  );
}
