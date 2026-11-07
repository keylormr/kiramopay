import React from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { IconosLinea } from '@/components/Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatMoney } from '@/utils/money';
import { partesDelMonto } from '@/utils/partesDelMonto';
import { iniciales } from '@/utils/arteDelMovimiento';
import { rellenar } from '@/utils/planes';

// Revisar antes de enviar un SINPE, como en el tablero "Enviar" del concepto: a
// quien, cuanto, y que va a pasar (cuanto recibe, la comision, el saldo que
// queda y cuando llega). Mover dinero no se deshace: esta hoja es la pausa.
//
// Lo que dice es lo que hace el servidor hoy (backend/internal/sinpe/service.go):
// solo se envia a cuentas de KiramoPay, sin comision (`const fee int64 = 0`) y
// con el credito en la misma transaccion. Si eso cambia, cambia esta hoja.

interface HojaRevisarEnvioProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  procesando: boolean;
  /** Como se llama quien recibe: el contacto guardado, o el telefono. */
  nombre: string;
  /** El telefono ya formateado (8812-4471). */
  telefono: string;
  monto: number;
  /** Saldo en colones antes de enviar. */
  saldo: number;
  referencia?: string;
}

export const HojaRevisarEnvio: React.FC<HojaRevisarEnvioProps> = ({
  isOpen,
  onClose,
  onConfirm,
  procesando,
  nombre,
  telefono,
  monto,
  saldo,
  referencia,
}) => {
  const { t } = useLanguage();
  const partes = partesDelMonto(monto, 'CRC');
  const crc = (v: number) => formatMoney(v, 'CRC', { decimals: 2 });
  const esTelefono = nombre === telefono;
  const cara = esTelefono ? '' : iniciales(nombre);
  const primerNombre = esTelefono ? nombre : nombre.trim().split(/\s+/)[0];

  const filas: { clave: string; etiqueta: string; valor: string; nota?: string; tono?: 'exito' }[] = [
    {
      clave: 'recibe',
      // Sin nombre (un numero tecleado) no se repite el telefono en la fila.
      etiqueta: esTelefono ? t('envio_recibe_sin_nombre') : rellenar(t('envio_recibe'), { nombre: primerNombre }),
      valor: crc(monto),
    },
    { clave: 'comision', etiqueta: t('envio_comision'), valor: crc(0), nota: t('envio_sin_comision'), tono: 'exito' },
    { clave: 'saldo', etiqueta: t('envio_tu_saldo'), valor: `${crc(saldo)} → ${crc(saldo - monto)}` },
    { clave: 'llega', etiqueta: t('envio_llega'), valor: t('envio_al_instante') },
    ...(referencia ? [{ clave: 'detalle', etiqueta: t('detail_optional'), valor: referencia }] : []),
  ];

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('envio_revisar_titulo')} dismissable={!procesando}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center pt-1 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-[var(--color-surface-2)] text-xl font-semibold uv-text-primary shadow-[inset_0_0_0_1px_var(--color-border-strong)] dark:bg-[var(--color-surface-2-dark)] dark:shadow-[inset_0_0_0_1px_var(--color-border-strong-dark)]">
            {cara ? <span aria-hidden="true">{cara}</span> : <IconosLinea.Sinpe size={28} />}
          </div>
          <p className="mt-3 max-w-full break-words text-[17px] font-semibold uv-text-primary">{nombre}</p>
          {!esTelefono && <p className="kp-num mt-1 text-[13px] uv-text-secondary">{telefono}</p>}
          <p className="mt-0.5 text-[13px] uv-text-muted">{t('sinpe_mobile')}</p>
          <p className="kp-num mt-5 whitespace-nowrap font-semibold leading-none tracking-[-0.035em] uv-text-primary">
            <span className="mr-0.5 align-[0.4em] text-[26px] uv-text-secondary">{partes.simbolo}</span>
            <span className="text-5xl">{partes.entero}</span>
            <span className="text-[26px] uv-text-muted">{partes.decimales}</span>
          </p>
        </div>

        <dl className="rounded-[20px] border border-[var(--color-border)] uv-surface-2 px-4 py-1.5 dark:border-[var(--color-border-dark)]">
          {filas.map((f, i) => (
            <div
              key={f.clave}
              className={`flex items-start justify-between gap-3 py-3 ${i < filas.length - 1 ? 'border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]' : ''}`}
            >
              <dt className="shrink-0 text-sm uv-text-secondary">{f.etiqueta}</dt>
              <dd className="min-w-0 text-right">
                <span
                  className={`kp-num block break-words text-sm font-semibold ${
                    f.tono === 'exito' ? 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]' : 'uv-text-primary'
                  }`}
                >
                  {f.valor}
                </span>
                {f.nota && <span className="mt-0.5 block text-xs uv-text-muted">{f.nota}</span>}
              </dd>
            </div>
          ))}
        </dl>

        <button
          type="button"
          onClick={onConfirm}
          disabled={procesando}
          aria-busy={procesando}
          className="kp-toque kp-foco flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-[var(--color-primary-fill)] text-base font-semibold text-white shadow-[0_10px_22px_-10px_rgba(45,123,255,0.75)] hover:bg-[var(--color-primary-hover)] disabled:opacity-80"
        >
          {procesando ? (
            <>
              <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {t('envio_enviando')}
            </>
          ) : (
            rellenar(t('envio_enviar_monto'), { monto: crc(monto) })
          )}
        </button>
      </div>
    </BottomSheet>
  );
};
