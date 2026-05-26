
import React, { useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { Icons } from '../../components/Icons';
import { BottomSheet } from '../../components/BottomSheet';
import { Account, Transaction } from '../../types';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '../../i18n/LanguageContext';

const AVAILABLE_CURRENCIES: Partial<Account>[] = [
  { ccy: 'GBP', symbol: '£', flag: '🇬🇧', name: 'British Pound', type: 'fiat', rateToUsd: 1.26 },
  { ccy: 'JPY', symbol: '¥', flag: '🇯🇵', name: 'Japanese Yen', type: 'fiat', rateToUsd: 0.0067 },
  { ccy: 'BTC', symbol: '₿', flag: '🟠', name: 'Bitcoin', type: 'crypto', rateToUsd: 43000 },
  { ccy: 'ETH', symbol: 'Ξ', flag: '🔷', name: 'Ethereum', type: 'crypto', rateToUsd: 2250 },
];

// QR codes simulados para cada usuario y moneda
const USER_QR_ACCOUNTS = {
  'user-001': { // Keilor Martinez
    name: 'Keilor Martinez',
    accounts: {
      BTC: { address: 'bc1qkeilor7026509308btc4f2k9', balance: 0.0523 },
      ETH: { address: '0xKeilor7026509eth30F4a2B1c9', balance: 1.245 },
      CRC: { address: 'CR-SINPE-70265-0930-CRC', balance: 850000 },
      USD: { address: 'US-ACH-70265-0930-USD', balance: 1250.50 },
    }
  },
  'user-002': { // Administrador
    name: 'Admin Sistema',
    accounts: {
      BTC: { address: 'bc1qadmin7000000008btc9x3m7', balance: 0.1500 },
      ETH: { address: '0xAdmin70000000eth00C8b3D2e7', balance: 5.000 },
      CRC: { address: 'CR-SINPE-70000-0000-CRC', balance: 2500000 },
      USD: { address: 'US-ACH-70000-0000-USD', balance: 5000.00 },
    }
  }
};

type QRCurrency = 'BTC' | 'ETH' | 'CRC' | 'USD';

interface ScannedPayment {
  userId: string;
  userName: string;
  currency: QRCurrency;
  address: string;
  suggestedAmount?: number;
}

interface HomeViewProps {
  onViewAllTransactions?: () => void;
  onOpenAnalytics?: () => void;
  onOpenSavings?: () => void;
  onOpenSplitPay?: () => void;
  onOpenLoyalty?: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onViewAllTransactions, onOpenAnalytics, onOpenSavings, onOpenSplitPay, onOpenLoyalty }) => {
  const { state, dispatch } = useApp();
  const { t } = useLanguage();

  // Sheet States
  const [activeSheet, setActiveSheet] = useState<'none' | 'send' | 'request' | 'addMoney' | 'addAccount' | 'txDetail' | 'scanner' | 'scanResult'>('none');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // Form States
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [selectedCrypto, setSelectedCrypto] = useState<'BTC' | 'ETH' | 'USDT'>('BTC');

  // Scanner States
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scannedPayment, setScannedPayment] = useState<ScannedPayment | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');

  const formatCurrency = (amount: number, ccy: string) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy }).format(amount);
    } catch {
      return `${amount} ${ccy}`;
    }
  };

  const baseAccount = state.accounts.find(a => a.ccy === state.baseCurrency) || state.accounts[0];
  
  const totalUsdEstimate = state.accounts.reduce((acc, curr) => {
    const rate = curr.rateToUsd || 1;
    return acc + (curr.balance * rate);
  }, 0);

  // Logic to check sufficient funds
  const numericAmount = parseFloat(amount || '0');
  const isInsufficientFunds = activeSheet === 'send' && numericAmount > baseAccount.balance;

  const handleTransaction = (type: 'credit' | 'debit') => {
    if (!amount) return;
    const val = parseFloat(amount);

    // Validation: Prevent Debit if insufficient funds
    if (type === 'debit' && val > baseAccount.balance) {
      return;
    }

    const tx: Transaction = {
      id: Date.now().toString(),
      title: type === 'debit' ? (recipient || 'Unknown') : `Request from ${recipient || 'User'}`,
      amount: type === 'debit' ? -val : val,
      ccy: state.baseCurrency,
      date: 'Just now',
      type,
      category: 'Transfer',
      status: 'completed'
    };
    dispatch({ type: 'ADD_TRANSACTION', payload: tx });
    setActiveSheet('none');
    setAmount('');
    setRecipient('');
  };

  const handleAddAccount = (curr: Partial<Account>) => {
    const newAccount: Account = {
      ccy: curr.ccy!,
      balance: 0,
      symbol: curr.symbol!,
      flag: curr.flag!,
      iban: `NEW-${curr.ccy}`,
      name: curr.name!,
      type: curr.type as Account['type'],
      rateToUsd: curr.rateToUsd
    };
    dispatch({ type: 'ADD_ACCOUNT', payload: newAccount });
    dispatch({ type: 'SET_BASE_CURRENCY', payload: newAccount.ccy });
    setActiveSheet('none');
  };

  // Simular escaneo de QR
  const startQRScan = () => {
    setActiveSheet('scanner');
    setIsScanning(true);
    setScanProgress(0);

    // Simular progreso de escaneo
    const progressInterval = setInterval(() => {
      setScanProgress(prev => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return prev + 5;
      });
    }, 100);

    // Simular deteccion de QR despues de 2-3 segundos
    const scanTime = 2000 + Math.random() * 1000;
    setTimeout(() => {
      clearInterval(progressInterval);
      setScanProgress(100);

      // Seleccionar usuario aleatorio (diferente al actual)
      const currentUserId = state.user?.id || 'user-001';
      const targetUserId = currentUserId === 'user-001' ? 'user-002' : 'user-001';
      const targetUser = USER_QR_ACCOUNTS[targetUserId as keyof typeof USER_QR_ACCOUNTS];

      // Seleccionar moneda aleatoria
      const currencies: QRCurrency[] = ['BTC', 'ETH', 'CRC', 'USD'];
      const randomCurrency = currencies[Math.floor(Math.random() * currencies.length)];
      const account = targetUser.accounts[randomCurrency];

      setScannedPayment({
        userId: targetUserId,
        userName: targetUser.name,
        currency: randomCurrency,
        address: account.address,
      });

      setIsScanning(false);
      setActiveSheet('scanResult');
    }, scanTime);
  };

  // Procesar pago escaneado
  const handleScannedPayment = () => {
    if (!scannedPayment || !paymentAmount) return;

    const amt = parseFloat(paymentAmount);
    const tx: Transaction = {
      id: Date.now().toString(),
      title: `Pago QR a ${scannedPayment.userName}`,
      amount: -amt,
      ccy: scannedPayment.currency,
      date: 'Ahora',
      type: 'debit',
      category: 'QR Payment',
      status: 'completed'
    };

    dispatch({ type: 'ADD_TRANSACTION', payload: tx });
    setActiveSheet('none');
    setScannedPayment(null);
    setPaymentAmount('');
  };

  const getCurrencyInfo = (ccy: QRCurrency) => {
    const info: Record<QRCurrency, { symbol: string; flag: string; name: string }> = {
      BTC: { symbol: '₿', flag: '🟠', name: 'Bitcoin' },
      ETH: { symbol: 'Ξ', flag: '🔷', name: 'Ethereum' },
      CRC: { symbol: '₡', flag: '🇨🇷', name: 'Colones' },
      USD: { symbol: '$', flag: '🇺🇸', name: 'Dolares' },
    };
    return info[ccy];
  };

  return (
    <div className="pb-24 pt-4 space-y-6 px-4">
      
      {/* Main Balance Card */}
      <div className="relative overflow-hidden bg-gradient-to-br from-white/60 to-white/30 dark:from-gray-800/60 dark:to-gray-800/30 backdrop-blur-xl border border-white/20 dark:border-gray-700 rounded-3xl p-6 shadow-lg">
        <div className="flex justify-between items-start mb-2">
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('total_balance')}</span>
          <div className="px-2 py-1 bg-accent/10 text-accent text-xs font-bold rounded-full">
            {state.baseCurrency} Base
          </div>
        </div>
        <div className="text-4xl font-extrabold text-slate-900 dark:text-white mb-1">
          {formatCurrency(baseAccount.balance, baseAccount.ccy)}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          ≈ ${totalUsdEstimate.toLocaleString('en-US', {minimumFractionDigits: 2})} USD Total
        </div>

        <div className="flex gap-3">
          <button 
            onClick={() => setActiveSheet('addMoney')}
            className="flex-1 bg-primary text-white h-10 rounded-xl text-sm font-semibold shadow-lg shadow-primary/20 active:scale-95 transition-transform"
          >
            Add Money
          </button>
          <button
            onClick={() => setActiveSheet('addAccount')}
            aria-label={t('open_new_account')}
            className="w-10 h-10 flex items-center justify-center bg-white dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600 text-slate-700 dark:text-slate-200 shadow-sm active:scale-95 transition-transform"
          >
            <Icons.Plus size={18} />
          </button>
        </div>
      </div>

      {/* Quick Actions Grid */}
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-3">{t('quick_actions')}</h3>
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: Icons.Send, label: t('send'), color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400', action: () => setActiveSheet('send') },
            { icon: Icons.Receive, label: t('receive'), color: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400', action: () => setActiveSheet('request') },
            { icon: Icons.Scan, label: t('scan_qr'), color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400', action: startQRScan },
            { icon: Icons.Card, label: t('card'), color: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400', action: () => {} }, // Handled in CardsView
          ].map((action, i) => (
            <button key={i} onClick={action.action} className="flex flex-col items-center gap-2 group">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${action.color} shadow-sm border border-transparent group-active:scale-95 transition-all`}>
                <action.icon size={24} />
              </div>
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Monthly Insights Card */}
      {(() => {
        const monthlyExpenses = state.transactions
          .filter(tx => tx.amount < 0)
          .reduce((s, tx) => s + Math.abs(tx.amount), 0);
        const topCat = (() => {
          const cats: Record<string, number> = {};
          state.transactions.filter(tx => tx.amount < 0).forEach(tx => {
            const c = tx.category || 'General';
            cats[c] = (cats[c] || 0) + Math.abs(tx.amount);
          });
          const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
          return sorted[0]?.[0] || null;
        })();
        return (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onOpenAnalytics}
              className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/10 rounded-2xl p-4 border border-indigo-100 dark:border-indigo-800/30 text-left active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-800/40 flex items-center justify-center">
                  <Icons.TrendingUp size={16} className="text-indigo-600" />
                </div>
                <span className="text-[10px] font-bold text-indigo-600/80 uppercase tracking-wider">{t('home_spending')}</span>
              </div>
              <div className="text-lg font-extrabold text-slate-900 dark:text-white truncate">
                {formatCurrency(monthlyExpenses, baseAccount.ccy)}
              </div>
              {topCat && <div className="text-[10px] text-gray-500 mt-0.5">{t('home_top_cat')}: {topCat}</div>}
            </button>

            <button
              onClick={onOpenSavings}
              className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/10 rounded-2xl p-4 border border-emerald-100 dark:border-emerald-800/30 text-left active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-800/40 flex items-center justify-center">
                  <Icons.PiggyBank size={16} className="text-emerald-600" />
                </div>
                <span className="text-[10px] font-bold text-emerald-600/80 uppercase tracking-wider">{t('home_savings')}</span>
              </div>
              <div className="text-lg font-extrabold text-slate-900 dark:text-white">{t('home_savings_view')}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{t('home_savings_desc')}</div>
            </button>

            <button
              onClick={onOpenSplitPay}
              className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/10 rounded-2xl p-4 border border-purple-100 dark:border-purple-800/30 text-left active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-800/40 flex items-center justify-center">
                  <Icons.Users size={16} className="text-purple-600" />
                </div>
                <span className="text-[10px] font-bold text-purple-600/80 uppercase tracking-wider">{t('home_split')}</span>
              </div>
              <div className="text-lg font-extrabold text-slate-900 dark:text-white">{t('home_split_view')}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{t('home_split_desc')}</div>
            </button>

            <button
              onClick={onOpenLoyalty}
              className="bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/10 rounded-2xl p-4 border border-amber-100 dark:border-amber-800/30 text-left active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-800/40 flex items-center justify-center">
                  <Icons.Award size={16} className="text-amber-600" />
                </div>
                <span className="text-[10px] font-bold text-amber-600/80 uppercase tracking-wider">{t('home_loyalty')}</span>
              </div>
              <div className="text-lg font-extrabold text-slate-900 dark:text-white">{t('home_loyalty_view')}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{t('home_loyalty_desc')}</div>
            </button>
          </div>
        );
      })()}

      {/* Accounts List (Horizontal Scroll) */}
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-3">{t('accounts')}</h3>
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2" role="tablist" aria-label={t('accounts')}>
          {state.accounts.map((acc) => (
            <div
              key={acc.ccy}
              role="tab"
              aria-selected={state.baseCurrency === acc.ccy}
              onClick={() => dispatch({ type: 'SET_BASE_CURRENCY', payload: acc.ccy })}
              className={`min-w-[160px] p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between h-32 ${
                state.baseCurrency === acc.ccy
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xl shadow-slate-900/20'
                  : 'bg-white dark:bg-surface-dark border-gray-200 dark:border-gray-700 text-slate-800 dark:text-slate-200'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-2xl">{acc.flag}</span>
                <span className="text-xs font-bold opacity-60">{acc.ccy}</span>
              </div>
              <div>
                <div className="text-lg font-bold truncate">{formatCurrency(acc.balance, acc.ccy)}</div>
                <div className="text-xs opacity-60 truncate">{acc.name}</div>
              </div>
            </div>
          ))}
          
          {/* Add Account Button */}
          <button 
            onClick={() => setActiveSheet('addAccount')}
            className="min-w-[100px] h-32 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
              <Icons.Plus size={20} />
            </div>
            <span className="text-xs font-bold">{t('add_new')}</span>
          </button>
        </div>
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{t('recent_transactions')}</h3>
          <button
            onClick={onViewAllTransactions}
            className="text-accent text-sm font-semibold hover:underline"
          >
            {t('view_all')}
          </button>
        </div>
        <div className="bg-white dark:bg-surface-dark rounded-3xl shadow-sm border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {state.transactions.slice(0, 5).map((tx) => (
            <div 
              key={tx.id} 
              onClick={() => { setSelectedTx(tx); setActiveSheet('txDetail'); }}
              className="flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors first:rounded-t-3xl last:rounded-b-3xl cursor-pointer"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-4 ${tx.amount < 0 ? 'bg-red-100 dark:bg-red-900/20 text-red-600' : 'bg-green-100 dark:bg-green-900/30 text-green-600'}`}>
                {tx.amount < 0 ? <Icons.ArrowUpRight size={18} /> : <Icons.ArrowDownLeft size={18} />}
              </div>
              <div className="flex-1">
                <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">{tx.title}</div>
                <div className="text-xs text-gray-500">{tx.date}</div>
              </div>
              <div className={`font-bold text-sm ${tx.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {tx.amount > 0 ? '+' : ''}{formatCurrency(tx.amount, tx.ccy)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* --- Bottom Sheets --- */}

      {/* Send Money Sheet */}
      <BottomSheet isOpen={activeSheet === 'send'} onClose={() => { setActiveSheet('none'); setAmount(''); }} title={t('send_money')}>
        <div className="p-2 space-y-6">
          <div className="text-center">
            <label className="text-sm text-gray-500">{t('amount_to_send')}</label>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className={`text-4xl font-bold ${isInsufficientFunds ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>{baseAccount.symbol}</span>
              <input 
                type="number" 
                value={amount} 
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`text-5xl font-bold bg-transparent w-48 text-center outline-none placeholder-gray-300 ${isInsufficientFunds ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}
                autoFocus
              />
            </div>
            <p aria-live="polite" className={`text-sm mt-2 font-medium ${isInsufficientFunds ? 'text-red-500' : 'text-gray-400'}`}>
              {isInsufficientFunds
                ? t('insufficient_funds')
                : `${t('available')}: ${formatCurrency(baseAccount.balance, baseAccount.ccy)}`
              }
            </p>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl">
              <label className="text-xs text-gray-500 font-bold uppercase block mb-2">{t('recipient')}</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Name, @tag, or Email"
                className="w-full bg-transparent outline-none text-lg font-semibold text-slate-900 dark:text-white"
              />
            </div>

            <button
              onClick={() => handleTransaction('debit')}
              disabled={!amount || !recipient || isInsufficientFunds}
              className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {t('send_money')}
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Request Money Sheet */}
      <BottomSheet isOpen={activeSheet === 'request'} onClose={() => { setActiveSheet('none'); setAmount(''); }} title={t('request_money')}>
        <div className="p-2 space-y-6">
          <div className="text-center">
            <label className="text-sm text-gray-500">{t('amount_to_request')}</label>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="text-4xl font-bold text-slate-900 dark:text-white">{baseAccount.symbol}</span>
              <input 
                type="number" 
                value={amount} 
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="text-5xl font-bold bg-transparent w-48 text-center outline-none text-slate-900 dark:text-white placeholder-gray-300"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl">
              <label className="text-xs text-gray-500 font-bold uppercase block mb-2">{t('from')}</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Name, @tag, or Email"
                className="w-full bg-transparent outline-none text-lg font-semibold text-slate-900 dark:text-white"
              />
            </div>

            <button
              onClick={() => handleTransaction('credit')}
              disabled={!amount || !recipient}
              className="w-full bg-primary text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('request_money')}
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Add Money (Crypto) Sheet */}
      <BottomSheet isOpen={activeSheet === 'addMoney'} onClose={() => setActiveSheet('none')} title={t('deposit_crypto')}>
        <div className="space-y-6">
          <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
            {(['BTC', 'ETH', 'USDT'] as const).map((crypto) => (
              <button
                key={crypto}
                onClick={() => setSelectedCrypto(crypto)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${selectedCrypto === crypto ? 'bg-white dark:bg-gray-700 shadow-sm text-slate-900 dark:text-white' : 'text-gray-500'}`}
              >
                {crypto}
              </button>
            ))}
          </div>
          
          <div className="flex flex-col items-center justify-center py-4">
            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm mb-4">
               <QRCodeSVG value={`mock-${selectedCrypto}-address`} size={200} />
            </div>
            <p className="text-xs text-center text-gray-500 max-w-[250px] break-all font-mono bg-gray-100 dark:bg-gray-800 p-3 rounded-lg">
              0x71C7656EC7ab88b098defB751B7401B5f6d8976F
            </p>
            <p className="text-xs text-center text-gray-400 mt-4">
              Send only {selectedCrypto} to this address. <br/>Adding other assets may result in permanent loss.
            </p>
          </div>
        </div>
      </BottomSheet>

      {/* Add Account Sheet */}
      <BottomSheet isOpen={activeSheet === 'addAccount'} onClose={() => setActiveSheet('none')} title={t('open_new_account')}>
        <div className="space-y-2">
          {AVAILABLE_CURRENCIES.map((curr) => {
             const exists = state.accounts.some(a => a.ccy === curr.ccy);
             return (
              <button
                key={curr.ccy}
                onClick={() => !exists && handleAddAccount(curr)}
                disabled={exists}
                className={`w-full flex items-center p-4 rounded-xl border transition-all ${exists ? 'opacity-50 border-transparent bg-gray-50 dark:bg-gray-800' : 'border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-2xl mr-4">
                  {curr.flag}
                </div>
                <div className="flex-1 text-left">
                  <div className="font-bold text-slate-900 dark:text-white">{curr.name}</div>
                  <div className="text-xs text-gray-500">1 {curr.ccy} ≈ ${curr.rateToUsd} USD</div>
                </div>
                {exists ? <Icons.Check size={20} className="text-green-500" /> : <Icons.Plus size={20} className="text-primary" />}
              </button>
             )
          })}
        </div>
      </BottomSheet>

      {/* Transaction Detail Sheet */}
      {selectedTx && (
        <BottomSheet isOpen={activeSheet === 'txDetail'} onClose={() => setActiveSheet('none')} title={t('transaction_details')}>
          <div className="flex flex-col items-center py-6">
             <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-4 ${selectedTx.amount < 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                {selectedTx.amount < 0 ? <Icons.Bank size={32} /> : <Icons.Wallet size={32} />}
             </div>
             <div className="text-2xl font-bold mb-1">{selectedTx.title}</div>
             <div className={`text-3xl font-black mb-6 ${selectedTx.amount < 0 ? 'text-slate-900 dark:text-white' : 'text-green-600'}`}>
                {selectedTx.amount > 0 ? '+' : ''}{formatCurrency(selectedTx.amount, selectedTx.ccy)}
             </div>

             <div className="w-full space-y-4">
                <div className="flex justify-between py-3 border-b border-gray-100 dark:border-gray-800">
                   <span className="text-gray-500">{t('status')}</span>
                   <span className="font-bold text-slate-900 dark:text-white capitalize flex items-center gap-2">
                     {selectedTx.status} <Icons.Check size={14} className="text-green-500" />
                   </span>
                </div>
                <div className="flex justify-between py-3 border-b border-gray-100 dark:border-gray-800">
                   <span className="text-gray-500">{t('date')}</span>
                   <span className="font-bold text-slate-900 dark:text-white">{selectedTx.date}</span>
                </div>
                <div className="flex justify-between py-3 border-b border-gray-100 dark:border-gray-800">
                   <span className="text-gray-500">{t('category')}</span>
                   <span className="font-bold text-slate-900 dark:text-white">{selectedTx.category || 'General'}</span>
                </div>
                <div className="flex justify-between py-3 border-b border-gray-100 dark:border-gray-800">
                   <span className="text-gray-500">{t('transaction_id')}</span>
                   <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">#{selectedTx.id}</span>
                </div>
             </div>

             <button className="mt-8 py-3 px-6 rounded-xl bg-gray-100 dark:bg-gray-800 text-slate-700 dark:text-white font-bold text-sm w-full">
               {t('report_issue')}
             </button>
          </div>
        </BottomSheet>
      )}

      {/* QR Scanner Sheet */}
      <BottomSheet
        isOpen={activeSheet === 'scanner'}
        onClose={() => { setActiveSheet('none'); setIsScanning(false); }}
        title={t('qr_scanner')}
      >
        <div className="flex flex-col items-center py-6">
          {/* Scanner Viewport */}
          <div className="relative w-64 h-64 bg-slate-900 rounded-3xl overflow-hidden mb-6">
            {/* Grid overlay */}
            <div className="absolute inset-4 border-2 border-white/30 rounded-2xl">
              {/* Corner markers */}
              <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-lg" />
              <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-lg" />
              <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-lg" />
              <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-lg" />
            </div>

            {/* Scanning line animation */}
            {isScanning && (
              <div
                className="absolute left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan"
              />
            )}

            {/* Center icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Icons.Scan size={48} className="text-white/20" />
            </div>
          </div>

          {/* Status */}
          <div className="text-center mb-6">
            {isScanning ? (
              <>
                <p className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                  {t('scanning')}
                </p>
                <div className="w-48 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-100"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-gray-500">{t('point_camera')}</p>
            )}
          </div>

          {/* Supported currencies */}
          <div className="flex gap-4 justify-center">
            {(['BTC', 'ETH', 'CRC', 'USD'] as QRCurrency[]).map((ccy) => {
              const info = getCurrencyInfo(ccy);
              return (
                <div key={ccy} className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-lg mb-1">
                    {info.flag}
                  </div>
                  <span className="text-xs text-gray-500">{ccy}</span>
                </div>
              );
            })}
          </div>
        </div>
      </BottomSheet>

      {/* Scan Result Sheet */}
      {scannedPayment && (
        <BottomSheet
          isOpen={activeSheet === 'scanResult'}
          onClose={() => { setActiveSheet('none'); setScannedPayment(null); setPaymentAmount(''); }}
          title={t('payment_detected')}
        >
          <div className="space-y-6">
            {/* Payment info */}
            <div className="bg-gradient-to-br from-primary/10 to-accent/10 rounded-2xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-white dark:bg-gray-800 flex items-center justify-center text-2xl shadow-sm">
                  {getCurrencyInfo(scannedPayment.currency).flag}
                </div>
                <div>
                  <p className="text-sm text-gray-500">{t('recipient')}</p>
                  <p className="text-xl font-black text-slate-900 dark:text-white">
                    {scannedPayment.userName}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t('currency')}</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {getCurrencyInfo(scannedPayment.currency).name} ({scannedPayment.currency})
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t('address')}</span>
                  <span className="font-mono text-xs text-slate-900 dark:text-white truncate max-w-[180px]">
                    {scannedPayment.address}
                  </span>
                </div>
              </div>
            </div>

            {/* Amount input */}
            <div>
              <label className="text-sm text-gray-500 font-medium mb-2 block">
                {t('amount')} ({scannedPayment.currency})
              </label>
              <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl p-4">
                <span className="text-2xl font-bold text-slate-900 dark:text-white mr-2">
                  {getCurrencyInfo(scannedPayment.currency).symbol}
                </span>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-2xl font-bold outline-none text-slate-900 dark:text-white"
                  autoFocus
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => { setActiveSheet('none'); setScannedPayment(null); }}
                className="flex-1 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-slate-900 dark:text-white font-bold"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleScannedPayment}
                disabled={!paymentAmount || parseFloat(paymentAmount) <= 0}
                className="flex-1 py-4 rounded-xl bg-primary text-white font-bold disabled:opacity-50"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

    </div>
  );
};
