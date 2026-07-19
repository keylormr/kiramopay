import React, { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';

const CATEGORIES = ['restaurant', 'retail', 'services', 'food_truck', 'market'] as const;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the freshly created merchant so the caller can activate it. */
  onCreated: (merchant: QRMerchant) => void;
}

/**
 * Guided business sign-up: type -> shop details -> legal details. Splitting the
 * old single form into steps keeps each screen short and makes the legal step
 * (where most rejections come from) explicit.
 */
export const BusinessOnboardingSheet: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const { t } = useLanguage();
  const [step, setStep] = useState(0);
  const [cedulaType, setCedulaType] = useState<'fisica' | 'juridica'>('fisica');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [cedula, setCedula] = useState('');
  const [legalName, setLegalName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const cat = (c: string) => t(`merchant_cat_${c}` as Parameters<typeof t>[0]);

  const reset = () => {
    setStep(0); setCedulaType('fisica'); setName(''); setCategory(CATEGORIES[0]);
    setDescription(''); setCedula(''); setLegalName(''); setAccepted(false); setError('');
  };

  const close = () => { reset(); onClose(); };

  const submit = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || submitting) return;
    setSubmitting(true);
    setError('');
    const res = await api.registerMerchant({
      name: name.trim(),
      description: description.trim(),
      category,
      cedula: cedula.trim(),
      cedulaType,
      legalName: legalName.trim(),
    });
    setSubmitting(false);
    if (res.success && res.data) {
      onCreated(res.data);
      reset();
    } else {
      setError(res.error?.message || t('merchant_register_error'));
    }
  };

  const canNext =
    step === 0 ? true
    : step === 1 ? name.trim().length > 0
    : cedula.trim().length > 0 && legalName.trim().length > 0 && accepted;

  const field = 'w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]';
  const label = 'text-sm font-medium uv-text-secondary mb-1.5 block';

  return (
    <BottomSheet isOpen={isOpen} onClose={close} title={t('business_create')}>
      <div className="space-y-5">
        {/* Step indicator */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]'}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm uv-text-secondary">{t('business_step_type_desc')}</p>
            {(['fisica', 'juridica'] as const).map((typ) => (
              <button
                key={typ}
                onClick={() => setCedulaType(typ)}
                className={`w-full flex items-center gap-3 p-4 rounded-2xl border text-left transition-colors ${
                  cedulaType === typ
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                    : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
                }`}
              >
                <Icons.Shield size={20} className={cedulaType === typ ? 'text-[var(--color-primary)]' : 'uv-text-muted'} />
                <span className="font-semibold uv-text-primary">
                  {typ === 'fisica' ? t('merchant_cedula_fisica') : t('merchant_cedula_juridica')}
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className={label}>{t('merchant_name')}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>{t('merchant_category')}</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{cat(c)}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>{t('merchant_desc')}</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className={label}>{t('merchant_cedula')}</label>
              <input value={cedula} onChange={(e) => setCedula(e.target.value)} className={field} inputMode="numeric" />
            </div>
            <div>
              <label className={label}>{t('merchant_legal_name')}</label>
              <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={field} />
            </div>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[var(--color-primary)]" />
              <span className="text-sm uv-text-secondary">{t('merchant_terms')}</span>
            </label>
            <p className="text-xs uv-text-muted">{t('business_review_notice')}</p>
          </div>
        )}

        {error && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}

        <div className="flex gap-2.5">
          {step > 0 && (
            <Button variant="secondary" onClick={() => setStep((s) => s - 1)} className="flex-1">
              {t('back')}
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="flex-1">
              {t('business_next')}
            </Button>
          ) : (
            <Button onClick={submit} loading={submitting} disabled={!canNext} className="flex-1">
              {submitting ? t('loading') : t('merchant_register_btn')}
            </Button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
};
