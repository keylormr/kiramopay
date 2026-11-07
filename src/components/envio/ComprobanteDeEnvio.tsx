import React from 'react';
import type { SinpeTransaction } from '@/types';
import { Icons } from '@/components/Icons';
import { Ilustracion3D } from '@/components/arte3d/Arte3D';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatMoney } from '@/utils/money';
import { formatearTelefonoCR } from '@/utils/telefono';
import { localeDe } from '@/utils/periodos';
import { rellenar } from '@/utils/planes';

// Lo que queda despues de enviar: el estado (llego, ya estaba hecho o quedo
// pendiente) y el comprobante con el numero de la transaccion, para compartirlo
// o guardarlo. Tres casos, cada uno con su titulo:
//  - llego (cuenta de KiramoPay): la ilustracion de envio listo;
//  - ya estaba hecho (la misma llave): sin celebrar, el visto de siempre;
//  - pendiente (internal === false, envios a otros bancos que todavia no salen):
//    el reloj en amarillo, nunca el visto verde.

interface ComprobanteDeEnvioProps {
  envio: SinpeTransaction;
  yaEstabaHecho: boolean;
  onCompartir: () => void;
  onListo: () => void;
}

export const ComprobanteDeEnvio: React.FC<ComprobanteDeEnvioProps> = ({ envio, yaEstabaHecho, onCompartir, onListo }) => {
  const { t, language } = useLanguage();
  const pendiente = envio.internal === false;
  // Sin nombre, el envio trae el telefono en su lugar: se escribe como telefono
  // y no se repite en la fila "Enviado a".
  const esTelefono = /^[+\d\s()-]+$/.test(envio.name.trim());
  const telefono = formatearTelefonoCR(envio.phone);
  const nombre = esTelefono ? formatearTelefonoCR(envio.name) || telefono : envio.name;
  const primerNombre = esTelefono ? nombre : nombre.trim().split(/\s+/)[0] || nombre;

  // La fecha es la de esta pantalla, no la del servidor (la respuesta del
  // envio no la trae). Si el envio ya estaba hecho, salio antes: poner la hora
  // de ahora en una constancia que se comparte seria falso, asi que no va.
  let cuando = '';
  const fecha = envio.dateISO && !yaEstabaHecho ? new Date(envio.dateISO) : null;
  if (fecha && !Number.isNaN(fecha.getTime())) {
    try {
      cuando = new Intl.DateTimeFormat(localeDe(language), { dateStyle: 'medium', timeStyle: 'short' }).format(fecha);
    } catch {
      cuando = fecha.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  const titulo = pendiente
    ? t('sinpe_external_pending_title')
    : yaEstabaHecho
      ? t('sinpe_ya_hecho')
      : rellenar(t('envio_le_llego'), { nombre: primerNombre });
  const texto = pendiente ? t('sinpe_external_pending_desc') : yaEstabaHecho ? t('sinpe_ya_hecho_desc') : '';

  const filas: { clave: string; etiqueta: string; valor: React.ReactNode }[] = [
    ...(esTelefono ? [] : [{ clave: 'para', etiqueta: t('sent_to_label'), valor: nombre }]),
    { clave: 'telefono', etiqueta: t('phone'), valor: <span className="kp-num">{telefono}</span> },
    ...(envio.reference ? [{ clave: 'detalle', etiqueta: t('detail'), valor: envio.reference }] : []),
    ...(cuando ? [{ clave: 'fecha', etiqueta: t('date'), valor: <span className="kp-num">{cuando}</span> }] : []),
    ...(envio.id
      ? [{ clave: 'id', etiqueta: t('transaction_id'), valor: <span className="break-all font-mono text-xs">{envio.id}</span> }]
      : []),
  ];

  return (
    <div className="kp-aparece flex flex-col items-center pb-1 text-center">
      {pendiente ? (
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-warning-soft)]">
          <Icons.History size={40} className="text-[var(--color-warning-strong)] dark:text-[var(--color-warning-strong-dark)]" aria-hidden="true" />
        </div>
      ) : yaEstabaHecho ? (
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-success-soft)]">
          <Icons.CheckCircle size={40} className="text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]" aria-hidden="true" />
        </div>
      ) : (
        <Ilustracion3D nombre="envioListo" tamano={148} prioritaria />
      )}

      <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] uv-text-primary text-balance">{titulo}</h2>
      <p className="kp-num mt-2 text-[28px] font-semibold tracking-[-0.03em] uv-text-primary">
        {formatMoney(envio.amount, 'CRC', { decimals: 2 })}
      </p>
      {texto && <p className="mt-2 max-w-sm text-sm uv-text-secondary">{texto}</p>}

      <dl className="mt-5 w-full rounded-[20px] border border-[var(--color-border)] uv-surface-2 px-4 py-1.5 text-left dark:border-[var(--color-border-dark)]">
        {filas.map((f, i) => (
          <div
            key={f.clave}
            className={`flex items-start justify-between gap-4 py-3 ${i < filas.length - 1 ? 'border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]' : ''}`}
          >
            <dt className="shrink-0 text-sm uv-text-secondary">{f.etiqueta}</dt>
            <dd className="min-w-0 text-right text-sm font-semibold uv-text-primary break-words">{f.valor}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onCompartir}
          className="kp-toque kp-foco flex h-[52px] items-center justify-center gap-2 rounded-2xl border border-[var(--color-border-strong)] uv-surface-1 text-[15px] font-semibold text-[var(--color-primary)] dark:border-[var(--color-border-strong-dark)] dark:text-[var(--color-primary-light)]"
        >
          <Icons.Share size={18} aria-hidden="true" />
          {t('share')}
        </button>
        <button
          type="button"
          onClick={onListo}
          className="kp-toque kp-foco h-[52px] rounded-2xl bg-[var(--color-primary-fill)] text-[15px] font-semibold text-white hover:bg-[var(--color-primary-hover)]"
        >
          {t('done')}
        </button>
      </div>
    </div>
  );
};
