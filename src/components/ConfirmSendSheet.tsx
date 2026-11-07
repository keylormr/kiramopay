import React from 'react';
import { BottomSheet } from './BottomSheet';
import { Icons } from './Icons';
import {
  BotonDeRevision,
  BotonSecundarioDeRevision,
  CantidadGrande,
  CaraDeRevision,
  CifraGrande,
  FilasDeRevision,
  type FilaDeRevision,
} from './envio/PiezasDeRevision';
import { useLanguage } from '@/i18n/LanguageContext';
import { iniciales } from '@/utils/arteDelMovimiento';
import type { CurrencyCode } from '@/utils/money';

interface Row {
  label: string;
  value: string;
  /** Una linea chica bajo el valor ("la paga quien envia"). */
  note?: string;
  tone?: 'exito' | 'peligro';
}

interface ConfirmSendSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Monto en dinero (colones, dolares), dibujado en grande. */
  amount?: number;
  currency?: CurrencyCode;
  /** Una cantidad que no es dinero (0.0050125 BTC): la cifra y su unidad. */
  quantity?: { value: string; unit: string };
  /** Texto ya formateado, si no hay amount ni quantity. */
  amountDisplay?: string;
  /** Quien recibe: va arriba, antes del monto (a quien, despues cuanto). */
  recipient?: string;
  /** Una linea bajo el nombre (la red, el canal). */
  recipientDetail?: string;
  /** La placa de arriba: un logo o un icono. Sin ella, las iniciales de quien recibe. */
  face?: React.ReactNode;
  /** Lo que va a pasar, con las etiquetas ya traducidas. */
  rows: Row[];
  processing?: boolean;
  /** Aviso en amarillo (por ejemplo, que no se deshace). */
  warning?: string;
  title?: string;
  /** Lo que hace el boton, con la cifra ("Enviar 0.005 BTC"). */
  confirmLabel?: string;
}

/**
 * Revisar antes de mover dinero, con la forma de la revision de SINPE del
 * rediseno (HojaRevisarEnvio): a quien, cuanto en grande, que va a pasar, un
 * aviso si hace falta y un solo boton que dice lo que hace. Mover dinero no se
 * deshace en el libro: esta hoja es la pausa. La usa el envio de cripto.
 */
export const ConfirmSendSheet: React.FC<ConfirmSendSheetProps> = ({
  isOpen,
  onClose,
  onConfirm,
  amount,
  currency = 'CRC',
  quantity,
  amountDisplay,
  recipient,
  recipientDetail,
  face,
  rows,
  processing = false,
  warning,
  title,
  confirmLabel,
}) => {
  const { t } = useLanguage();
  const filas: FilaDeRevision[] = rows.map((r) => ({ clave: r.label, etiqueta: r.label, valor: r.value, nota: r.note, tono: r.tone }));
  const cara = face ?? (recipient ? <span aria-hidden="true">{iniciales(recipient)}</span> : null);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title || t('envio_revisar_titulo')} dismissable={!processing}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center pt-1 text-center">
          {cara && <CaraDeRevision>{cara}</CaraDeRevision>}
          {recipient && <p className="mt-3 max-w-full break-words text-[17px] font-semibold uv-text-primary">{recipient}</p>}
          {recipientDetail && <p className="mt-0.5 text-[13px] uv-text-muted">{recipientDetail}</p>}
          <div className="mt-5 w-full">
            {quantity ? (
              <CantidadGrande cantidad={quantity.value} unidad={quantity.unit} />
            ) : amountDisplay !== undefined ? (
              <p className="kp-num text-4xl font-semibold tracking-[-0.03em] uv-text-primary">{amountDisplay}</p>
            ) : (
              <CifraGrande valor={amount ?? 0} moneda={currency} />
            )}
          </div>
        </div>

        <FilasDeRevision filas={filas} />

        {warning && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-[var(--color-warning-soft)] p-3.5">
            <Icons.AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--color-warning-strong)] dark:text-[var(--color-warning-strong-dark)]" />
            <p className="text-[13px] leading-relaxed uv-text-primary">{warning}</p>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <BotonDeRevision
            onClick={onConfirm}
            procesando={processing}
            etiqueta={confirmLabel || t('confirm')}
            etiquetaProcesando={t('processing')}
          />
          <BotonSecundarioDeRevision onClick={onClose} disabled={processing}>{t('cancel')}</BotonSecundarioDeRevision>
        </div>
      </div>
    </BottomSheet>
  );
};
