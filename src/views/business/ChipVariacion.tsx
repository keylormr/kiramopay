import React from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

/**
 * La variacion contra el periodo anterior. El signo va escrito: el color solo no
 * le dice nada a quien no lo distingue. Sin porcentaje (el periodo anterior no
 * tuvo ventas) dice eso, no un 0% ni un infinito.
 */
export const ChipVariacion: React.FC<{ pct: number | null }> = ({ pct }) => {
  const { t } = useLanguage();
  if (pct === null) {
    return (
      <span className="rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-2 py-0.5 text-[11px] font-bold uv-text-muted">
        {t('business_report_compare_no_base')}
      </span>
    );
  }
  const valor = Number(pct.toFixed(2));
  const tono = valor > 0 ? 'uv-chip-success' : valor < 0 ? 'uv-chip-danger' : 'bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-secondary';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${tono}`}>
      {valor > 0 ? '+' : ''}
      {valor}%
    </span>
  );
};
