import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useApp } from '@/hooks/useApp';
import { Icons } from '@/components/Icons';
import { getApiLayer } from '@/api';
import type { QRMerchant, BusinessReport, BusinessReportBucket } from '@/api/repositories/qrpayment.repository';

interface Props {
  merchant: QRMerchant;
}

const RANGES = [7, 30, 90] as const;

/** Local YYYY-MM-DD for a date, matching the server's client-tz bucketing. */
const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The shop's numbers (owner/manager): headline totals, a single-series daily
 * bar chart, and the per-location / per-collector breakdowns built from the
 * attribution phase 3 records. One hue for one measure; text stays in ink
 * tokens; the grid is recessive.
 */
export const BusinessReportsView: React.FC<Props> = ({ merchant }) => {
  const { t } = useLanguage();
  const { state } = useApp();
  const symbol = (state.accounts.find((a) => a.ccy === state.baseCurrency) || state.accounts[0])?.symbol ?? '₡';
  const money = (v: number) => `${symbol}${v.toFixed(2)}`;

  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = getApiLayer().qrPayments;
      if (!api) return;
      const res = await api.getMerchantReport(merchant.id, days);
      if (cancelled) return;
      if (res.success && res.data) {
        setReport(res.data);
        setError('');
      } else {
        setError(res.error?.message || t('assistant_action_failed'));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [merchant.id, days, t]);

  // Zero-fill the window so every day gets a bar, sparse data included.
  const byDate = new Map((report?.daily ?? []).map((d) => [d.date, d]));
  const series: { date: string; net: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = localKey(d);
    series.push({ date: key, net: byDate.get(key)?.net ?? 0 });
  }
  const maxNet = Math.max(1, ...series.map((s) => s.net));

  const empty = !loading && (report?.totals.count ?? 0) === 0;

  const bucketRows = (buckets: BusinessReportBucket[], title: string) => {
    if (buckets.length === 0) return null;
    const maxBucket = Math.max(1, ...buckets.map((b) => b.net));
    return (
      <div>
        <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-2">{title}</h3>
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          {buckets.map((b) => (
            <div key={b.key ?? 'none'} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold uv-text-primary truncate">
                  {b.label || t('business_report_unattributed')}
                </p>
                <p className="text-sm font-bold uv-text-primary tabular-nums shrink-0">{money(b.net)}</p>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-1 rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)]"
                    style={{ width: `${Math.max(2, (b.net / maxBucket) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] uv-text-muted tabular-nums shrink-0">× {b.count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="pb-24 pt-4 px-4 space-y-5">
      {/* Range selector */}
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setDays(r)}
            className={`flex-1 h-9 rounded-xl text-sm font-bold transition-colors ${
              days === r
                ? 'bg-[var(--color-primary)] text-white'
                : 'uv-surface-1 uv-text-muted border border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
            }`}
          >
            {t(`business_report_range_${r}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {error && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}

      {/* Headline totals */}
      <div className="uv-surface-1 rounded-3xl p-5 uv-shadow-soft">
        <span className="text-xs font-semibold uppercase tracking-wider uv-text-muted">
          {t('business_report_net')}
        </span>
        <div className="text-3xl font-black uv-text-primary mt-1 tabular-nums">
          {report ? money(report.totals.net) : '—'}
        </div>
        <div className="flex gap-6 mt-3 text-sm">
          <div>
            <span className="uv-text-muted">{t('business_report_sales')}</span>{' '}
            <span className="font-bold uv-text-primary tabular-nums">{report?.totals.count ?? '—'}</span>
          </div>
          <div>
            <span className="uv-text-muted">{t('business_report_commission')}</span>{' '}
            <span className="font-bold uv-text-primary tabular-nums">{report ? money(report.totals.fee) : '—'}</span>
          </div>
        </div>
      </div>

      {empty ? (
        <div className="flex flex-col items-center py-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-3">
            <Icons.TrendingUp size={24} className="uv-text-muted" />
          </div>
          <p className="text-sm uv-text-muted max-w-[260px]">{t('business_report_empty')}</p>
        </div>
      ) : (
        <>
          {/* Daily series — one measure, one hue, recessive frame. */}
          <div className="uv-surface-1 rounded-2xl p-4 uv-shadow-soft">
            <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-3">
              {t('business_report_daily')}
            </h3>
            <div className="flex items-end gap-px h-28">
              {series.map((s) => (
                <div key={s.date} className="flex-1 flex flex-col justify-end h-full" title={`${s.date}: ${money(s.net)}`}>
                  <div
                    className="w-full rounded-t bg-[var(--color-primary)]"
                    style={{ height: s.net > 0 ? `${Math.max(3, (s.net / maxNet) * 100)}%` : '0%' }}
                  />
                </div>
              ))}
            </div>
            <div className="h-px bg-[var(--color-border)] dark:bg-[var(--color-border-dark)]" />
            <div className="flex justify-between mt-1.5 text-[10px] uv-text-muted tabular-nums">
              <span>{series[0]?.date.slice(5)}</span>
              <span>{series[series.length - 1]?.date.slice(5)}</span>
            </div>
          </div>

          {bucketRows(report?.byLocation ?? [], t('business_report_by_location'))}
          {bucketRows(report?.byCollector ?? [], t('business_report_by_collector'))}
        </>
      )}
    </div>
  );
};
