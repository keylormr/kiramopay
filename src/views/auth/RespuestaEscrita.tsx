import React, { useEffect, useId, useState } from 'react';
import { Icons } from '../../components/Icons';
import { useLanguage } from '../../i18n/LanguageContext';
import { fechaLarga } from '@/utils/planes';

// Lo que la Ley 7786 obliga a conservar se guarda cinco anos despues del cierre:
// el mismo plazo que dice el correo (el servidor lo calcula con AddDate).
const ANOS_DE_CONSERVACION = 5;

/** El dia 30 mas el plazo de conservacion, en ISO; '' si la fecha no sirve. */
export function conservaHastaDe(seEliminaEl: string): string {
  const d = new Date(seEliminaEl);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCFullYear(d.getUTCFullYear() + ANOS_DE_CONSERVACION);
  return d.toISOString();
}

interface RespuestaEscritaProps {
  /** El dia 30, en ISO. Sin una fecha valida no se pinta nada. */
  seEliminaEl: string | null | undefined;
  className?: string;
}

/**
 * La respuesta escrita a la solicitud de eliminacion (Ley 8968 art. 7): que se
 * suprime y cuando, que se conserva por ley y hasta cuando, como reactivarla y
 * el derecho a acudir a la PRODHAB. Es la misma que sale por correo; en pantalla
 * queda aunque el correo tarde, y se puede copiar para guardarla.
 */
export const RespuestaEscrita: React.FC<RespuestaEscritaProps> = ({ seEliminaEl, className = '' }) => {
  const { t, language } = useLanguage();
  const idTitulo = useId();
  const [copiada, setCopiada] = useState(false);

  useEffect(() => {
    if (!copiada) return;
    const timer = setTimeout(() => setCopiada(false), 2500);
    return () => clearTimeout(timer);
  }, [copiada]);

  const dia30 = fechaLarga(seEliminaEl, language);
  const hasta = seEliminaEl ? fechaLarga(conservaHastaDe(seEliminaEl), language) : '';
  if (!dia30 || !hasta) return null;

  const parrafos = [
    t('resp_erased').replace('{date}', dia30),
    t('resp_kept').replace('{until}', hasta),
    t('resp_reactivate').replace('{date}', dia30),
    t('resp_rights'),
    t('resp_by_email'),
  ];

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText([t('resp_title'), ...parrafos].join('\n\n'));
      setCopiada(true);
    } catch {
      /* sin portapapeles: la respuesta sigue en pantalla y llega por correo */
    }
  };

  return (
    <section
      aria-labelledby={idTitulo}
      className={`rounded-2xl border border-[var(--color-border-dark)] bg-[var(--color-surface-2-dark)] p-4 ${className}`}
    >
      <h2 id={idTitulo} className="font-bold text-white">
        {t('resp_title')}
      </h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--color-text-secondary-dark)]">
        {parrafos.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void copiar()}
        className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--color-primary)] hover:bg-white/10 transition-colors"
      >
        {copiada ? <Icons.Check size={16} aria-hidden="true" /> : <Icons.Copy size={16} aria-hidden="true" />}
        {copiada ? t('resp_copied') : t('resp_copy')}
      </button>
    </section>
  );
};
