import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { SplitGroup } from '@/api/repositories/splitpay.repository';

export const SplitPayView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [splits, setSplits] = useState<SplitGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [loadTrigger, setLoadTrigger] = useState(0);

  // Form state
  const [title, setTitle] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
  const [participants, setParticipants] = useState([
    { userName: '', userPhone: '' },
    { userName: '', userPhone: '' },
  ]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const api = getApiLayer();
      if (api.splitPay) {
        const res = await api.splitPay.listSplits();
        if (!cancelled && res.success && res.data) {
          setSplits(res.data);
        }
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [loadTrigger]);

  const handleCreate = async () => {
    if (!title || !totalAmount) return;
    const api = getApiLayer();
    if (!api.splitPay) return;

    const validParticipants = participants.filter(p => p.userName.trim());
    if (validParticipants.length === 0) return;

    const amount = parseFloat(totalAmount);
    const perPerson = amount / (validParticipants.length + 1); // +1 for creator

    const res = await api.splitPay.createSplit({
      title,
      totalAmount: amount,
      currency: 'CRC',
      splitType,
      participants: validParticipants.map(p => ({
        userName: p.userName,
        userPhone: p.userPhone || undefined,
        amount: splitType === 'equal' ? perPerson : undefined,
      })),
    });

    if (res.success) {
      setShowCreate(false);
      setTitle('');
      setTotalAmount('');
      setParticipants([{ userName: '', userPhone: '' }, { userName: '', userPhone: '' }]);
      setLoadTrigger(n => n + 1);
    }
  };

  const addParticipant = () => {
    setParticipants([...participants, { userName: '', userPhone: '' }]);
  };

  const updateParticipant = (idx: number, field: 'userName' | 'userPhone', value: string) => {
    setParticipants(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const removeParticipant = (idx: number) => {
    if (participants.length <= 2) return;
    setParticipants(prev => prev.filter((_, i) => i !== idx));
  };

  const formatCurrency = (amount: number) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'CRC' }).format(amount);
    } catch {
      return `₡${amount.toFixed(2)}`;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400';
      case 'settled': return 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400';
      case 'cancelled': return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
      default: return 'bg-gray-100 text-gray-500';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background dark:bg-background-dark flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" aria-label={t('back')}>
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('splitpay_title')}</h1>
        <button onClick={() => setShowCreate(true)} className="p-2 -mr-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-primary">
          <Icons.Plus size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : splits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-gray-400">
            <div className="w-24 h-24 rounded-3xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <Icons.Users size={48} className="opacity-30" />
            </div>
            <p className="text-lg font-bold mb-2 text-slate-900 dark:text-white">{t('splitpay_no_splits')}</p>
            <p className="text-sm text-center mb-6">{t('splitpay_no_splits_desc')}</p>
            <button onClick={() => setShowCreate(true)} className="px-6 py-3 bg-primary text-white rounded-xl font-bold text-sm active:scale-95 transition-transform">
              {t('splitpay_create')}
            </button>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            {splits.map((split, i) => (
              <div
                key={split.id}
                className="bg-white dark:bg-surface-dark rounded-2xl border border-gray-100 dark:border-gray-800 p-4 shadow-sm animate-stagger"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm">{split.title}</h3>
                    {split.description && <p className="text-xs text-gray-400 mt-0.5">{split.description}</p>}
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${getStatusColor(split.status)}`}>
                    {split.status}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-lg font-extrabold text-slate-900 dark:text-white">
                    {formatCurrency(split.totalAmount)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {split.splitType === 'equal' ? t('splitpay_equal') : t('splitpay_custom')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Split Sheet */}
      <BottomSheet isOpen={showCreate} onClose={() => setShowCreate(false)} title={t('splitpay_create')}>
        <div className="space-y-4 pb-2">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">{t('splitpay_desc')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('splitpay_desc_placeholder')}
              className="w-full bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">{t('amount')}</label>
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl px-4 py-3">
              <span className="text-lg font-bold text-gray-400 mr-2">₡</span>
              <input type="number" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="0"
                className="flex-1 bg-transparent text-lg font-bold outline-none text-slate-900 dark:text-white" />
            </div>
          </div>

          {/* Split type */}
          <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
            {(['equal', 'custom'] as const).map((type) => (
              <button key={type} onClick={() => setSplitType(type)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${splitType === type ? 'bg-white dark:bg-gray-700 shadow-sm text-slate-900 dark:text-white' : 'text-gray-500'}`}>
                {type === 'equal' ? t('splitpay_equal') : t('splitpay_custom')}
              </button>
            ))}
          </div>

          {/* Participants */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t('splitpay_participants')}</label>
              <button onClick={addParticipant} className="text-primary text-xs font-bold">+ {t('add')}</button>
            </div>
            <div className="space-y-2">
              {participants.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" value={p.userName} onChange={(e) => updateParticipant(i, 'userName', e.target.value)}
                    placeholder={t('contact_name')}
                    className="flex-1 bg-gray-100 dark:bg-gray-800 px-3 py-2.5 rounded-xl text-sm outline-none" />
                  <input type="tel" value={p.userPhone} onChange={(e) => updateParticipant(i, 'userPhone', e.target.value)}
                    placeholder={t('phone')}
                    className="w-32 bg-gray-100 dark:bg-gray-800 px-3 py-2.5 rounded-xl text-sm outline-none" />
                  {participants.length > 2 && (
                    <button onClick={() => removeParticipant(i)} className="px-2 text-gray-400 hover:text-red-500">
                      <Icons.X size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {totalAmount && participants.filter(p => p.userName).length > 0 && splitType === 'equal' && (
              <p className="text-xs text-primary font-medium mt-2">
                {formatCurrency(parseFloat(totalAmount) / (participants.filter(p => p.userName).length + 1))} {t('splitpay_per_person')}
              </p>
            )}
          </div>

          <button onClick={handleCreate}
            disabled={!title || !totalAmount || participants.filter(p => p.userName).length === 0}
            className="w-full bg-primary text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 active:scale-[0.98] transition-all">
            {t('splitpay_create')}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
};
