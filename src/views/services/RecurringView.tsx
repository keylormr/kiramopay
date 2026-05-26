import React, { useState } from 'react';
import { useRecurringStore } from '@/stores/recurring.store';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import type { RecurringPayment } from '@/types';

const FREQUENCY_LABELS: Record<RecurringPayment['frequency'], string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

const FREQUENCY_COLORS: Record<RecurringPayment['frequency'], string> = {
  weekly: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  biweekly: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  monthly: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

const TYPE_OPTIONS: { value: RecurringPayment['type']; label: string }[] = [
  { value: 'service', label: 'Servicio' },
  { value: 'sinpe', label: 'SINPE' },
  { value: 'recharge', label: 'Recarga' },
];

const FREQUENCY_OPTIONS: { value: RecurringPayment['frequency']; label: string }[] = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quincenal' },
  { value: 'monthly', label: 'Mensual' },
];

const getTypeIcon = (type: RecurringPayment['type']) => {
  switch (type) {
    case 'service':
      return <Icons.Zap size={20} className="text-yellow-500" />;
    case 'sinpe':
      return <Icons.Smartphone size={20} className="text-blue-500" />;
    case 'recharge':
      return <Icons.Phone size={20} className="text-green-500" />;
  }
};

const getTypeGradient = (type: RecurringPayment['type']) => {
  switch (type) {
    case 'service':
      return 'from-yellow-500 to-orange-500';
    case 'sinpe':
      return 'from-blue-500 to-indigo-500';
    case 'recharge':
      return 'from-green-500 to-emerald-500';
  }
};

