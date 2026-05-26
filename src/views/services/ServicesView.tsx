import React, { useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '../../i18n/LanguageContext';
import { Icons } from '../../components/Icons';
import { BottomSheet } from '../../components/BottomSheet';

// Proveedores de servicios de Costa Rica
const SERVICE_PROVIDERS = [
  // Electricidad
  { id: 'ice', code: 'ICE', name: 'ICE Electricidad', category: 'electricity' as const, logo: '⚡', color: 'from-yellow-500 to-orange-500' },
  { id: 'cnfl', code: 'CNFL', name: 'CNFL', category: 'electricity' as const, logo: '💡', color: 'from-yellow-400 to-yellow-600' },
  { id: 'esph', code: 'ESPH', name: 'ESPH Heredia', category: 'electricity' as const, logo: '🔌', color: 'from-green-500 to-emerald-600' },
  { id: 'coopelesca', code: 'COOPELESCA', name: 'Coopelesca', category: 'electricity' as const, logo: '⚡', color: 'from-blue-500 to-blue-600' },

  // Agua
  { id: 'aya', code: 'AYA', name: 'AyA', category: 'water' as const, logo: '💧', color: 'from-blue-400 to-cyan-500' },
  { id: 'esph-agua', code: 'ESPH-AGUA', name: 'ESPH Agua', category: 'water' as const, logo: '🚿', color: 'from-cyan-400 to-blue-500' },

  // Telefonía
  { id: 'kolbi', code: 'KOLBI', name: 'Kolbi', category: 'telecom' as const, logo: '📱', color: 'from-green-500 to-green-600' },
  { id: 'claro', code: 'CLARO', name: 'Claro', category: 'telecom' as const, logo: '📶', color: 'from-red-500 to-red-600' },
  { id: 'movistar', code: 'MOVISTAR', name: 'Movistar', category: 'telecom' as const, logo: '📞', color: 'from-blue-500 to-indigo-600' },

  // Internet/Cable
  { id: 'tigo', code: 'TIGO', name: 'Tigo', category: 'internet' as const, logo: '📡', color: 'from-blue-600 to-blue-700' },
  { id: 'liberty', code: 'LIBERTY', name: 'Liberty', category: 'cable' as const, logo: '📺', color: 'from-purple-500 to-purple-600' },
  { id: 'cabletica', code: 'CABLETICA', name: 'Cabletica', category: 'cable' as const, logo: '🖥️', color: 'from-orange-500 to-red-500' },

  // Otros
  { id: 'ccss', code: 'CCSS', name: 'CCSS (Caja)', category: 'other' as const, logo: '🏥', color: 'from-green-600 to-emerald-700' },
  { id: 'ins', code: 'INS', name: 'INS Seguros', category: 'insurance' as const, logo: '🛡️', color: 'from-blue-700 to-blue-800' },
  { id: 'marchamo', code: 'MARCHAMO', name: 'Marchamo', category: 'other' as const, logo: '🚗', color: 'from-gray-600 to-gray-700' },
];

// Operadores para recargas
const PHONE_OPERATORS = [
  { id: 'kolbi', name: 'Kolbi', logo: '🟢', color: 'from-green-500 to-green-600', amounts: [1000, 2000, 3000, 5000, 10000, 20000] },
  { id: 'claro', name: 'Claro', logo: '🔴', color: 'from-red-500 to-red-600', amounts: [1000, 2000, 5000, 10000, 15000, 20000] },
  { id: 'movistar', name: 'Movistar', logo: '🔵', color: 'from-blue-500 to-blue-600', amounts: [1000, 2000, 5000, 10000, 20000] },
];

const CATEGORIES = [
  { id: 'all', label: 'Todos', icon: '📋' },
  { id: 'electricity', label: 'Electricidad', icon: '⚡' },
  { id: 'water', label: 'Agua', icon: '💧' },
  { id: 'telecom', label: 'Teléfono', icon: '📱' },
  { id: 'internet', label: 'Internet', icon: '📡' },
  { id: 'cable', label: 'Cable', icon: '📺' },
  { id: 'other', label: 'Otros', icon: '📄' },
];

export const ServicesView: React.FC = () => {
  const { state, dispatch } = useApp();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'services' | 'recharge' | 'history'>('services');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Sheet states
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [showRechargeSheet, setShowRechargeSheet] = useState(false);
  const [showSuccessSheet, setShowSuccessSheet] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<typeof SERVICE_PROVIDERS[0] | null>(null);
  const [selectedOperator, setSelectedOperator] = useState<typeof PHONE_OPERATORS[0] | null>(null);

  // Form states
  const [clientId, setClientId] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [rechargePhone, setRechargePhone] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastPayment, setLastPayment] = useState<{ type: string; amount: number; detail: string } | null>(null);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' }).format(amount);
  };

  const crcAccount = state.accounts.find(a => a.ccy === 'CRC');
  const balance = crcAccount?.balance || 0;

  const filteredProviders = SERVICE_PROVIDERS.filter(p => {
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.code.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleSelectProvider = (provider: typeof SERVICE_PROVIDERS[0]) => {
    setSelectedProvider(provider);
    // Check if user has saved this service
    const saved = state.savedServices.find(s => s.providerId === provider.id);
    if (saved) {
      setClientId(saved.clientId);
      setBillAmount(saved.lastAmount?.toString() || '');
    }
    setShowPaymentSheet(true);
  };

  const handlePayService = () => {
    if (!clientId || !billAmount || !selectedProvider) return;

    setIsProcessing(true);

    setTimeout(() => {
      const payment = {
        id: Date.now().toString(),
        providerId: selectedProvider.id,
        providerName: selectedProvider.name,
        clientId,
        amount: parseFloat(billAmount),
        dueDate: new Date().toISOString().split('T')[0],
        period: 'Diciembre 2024',
        status: 'paid' as const,
      };

      dispatch({ type: 'ADD_BILL_PAYMENT', payload: payment });

      setLastPayment({
        type: 'service',
        amount: parseFloat(billAmount),
        detail: `${selectedProvider.name} - ${clientId}`,
      });

      setIsProcessing(false);
      setShowPaymentSheet(false);
      setShowSuccessSheet(true);

      // Reset
      setClientId('');
      setBillAmount('');
      setSelectedProvider(null);
    }, 2000);
  };

  const handleRecharge = () => {
    if (!rechargePhone || !rechargeAmount || !selectedOperator) return;

    setIsProcessing(true);

    setTimeout(() => {
      const recharge = {
        id: Date.now().toString(),
        operatorId: selectedOperator.id,
        phone: rechargePhone,
        amount: rechargeAmount,
        date: 'Ahora',
        status: 'completed' as const,
      };

      dispatch({ type: 'ADD_RECHARGE', payload: recharge });

      setLastPayment({
        type: 'recharge',
        amount: rechargeAmount,
        detail: `${selectedOperator.name} - ${rechargePhone}`,
      });

      setIsProcessing(false);
      setShowRechargeSheet(false);
      setShowSuccessSheet(true);

      // Reset
      setRechargePhone('');
      setRechargeAmount(null);
      setSelectedOperator(null);
    }, 2000);
  };

  return (
    <div className="pb-24 pt-4 space-y-6 px-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">
          {t('nav_services')}
        </h1>
        <div className="text-right">
          <p className="text-xs text-gray-500">{t('available')}</p>
          <p className="text-lg font-bold text-slate-900 dark:text-white">
            {formatCurrency(balance)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl" role="tablist">
        <button
          onClick={() => setActiveTab('services')}
          role="tab"
          aria-selected={activeTab === 'services'}
          className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            activeTab === 'services'
              ? 'bg-white dark:bg-gray-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-gray-500'
          }`}
        >
          <Icons.FileText size={14} />
          {t('nav_services')}
        </button>
        <button
          onClick={() => setActiveTab('recharge')}
          role="tab"
          aria-selected={activeTab === 'recharge'}
          className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            activeTab === 'recharge'
              ? 'bg-white dark:bg-gray-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-gray-500'
          }`}
        >
          <Icons.Phone size={14} />
          {t('recharge_label')}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          role="tab"
          aria-selected={activeTab === 'history'}
          className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            activeTab === 'history'
              ? 'bg-white dark:bg-gray-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-gray-500'
          }`}
        >
          <Icons.History size={14} />
          {t('history')}
        </button>
      </div>

      {activeTab === 'services' && (
        <>
          {/* Servicios guardados */}
          {state.savedServices.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                {t('my_services')}
              </h3>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                {state.savedServices.map((saved) => {
                  const provider = SERVICE_PROVIDERS.find(p => p.id === saved.providerId);
                  if (!provider) return null;
                  return (
                    <button
                      key={saved.id}
                      onClick={() => handleSelectProvider(provider)}
                      className="min-w-[140px] bg-white dark:bg-surface-dark rounded-2xl p-4 border border-gray-100 dark:border-gray-800"
                    >
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${provider.color} flex items-center justify-center text-xl mb-2`}>
                        {provider.logo}
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-slate-900 dark:text-white text-sm truncate">
                          {saved.nickname || provider.name}
                        </p>
                        <p className="text-xs text-gray-500">{saved.clientId}</p>
                        {saved.lastAmount && (
                          <p className="text-sm font-bold text-orange-500 mt-1">
                            {formatCurrency(saved.lastAmount)}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Búsqueda */}
          <div className="relative">
            <Icons.Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search_service')}
              className="w-full bg-gray-100 dark:bg-gray-800 pl-11 pr-4 py-3 rounded-xl outline-none text-slate-900 dark:text-white placeholder-gray-400"
            />
          </div>

          {/* Categorías */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2" role="tablist" aria-label={t('nav_services')}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                role="tab"
                aria-selected={selectedCategory === cat.id}
                className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                <span>{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </div>

          {/* Lista de proveedores */}
          <div className="grid grid-cols-2 gap-3">
            {filteredProviders.map((provider) => (
              <button
                key={provider.id}
                onClick={() => handleSelectProvider(provider)}
                className="bg-white dark:bg-surface-dark rounded-2xl p-4 border border-gray-100 dark:border-gray-800 text-left hover:border-primary dark:hover:border-primary transition-colors"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${provider.color} flex items-center justify-center text-2xl mb-3`}>
                  {provider.logo}
                </div>
                <p className="font-bold text-slate-900 dark:text-white">{provider.name}</p>
                <p className="text-xs text-gray-500">{provider.code}</p>
              </button>
            ))}
          </div>
        </>
      )}

      {activeTab === 'recharge' && (
        <div className="space-y-6">
          {/* Operadores */}
          <div>
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
              {t('select_operator')}
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {PHONE_OPERATORS.map((op) => (
                <button
                  key={op.id}
                  onClick={() => { setSelectedOperator(op); setShowRechargeSheet(true); }}
                  className="bg-white dark:bg-surface-dark rounded-2xl p-4 border border-gray-100 dark:border-gray-800 text-center hover:border-primary transition-colors"
                >
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${op.color} flex items-center justify-center text-3xl mx-auto mb-2`}>
                    {op.logo}
                  </div>
                  <p className="font-bold text-slate-900 dark:text-white">{op.name}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Recargas recientes */}
          {state.rechargeHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                {t('recent_recharges')}
              </h3>
              <div className="bg-white dark:bg-surface-dark rounded-2xl divide-y divide-gray-100 dark:divide-gray-800">
                {state.rechargeHistory.slice(0, 5).map((recharge) => {
                  const op = PHONE_OPERATORS.find(o => o.id === recharge.operatorId);
                  return (
                    <div key={recharge.id} className="flex items-center p-4">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${op?.color || 'from-gray-400 to-gray-500'} flex items-center justify-center text-xl mr-3`}>
                        {op?.logo || '📱'}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-slate-900 dark:text-white">{recharge.phone}</p>
                        <p className="text-sm text-gray-500">{recharge.date}</p>
                      </div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        {formatCurrency(recharge.amount)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Pagos de servicios */}
          <div>
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
              {t('service_payments')}
            </h3>
            {state.billHistory.length === 0 ? (
              <div className="bg-white dark:bg-surface-dark rounded-2xl p-8 text-center">
                <Icons.FileText size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">{t('no_service_payments')}</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-surface-dark rounded-2xl divide-y divide-gray-100 dark:divide-gray-800">
                {state.billHistory.map((bill) => {
                  const provider = SERVICE_PROVIDERS.find(p => p.id === bill.providerId);
                  return (
                    <div key={bill.id} className="flex items-center p-4">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${provider?.color || 'from-gray-400 to-gray-500'} flex items-center justify-center text-xl mr-3`}>
                        {provider?.logo || '📄'}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-slate-900 dark:text-white">{bill.providerName}</p>
                        <p className="text-sm text-gray-500">{t('client_label')}: {bill.clientId}</p>
                        <p className="text-xs text-gray-400">{bill.period}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900 dark:text-white">
                          {formatCurrency(bill.amount)}
                        </p>
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          {t('paid')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recargas */}
          <div>
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
              {t('recharge_label')}
            </h3>
            {state.rechargeHistory.length === 0 ? (
              <div className="bg-white dark:bg-surface-dark rounded-2xl p-8 text-center">
                <Icons.Phone size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">{t('no_recharges_yet')}</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-surface-dark rounded-2xl divide-y divide-gray-100 dark:divide-gray-800">
                {state.rechargeHistory.map((recharge) => {
                  const op = PHONE_OPERATORS.find(o => o.id === recharge.operatorId);
                  return (
                    <div key={recharge.id} className="flex items-center p-4">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${op?.color || 'from-gray-400 to-gray-500'} flex items-center justify-center text-xl mr-3`}>
                        {op?.logo || '📱'}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-slate-900 dark:text-white">{op?.name || 'Recarga'}</p>
                        <p className="text-sm text-gray-500">+506 {recharge.phone}</p>
                        <p className="text-xs text-gray-400">{recharge.date}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900 dark:text-white">
                          {formatCurrency(recharge.amount)}
                        </p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          recharge.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {recharge.status === 'completed' ? t('successful') : t('pending')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment Sheet */}
      <BottomSheet
        isOpen={showPaymentSheet}
        onClose={() => { setShowPaymentSheet(false); setSelectedProvider(null); }}
        title={`${t('pay')} ${selectedProvider?.name || t('nav_services')}`}
      >
        <div className="space-y-6">
          {selectedProvider && (
            <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-800 p-4 rounded-xl">
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${selectedProvider.color} flex items-center justify-center text-2xl`}>
                {selectedProvider.logo}
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">{selectedProvider.name}</p>
                <p className="text-sm text-gray-500">{selectedProvider.code}</p>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('client_number_nis')}
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Ej: 1234567"
              className="w-full bg-gray-100 dark:bg-gray-800 px-4 py-4 rounded-xl outline-none text-lg font-semibold text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('amount_to_pay')}
            </label>
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-4 py-4 rounded-xl">
              <span className="text-2xl font-bold text-gray-400">₡</span>
              <input
                type="number"
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value)}
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-2xl font-bold text-slate-900 dark:text-white"
              />
            </div>
            {parseFloat(billAmount || '0') > balance && (
              <p className="text-red-500 text-sm mt-2">{t('insufficient_funds')}</p>
            )}
          </div>

          <button
            onClick={handlePayService}
            disabled={!clientId || !billAmount || parseFloat(billAmount) > balance || isProcessing}
            className="w-full bg-primary text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t('processing_payment')}
              </>
            ) : (
              <>
                {t('pay')} {billAmount && formatCurrency(parseFloat(billAmount))}
              </>
            )}
          </button>
        </div>
      </BottomSheet>

      {/* Recharge Sheet */}
      <BottomSheet
        isOpen={showRechargeSheet}
        onClose={() => { setShowRechargeSheet(false); setSelectedOperator(null); }}
        title={`${t('recharge_label')} ${selectedOperator?.name || ''}`}
      >
        <div className="space-y-6">
          {selectedOperator && (
            <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-800 p-4 rounded-xl">
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${selectedOperator.color} flex items-center justify-center text-2xl`}>
                {selectedOperator.logo}
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">{selectedOperator.name}</p>
                <p className="text-sm text-gray-500">{t('prepaid_recharge')}</p>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('number_to_recharge')}
            </label>
            <div className="flex gap-2">
              <span className="flex items-center bg-gray-100 dark:bg-gray-800 px-4 rounded-xl text-gray-500">
                +506
              </span>
              <input
                type="tel"
                value={rechargePhone}
                onChange={(e) => setRechargePhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="8888-0000"
                className="flex-1 bg-gray-100 dark:bg-gray-800 px-4 py-4 rounded-xl outline-none text-lg font-semibold text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('select_amount')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {selectedOperator?.amounts.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setRechargeAmount(amt)}
                  className={`py-3 rounded-xl font-bold transition-all ${
                    rechargeAmount === amt
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-slate-900 dark:text-white'
                  }`}
                >
                  {formatCurrency(amt).replace(',00', '')}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleRecharge}
            disabled={!rechargePhone || !rechargeAmount || (rechargeAmount || 0) > balance || isProcessing}
            className="w-full bg-primary text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t('processing')}
              </>
            ) : (
              <>
                {t('recharge_label')} {rechargeAmount && formatCurrency(rechargeAmount)}
              </>
            )}
          </button>
        </div>
      </BottomSheet>

      {/* Success Sheet */}
      <BottomSheet
        isOpen={showSuccessSheet}
        onClose={() => setShowSuccessSheet(false)}
        title=""
      >
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icons.Check size={40} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2">
            {lastPayment?.type === 'recharge' ? t('recharge_success') : t('payment_success')}
          </h2>
          <p className="text-gray-500 mb-6">
            {lastPayment?.detail}
          </p>

          {lastPayment && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-6 mb-6">
              <p className="text-4xl font-black text-slate-900 dark:text-white">
                {formatCurrency(lastPayment.amount)}
              </p>
            </div>
          )}

          <button
            onClick={() => setShowSuccessSheet(false)}
            className="w-full bg-primary text-white py-4 rounded-xl font-bold text-lg"
          >
            {t('ready')}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
};