const formatCurrency = (amount: number, ccy: string) => {
  if (ccy === 'CRC') {
    return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' }).format(amount);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy }).format(amount);
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const RecurringView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const { payments, addPayment, removePayment, togglePayment } = useRecurringStore();

  const [showAddSheet, setShowAddSheet] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add form state
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<RecurringPayment['type']>('service');
  const [newAmount, setNewAmount] = useState('');
  const [newFrequency, setNewFrequency] = useState<RecurringPayment['frequency']>('monthly');
  const [newNextDate, setNewNextDate] = useState('');

  const resetForm = () => {
    setNewLabel('');
    setNewType('service');
    setNewAmount('');
    setNewFrequency('monthly');
    setNewNextDate('');
  };

  const handleAdd = () => {
    if (!newLabel || !newAmount || !newNextDate) return;

    const payment: RecurringPayment = {
      id: `rec-${Date.now()}`,
      label: newLabel,
      type: newType,
      amount: parseFloat(newAmount),
      ccy: 'CRC',
      frequency: newFrequency,
      nextDate: newNextDate,
      enabled: true,
    };

    addPayment(payment);
    resetForm();
    setShowAddSheet(false);
  };

  const handleDelete = (id: string) => {
    removePayment(id);
    setConfirmDeleteId(null);
  };

  const enabledPayments = payments.filter((p) => p.enabled);
  const disabledPayments = payments.filter((p) => !p.enabled);

  return (
    <div className="fixed inset-0 z-50 bg-background dark:bg-background-dark animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-surface-dark/95 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            onClick={onClose}
            aria-label={t('back')}
            className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Icons.ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold">Pagos Recurrentes</h1>
          <div className="w-10" />
        </div>
      </div>

      {/* Content */}
      <div className="p-4 pb-24 overflow-y-auto h-[calc(100vh-56px)]">
        {payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <Icons.RefreshCw size={40} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Sin pagos recurrentes</h3>
            <p className="text-gray-500 text-sm text-center">
              Configura pagos automaticos para tus
              <br />servicios, SINPE y recargas.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Active payments */}
            {enabledPayments.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                  Activos ({enabledPayments.length})
                </h3>
                <div className="space-y-3">
                  {enabledPayments.map((payment) => (
                    <div
                      key={payment.id}
                      className="bg-white dark:bg-surface-dark rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        {/* Type icon */}
                        <div
                          className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getTypeGradient(payment.type)} flex items-center justify-center flex-shrink-0`}
                        >
                          {getTypeIcon(payment.type)}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-bold text-slate-900 dark:text-white truncate">
                              {payment.label}
                            </h4>
                            <p className="font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {formatCurrency(payment.amount, payment.ccy)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 mt-1.5">
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${FREQUENCY_COLORS[payment.frequency]}`}
                            >
                              {FREQUENCY_LABELS[payment.frequency]}
                            </span>
                            <span className="text-xs text-gray-500">
                              Proximo: {formatDate(payment.nextDate)}
                            </span>
                          </div>

                          {payment.recipientName && (
                            <p className="text-xs text-gray-400 mt-1">
                              {payment.recipientName}
                              {payment.recipientPhone ? ` - ${payment.recipientPhone}` : ''}
                            </p>
                          )}
                          {payment.clientId && (
                            <p className="text-xs text-gray-400 mt-1">
                              Cliente: {payment.clientId}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Actions row */}
                      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                        {/* Toggle */}
                        <button
                          onClick={() => togglePayment(payment.id)}
                          aria-label={payment.enabled ? 'Desactivar pago' : 'Activar pago'}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                        >
                          <Icons.CheckCircle size={14} />
                          {t('activated')}
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => setConfirmDeleteId(payment.id)}
                          aria-label={t('delete')}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Icons.X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Disabled payments */}
            {disabledPayments.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                  Inactivos ({disabledPayments.length})
                </h3>
                <div className="space-y-3">
                  {disabledPayments.map((payment) => (
                    <div
                      key={payment.id}
                      className="bg-white dark:bg-surface-dark rounded-2xl p-4 border border-gray-100 dark:border-gray-800 opacity-60"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center flex-shrink-0`}
                        >
                          {getTypeIcon(payment.type)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-bold text-slate-900 dark:text-white truncate">
                              {payment.label}
                            </h4>
                            <p className="font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {formatCurrency(payment.amount, payment.ccy)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 mt-1.5">
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${FREQUENCY_COLORS[payment.frequency]}`}
                            >
                              {FREQUENCY_LABELS[payment.frequency]}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                        <button
                          onClick={() => togglePayment(payment.id)}
                          aria-label="Activar pago"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        >
                          <Icons.Circle size={14} />
                          {t('deactivated')}
                        </button>

                        <button
                          onClick={() => setConfirmDeleteId(payment.id)}
                          aria-label={t('delete')}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Icons.X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Floating add button */}
        <div className="fixed bottom-6 left-0 right-0 flex justify-center z-10">
          <button
            onClick={() => setShowAddSheet(true)}
            className="bg-gradient-to-r from-primary to-blue-600 text-white px-6 py-3.5 rounded-full font-bold text-sm shadow-lg shadow-primary/30 flex items-center gap-2 active:scale-95 transition-transform"
          >
            <Icons.Plus size={18} />
            Agregar pago recurrente
          </button>
        </div>
      </div>

      {/* Add payment BottomSheet */}
      <BottomSheet
        isOpen={showAddSheet}
        onClose={() => {
          setShowAddSheet(false);
          resetForm();
        }}
        title="Nuevo pago recurrente"
      >
        <div className="space-y-5">
          {/* Label */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              Nombre del pago
            </label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Ej: Pago de luz"
              className="w-full bg-gray-100 dark:bg-gray-800 px-4 py-3.5 rounded-xl outline-none text-slate-900 dark:text-white placeholder-gray-400"
            />
          </div>

          {/* Type selector */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              Tipo
            </label>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setNewType(opt.value)}
                  className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                    newType === opt.value
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-slate-900 dark:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('amount')}
            </label>
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-4 py-3.5 rounded-xl">
              <span className="text-xl font-bold text-gray-400">&#8353;</span>
              <input
                type="number"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-xl font-bold text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Frequency selector */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              Frecuencia
            </label>
            <div className="grid grid-cols-3 gap-2">
              {FREQUENCY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setNewFrequency(opt.value)}
                  className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                    newFrequency === opt.value
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-slate-900 dark:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Next date */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              Proximo pago
            </label>
            <input
              type="date"
              value={newNextDate}
              onChange={(e) => setNewNextDate(e.target.value)}
              className="w-full bg-gray-100 dark:bg-gray-800 px-4 py-3.5 rounded-xl outline-none text-slate-900 dark:text-white"
            />
          </div>

          {/* Save button */}
          <button
            onClick={handleAdd}
            disabled={!newLabel || !newAmount || !newNextDate}
            className="w-full bg-primary text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {t('save')}
          </button>
        </div>
      </BottomSheet>

      {/* Confirm delete BottomSheet */}
      <BottomSheet
        isOpen={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        title={t('confirm')}
      >
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-300">
            Deseas eliminar este pago recurrente? Esta accion no se puede deshacer.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmDeleteId(null)}
              className="flex-1 bg-gray-100 dark:bg-gray-800 text-slate-900 dark:text-white py-3.5 rounded-xl font-bold"
            >
              {t('cancel')}
            </button>
            <button
              onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
              className="flex-1 bg-red-500 text-white py-3.5 rounded-xl font-bold active:scale-[0.98] transition-transform"
            >
              {t('delete')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};
