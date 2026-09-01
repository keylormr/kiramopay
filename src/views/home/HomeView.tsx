
import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '@/hooks/useApp';
import { Icons } from '../../components/Icons';
import { BottomSheet } from '../../components/BottomSheet';
import { MfaChallengeSheet } from '../../components/MfaChallengeSheet';
import { QrScannerPanel } from '../../components/QrScannerPanel';
import { HelpButton } from '../../components/HelpSheet';
import { GraficoArea } from '../../components/GraficoArea';
import { Account, Transaction, SinpeContact } from '../../types';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '../../i18n/LanguageContext';
import { txTitle } from '../../utils/txTitle';
import { getApiLayer, MFA_REQUIRED } from '@/api';
import { refreshAccounts, refreshTransactions } from '@/services/dataSync';
import { useNotificationStore } from '@/stores/notification.store';
import type { QRPaymentCode, QRPayment } from '@/api/repositories/qrpayment.repository';
import { tryParseContactQr, type ContactQrPayload } from '@/utils/contactQr';
import { normalizarTelefonoCR, formatearTelefonoCR } from '@/utils/telefono';
import { getTxTime } from '@/utils/fechasTx';
import { parsearQrKiramo } from '@/utils/qrKiramo';

const AVAILABLE_CURRENCIES: Partial<Account>[] = [
  { ccy: 'GBP', symbol: '£', flag: '🇬🇧', name: 'British Pound', type: 'fiat', rateToUsd: 1.26 },
  { ccy: 'JPY', symbol: '¥', flag: '🇯🇵', name: 'Japanese Yen', type: 'fiat', rateToUsd: 0.0067 },
  { ccy: 'BTC', symbol: '₿', flag: '🟠', name: 'Bitcoin', type: 'crypto', rateToUsd: 43000 },
  { ccy: 'ETH', symbol: 'Ξ', flag: '🔷', name: 'Ethereum', type: 'crypto', rateToUsd: 2250 },
];

type QRCurrency = 'BTC' | 'ETH' | 'CRC' | 'USD';

interface HomeViewProps {
  onViewAllTransactions?: () => void;
  onOpenAnalytics?: () => void;
  onOpenSavings?: () => void;
  onOpenSplitPay?: () => void;
  onOpenLoyalty?: () => void;
  onOpenAssistant?: () => void;
  onOpenMarketplace?: () => void;
  onOpenCards?: () => void;
  onNavigateToSinpe?: (tab?: 'send' | 'receive') => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onViewAllTransactions, onOpenAnalytics, onOpenSavings, onOpenSplitPay, onOpenLoyalty, onOpenAssistant, onOpenMarketplace, onOpenCards, onNavigateToSinpe }) => {
  const { state, dispatch } = useApp();
  const { t } = useLanguage();

  // Los movimientos se refrescan solos cuando llega una notificación en vivo
  // (WebSocket): dinero que entra o sale aparece en la lista sin que el
  // usuario tenga que salir y volver. Diferido al próximo tick para no
  // disparar trabajo síncrono dentro del efecto.
  const ultimaNotificacion = useNotificationStore((s) => s.notifications[0]?.id);
  useEffect(() => {
    if (!ultimaNotificacion) return;
    const timer = setTimeout(() => {
      refreshTransactions().catch(() => {});
      refreshAccounts().catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [ultimaNotificacion]);

  // Sheet States
  const [activeSheet, setActiveSheet] = useState<'none' | 'addMoney' | 'addAccount' | 'txDetail' | 'scanner' | 'scanResult' | 'cobrar' | 'enviarA'>('none');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  // A scanned QR may be a contact (added to the list) instead of a payment.
  const [scannedContact, setScannedContact] = useState<ContactQrPayload | null>(null);

  // Envio directo al escanear el QR de una persona: escanear -> monto ->
  // enviar. Antes escanear solo agregaba el contacto y habia que ir a
  // buscarlo a SINPE para transferirle; ahora la transferencia ES el flujo.
  const [envioMonto, setEnvioMonto] = useState('');
  const [envioNota, setEnvioNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [envioError, setEnvioError] = useState('');
  const [envioListo, setEnvioListo] = useState(false);
  const [contactoGuardado, setContactoGuardado] = useState(false);
  const [showEnvioMfa, setShowEnvioMfa] = useState(false);
  // Una misma intencion de envio conserva su clave de idempotencia (el
  // reintento post-MFA no debe duplicar la transferencia).
  const idemEnvioRef = useRef('');

  // "Cobrar con QR" — genera un QR de cobro REAL via la API (riel QR del backend,
  // contabilizado en el ledger). Generar el codigo no mueve dinero; el pago
  // ocurre cuando alguien lo escanea (scanAndPay). Inspirado en el modelo
  // China/Pix: cobrar por QR, sin datafono.
  const [cobrarAmount, setCobrarAmount] = useState('');
  const [cobrarCode, setCobrarCode] = useState<QRPaymentCode | null>(null);
  const [cobrarLoading, setCobrarLoading] = useState(false);
  const [cobrarError, setCobrarError] = useState('');


  // Scanner / pay-by-QR states. The scanner reads a real QR via the camera
  // (or manual entry) and pays it through the backend QR rail (scanAndPay),
  // which moves money atomically on the ledger.
  const [scannedQrData, setScannedQrData] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState('');
  const [payResult, setPayResult] = useState<QRPayment | null>(null);

  const formatCurrency = (amount: number, ccy: string) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currencyDisplay: 'narrowSymbol', currency: ccy }).format(amount);
    } catch {
      return `${amount} ${ccy}`;
    }
  };

  // Never let an empty accounts store crash the view (e.g. cleared browser data
  // or a store migration): fall back to a zero-balance placeholder account.
  const baseAccount = state.accounts.find(a => a.ccy === state.baseCurrency)
    || state.accounts[0]
    || {
      ccy: state.baseCurrency || 'CRC',
      balance: 0,
      symbol: state.baseCurrency === 'USD' ? '$' : '₡',
      flag: '🏦',
      iban: '',
      name: state.baseCurrency || 'CRC',
      type: 'fiat' as const,
      rateToUsd: state.baseCurrency === 'USD' ? 1 : undefined,
    };
  
  const totalUsdEstimate = state.accounts.reduce((acc, curr) => {
    const rate = curr.rateToUsd || 1;
    return acc + (curr.balance * rate);
  }, 0);


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

  // Abre la hoja del escáner; la cámara la maneja QrScannerPanel.
  const startQRScan = () => {
    setActiveSheet('scanner');
  };

  // Un código leído aquí puede ser dos cosas distintas: un QR de contacto, que
  // agrega a alguien y nunca toca el riel de pago, o cualquier otro, que va al
  // flujo de cobro. Vale para la cámara y para el respaldo manual.
  const handleScannedCode = (raw: string) => {
    const contact = tryParseContactQr(raw);
    if (contact) {
      // Directo a "cuanto le envias": el gesto de escanear a una persona ES
      // querer transferirle (guardar el contacto queda como accion secundaria
      // dentro de la misma hoja).
      setScannedContact(contact);
      setEnvioMonto('');
      setEnvioNota('');
      setEnvioError('');
      setEnvioListo(false);
      setContactoGuardado(false);
      idemEnvioRef.current = '';
      setActiveSheet('enviarA'); // cerrar la hoja apaga la cámara
      return;
    }
    setScannedQrData(raw);
    setPaymentAmount('');
    setPayError('');
    setPayResult(null);
    setActiveSheet('scanResult');
  };

  const handleAddScannedContact = () => {
    if (!scannedContact || contactoGuardado) return;
    const contact: SinpeContact = {
      id: Date.now().toString(),
      name: scannedContact.name,
      phone: scannedContact.phone,
      bank: scannedContact.bank || 'Desconocido',
      isFavorite: false,
    };
    dispatch({ type: 'ADD_SINPE_CONTACT', payload: contact });
    setContactoGuardado(true);
  };

  // Transferencia real por el riel SINPE al usuario escaneado.
  const handleEnviarAEscaneado = async () => {
    if (!scannedContact || enviando) return;
    const monto = parseFloat(envioMonto);
    if (!(monto > 0)) return;
    const telefono = normalizarTelefonoCR(scannedContact.phone);
    if (!telefono) {
      setEnvioError(t('sinpe_phone_invalid'));
      return;
    }
    if (!idemEnvioRef.current) {
      idemEnvioRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setEnviando(true);
    setEnvioError('');
    try {
      const res = await getApiLayer().sinpe.send({
        phone: telefono,
        amount: monto,
        description: envioNota,
        idempotencyKey: idemEnvioRef.current,
      });
      if (!res.success || !res.data) {
        if (res.error?.code === MFA_REQUIRED) {
          setShowEnvioMfa(true);
          return;
        }
        // Un reintento corregido debe ser una transferencia nueva.
        idemEnvioRef.current = '';
        const porCodigo: Record<string, string> = {
          RECIPIENT_NOT_USER: t('sinpe_recipient_not_user'),
          SELF_SEND: t('sinpe_self_send_error'),
        };
        setEnvioError(porCodigo[res.error?.code ?? ''] || res.error?.message || t('assistant_action_failed'));
        return;
      }
      idemEnvioRef.current = '';
      setEnvioListo(true);
      refreshAccounts().catch(() => {});
      refreshTransactions().catch(() => {});
    } finally {
      setEnviando(false);
    }
  };

  // Pago real: paga el QR escaneado por el riel QR del backend (mueve dinero en
  // el ledger). Generar el código no movía dinero; esto sí.
  const handleScannedPayment = async () => {
    if (!scannedQrData) return;
    setPayLoading(true);
    setPayError('');
    try {
      const api = getApiLayer();
      if (!api.qrPayments) {
        setPayError(t('qr_pay_error'));
        return;
      }
      const amt = parseFloat(paymentAmount);
      const res = await api.qrPayments.scanAndPay({
        qrData: scannedQrData,
        amount: Number.isFinite(amt) && amt > 0 ? amt : undefined,
        currency: baseAccount?.ccy ?? 'CRC',
      });
      if (res.success && res.data) {
        setPayResult(res.data);
        refreshAccounts().catch(() => {});
      } else {
        setPayError(res.error?.message || t('qr_pay_error'));
      }
    } catch {
      setPayError(t('qr_pay_error'));
    } finally {
      setPayLoading(false);
    }
  };

  // Genera un QR de cobro real contra el riel QR del backend.
  const handleGenerateCobrar = async () => {
    setCobrarLoading(true);
    setCobrarError('');
    setCobrarCode(null);
    try {
      const api = getApiLayer();
      if (!api.qrPayments) {
        setCobrarError(t('qr_gen_error'));
        return;
      }
      const amt = parseFloat(cobrarAmount);
      const res = await api.qrPayments.createQRCode({
        type: 'p2p_receive',
        amount: Number.isFinite(amt) && amt > 0 ? amt : undefined,
        currency: baseAccount?.ccy ?? 'CRC',
        singleUse: false,
      });
      if (res.success && res.data) {
        setCobrarCode(res.data);
      } else {
        setCobrarError(res.error?.message || t('qr_gen_error'));
      }
    } catch {
      setCobrarError(t('qr_gen_error'));
    } finally {
      setCobrarLoading(false);
    }
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
      
      {/* Main Balance Card — Unified Vision hero treatment */}
      <div className="relative overflow-hidden uv-gradient-brand rounded-3xl p-6 uv-shadow-floating text-white">
        {/* Decorative blur orb */}
        <div
          className="absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-30 pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.6), transparent)' }}
        />
        <div className="relative flex justify-between items-start mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/70">
            {t('total_balance')}
          </span>
          <div className="px-2.5 py-1 bg-white/15 backdrop-blur-sm text-white text-[11px] font-bold rounded-full">
            {state.baseCurrency} · Base
          </div>
        </div>
        <div className="relative text-[2.5rem] leading-tight font-black tracking-tight mb-1 tabular-nums">
          {formatCurrency(baseAccount.balance, baseAccount.ccy)}
        </div>
        <div className="relative text-sm text-white/70 mb-6 tabular-nums">
          ≈ ${totalUsdEstimate.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD Total
        </div>

        <div className="relative flex gap-2.5">
          <button
            onClick={() => setActiveSheet('addMoney')}
            className="flex-1 bg-white text-[var(--color-navy-800)] h-11 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform"
          >
            {t('add_money')}
          </button>
          <button
            onClick={() => setActiveSheet('addAccount')}
            aria-label={t('open_new_account')}
            className="w-11 h-11 flex items-center justify-center bg-white/15 backdrop-blur-sm rounded-xl border border-white/20 text-white active:scale-[0.98] transition-transform"
          >
            <Icons.Plus size={18} />
          </button>
        </div>
      </div>

      {/* Acciones rapidas primero: el gesto mas frecuente (enviar, escanear)
          queda bajo el pulgar apenas abre la app. */}
      <div>
        <h3 className="text-base font-bold uv-text-primary mb-3 tracking-tight">{t('quick_actions')}</h3>
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: Icons.Send, label: t('send'), color: 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]', action: () => onNavigateToSinpe?.('send') },
            { icon: Icons.Receive, label: t('receive'), color: 'bg-[var(--color-success-soft)] text-[var(--color-success)]', action: () => onNavigateToSinpe?.('receive') },
            { icon: Icons.Scan, label: t('scan_qr'), color: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]', action: startQRScan },
            { icon: Icons.QrCode, label: t('charge_qr'), color: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]', action: () => setActiveSheet('cobrar') },
          ].map((action, i) => (
            <button key={i} onClick={action.action} className="flex flex-col items-center gap-2 group">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${action.color} uv-shadow-soft group-active:scale-[0.94] transition-transform`}>
                <action.icon size={22} />
              </div>
              <span className="text-[11px] font-semibold uv-text-secondary">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Gastado este mes: cifra viva con su curva acumulada del mes y el
          contraste contra el mes pasado. Toca -> analitica completa. */}
      {(() => {
        const ahora = new Date();
        const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
        const inicioMesPasado = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1).getTime();
        const diaHoy = ahora.getDate();

        // Acumulado diario del mes en curso (gastos del store sincronizado).
        const porDia = new Array(diaHoy).fill(0);
        let gastadoMesPasado = 0;
        for (const tx of state.transactions) {
          if (tx.amount >= 0) continue;
          const time = getTxTime(tx);
          if (time === null) continue;
          if (time >= inicioMes) {
            const d = new Date(time).getDate();
            if (d >= 1 && d <= diaHoy) porDia[d - 1] += Math.abs(tx.amount);
          } else if (time >= inicioMesPasado) {
            gastadoMesPasado += Math.abs(tx.amount);
          }
        }
        const acumulado: number[] = [];
        porDia.reduce((s, v) => { const acc = s + v; acumulado.push(acc); return acc; }, 0);
        const gastadoMes = acumulado[acumulado.length - 1] ?? 0;
        const delta = gastadoMesPasado > 0
          ? ((gastadoMes - gastadoMesPasado) / gastadoMesPasado) * 100
          : null;
        const etiquetas = acumulado.map((_, i) => `${i + 1}/${ahora.getMonth() + 1}`);

        return (
          <button
            onClick={onOpenAnalytics}
            className="w-full text-left uv-surface-1 rounded-2xl uv-shadow-soft border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4 card-interactive"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uv-text-muted uppercase tracking-wider">{t('home_spent_month')}</p>
                <p className="text-2xl font-black uv-text-primary tabular-nums mt-0.5">
                  {formatCurrency(gastadoMes, 'CRC')}
                </p>
              </div>
              {delta !== null && Math.abs(delta) >= 1 && (
                <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${delta <= 0 ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]' : 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'}`}>
                  {delta <= 0 ? '▼' : '▲'} {Math.abs(delta).toFixed(0)}% {t('home_vs_last_month')}
                </span>
              )}
            </div>
            {acumulado.length >= 2 && gastadoMes > 0 && (
              <GraficoArea
                puntos={acumulado}
                etiquetas={etiquetas}
                alto={72}
                className="mt-2 -mx-1"
                formato={(v) => formatCurrency(v, 'CRC')}
                titulo={t('home_spent_month')}
              />
            )}
          </button>
        );
      })()}

      {/* Transacciones recientes: cuatro entradas; el refresco llega solo con
          la notificacion en vivo (efecto de arriba). */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-base font-bold uv-text-primary tracking-tight">{t('recent_transactions')}</h3>
          <button
            onClick={onViewAllTransactions}
            className="text-[var(--color-primary)] text-sm font-semibold hover:underline"
          >
            {t('view_all')}
          </button>
        </div>
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          {state.transactions.slice(0, 4).map((tx) => {
            const incoming = tx.amount > 0;
            return (
              <div
                key={tx.id}
                onClick={() => { setSelectedTx(tx); setActiveSheet('txDetail'); }}
                className="flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors cursor-pointer"
              >
                <div className={`w-11 h-11 rounded-full flex items-center justify-center mr-3.5 shrink-0 ${incoming ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]' : 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'}`}>
                  {incoming ? <Icons.ArrowDownLeft size={18} /> : <Icons.ArrowUpRight size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold uv-text-primary text-sm truncate">{txTitle(tx, t)}</div>
                  <div className="text-xs uv-text-muted mt-0.5">{tx.date}</div>
                </div>
                <div className={`font-bold text-sm tabular-nums shrink-0 ${incoming ? 'text-[var(--color-success)]' : 'uv-text-primary'}`}>
                  {incoming ? '+' : ''}{formatCurrency(tx.amount, tx.ccy)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Monthly Insights Card */}
      {(() => {
        return (
          <div className="grid grid-cols-2 gap-3">
            {/* El "?" va como hermano de la tarjeta, nunca adentro: la tarjeta
                ya es un <button> y anidar un botón en otro es HTML inválido.
                Puesto aquí, se puede preguntar qué es una función ANTES de
                entrar a ella. */}
            <div className="col-span-2 relative">
              <button
                onClick={onOpenAssistant}
                className="w-full uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-left card-interactive flex items-center gap-3"
              >
                <div className="w-10 h-10 shrink-0 rounded-xl uv-gradient-brand flex items-center justify-center">
                  <Icons.MessageCircle size={20} className="text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-extrabold uv-text-primary">{t('assistant_title')}</div>
                  <div className="text-[11px] uv-text-muted mt-0.5">{t('assistant_card_desc')}</div>
                </div>
              </button>
              <HelpButton topic="assistant" className="absolute top-2 right-2" />
            </div>

            {/* La tarjeta de gastos vivio aqui hasta que "Gastado este mes"
                (arriba, con curva) la volvio redundante. */}
            <div className="relative">
              <button
                onClick={onOpenSavings}
                className="w-full h-full uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-left card-interactive"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--color-success-soft)] flex items-center justify-center">
                    <Icons.PiggyBank size={16} className="text-[var(--color-success)]" />
                  </div>
                  <span className="text-[10px] font-bold uv-text-muted uppercase tracking-wider">{t('home_savings')}</span>
                </div>
                <div className="text-lg font-extrabold uv-text-primary">{t('home_savings_view')}</div>
                <div className="text-[10px] uv-text-muted mt-0.5">{t('home_savings_desc')}</div>
              </button>
              <HelpButton topic="savings" className="absolute top-2 right-2" />
            </div>

            <div className="relative">
              <button
                onClick={onOpenSplitPay}
                className="w-full h-full uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-left card-interactive"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--color-primary-soft)] flex items-center justify-center">
                    <Icons.Users size={16} className="text-[var(--color-primary)]" />
                  </div>
                  <span className="text-[10px] font-bold uv-text-muted uppercase tracking-wider">{t('home_split')}</span>
                </div>
                <div className="text-lg font-extrabold uv-text-primary">{t('home_split_view')}</div>
                <div className="text-[10px] uv-text-muted mt-0.5">{t('home_split_desc')}</div>
              </button>
              <HelpButton topic="splitpay" className="absolute top-2 right-2" />
            </div>

            <div className="relative">
              <button
                onClick={onOpenLoyalty}
                className="w-full h-full uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-left card-interactive"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--color-accent-soft)] flex items-center justify-center">
                    <Icons.Award size={16} className="text-[var(--color-accent)]" />
                  </div>
                  <span className="text-[10px] font-bold uv-text-muted uppercase tracking-wider">{t('home_loyalty')}</span>
                </div>
                <div className="text-lg font-extrabold uv-text-primary">{t('home_loyalty_view')}</div>
                <div className="text-[10px] uv-text-muted mt-0.5">{t('home_loyalty_desc')}</div>
              </button>
              <HelpButton topic="loyalty" className="absolute top-2 right-2" />
            </div>

            <div className="relative">
              <button
                onClick={onOpenMarketplace}
                className="w-full h-full uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-left card-interactive"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--color-primary-soft)] flex items-center justify-center">
                    <Icons.ShoppingCart size={16} className="text-[var(--color-primary)]" />
                  </div>
                  <span className="text-[10px] font-bold uv-text-muted uppercase tracking-wider">{t('home_marketplace')}</span>
                </div>
                <div className="text-lg font-extrabold uv-text-primary">{t('home_marketplace_view')}</div>
                <div className="text-[10px] uv-text-muted mt-0.5">{t('home_marketplace_desc')}</div>
              </button>
              <HelpButton topic="marketplace" className="absolute top-2 right-2" />
            </div>

            <div className="relative">
              <button
                onClick={onOpenCards}
                className="w-full h-full uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-left card-interactive"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--color-accent-soft)] flex items-center justify-center">
                    <Icons.Card size={16} className="text-[var(--color-accent)]" />
                  </div>
                  <span className="text-[10px] font-bold uv-text-muted uppercase tracking-wider">{t('home_cards')}</span>
                </div>
                <div className="text-lg font-extrabold uv-text-primary">{t('home_cards_view')}</div>
                <div className="text-[10px] uv-text-muted mt-0.5">{t('home_cards_desc')}</div>
              </button>
              <HelpButton topic="cards" className="absolute top-2 right-2" />
            </div>
          </div>
        );
      })()}

      {/* Accounts List (Horizontal Scroll) */}
      <div>
        <h3 className="text-base font-bold uv-text-primary mb-3 tracking-tight">{t('accounts')}</h3>
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2" role="tablist" aria-label={t('accounts')}>
          {state.accounts.map((acc) => {
            const selected = state.baseCurrency === acc.ccy;
            return (
              <button
                key={acc.ccy}
                role="tab"
                aria-selected={selected}
                onClick={() => dispatch({ type: 'SET_BASE_CURRENCY', payload: acc.ccy })}
                className={`min-w-[160px] p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between h-32 text-left ${
                  selected
                    ? 'uv-gradient-brand text-white border-transparent uv-shadow-primary'
                    : 'uv-surface-1 uv-text-primary uv-shadow-soft hover:uv-shadow-elevated'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="text-2xl">{acc.flag}</span>
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${selected ? 'text-white/70' : 'uv-text-muted'}`}>{acc.ccy}</span>
                </div>
                <div>
                  <div className="text-lg font-bold truncate tabular-nums">{formatCurrency(acc.balance, acc.ccy)}</div>
                  <div className={`text-xs truncate ${selected ? 'text-white/70' : 'uv-text-muted'}`}>{acc.name}</div>
                </div>
              </button>
            );
          })}

          {/* Add Account Button */}
          <button
            onClick={() => setActiveSheet('addAccount')}
            className="min-w-[100px] h-32 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--color-border-strong)] dark:border-[var(--color-border-dark)] uv-text-muted hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center mb-2">
              <Icons.Plus size={20} />
            </div>
            <span className="text-xs font-bold">{t('add_new')}</span>
          </button>
        </div>
      </div>

      {/* --- Bottom Sheets --- */}

      {/* Cobrar con QR — genera un QR de cobro real (modelo China/Pix: sin datafono) */}
      <BottomSheet
        isOpen={activeSheet === 'cobrar'}
        onClose={() => { setActiveSheet('none'); setCobrarAmount(''); setCobrarCode(null); setCobrarError(''); }}
        title={t('charge_qr')}
      >
        <div className="p-2 space-y-6">
          {!cobrarCode ? (
            <>
              <div className="text-center">
                <label className="text-sm text-gray-500">{t('charge_amount_optional')}</label>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <span className="text-4xl font-bold uv-text-primary">{baseAccount?.symbol ?? '₡'}</span>
                  <input
                    type="number"
                    value={cobrarAmount}
                    onChange={(e) => setCobrarAmount(e.target.value)}
                    placeholder="0.00"
                    className="text-5xl font-bold bg-transparent w-48 text-center outline-none uv-text-primary placeholder-gray-300"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">{t('charge_amount_hint')}</p>
              </div>

              {cobrarError && (
                <p className="text-[var(--color-danger)] text-sm text-center" aria-live="polite">{cobrarError}</p>
              )}

              <button
                onClick={handleGenerateCobrar}
                disabled={cobrarLoading}
                className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cobrarLoading ? t('generating') : t('generate_qr')}
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center space-y-4">
              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                <QRCodeSVG value={cobrarCode.qrData} size={200} />
              </div>
              {cobrarCode.amount > 0 && (
                <p className="text-3xl font-black uv-text-primary tabular-nums">
                  {baseAccount?.symbol ?? '₡'}{cobrarCode.amount}
                </p>
              )}
              <p className="text-sm text-gray-500 text-center max-w-[280px]">{t('charge_qr_help')}</p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => { navigator.clipboard?.writeText(cobrarCode.qrData); }}
                  className="flex-1 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary py-3 rounded-xl font-bold flex items-center justify-center gap-2"
                >
                  <Icons.Copy size={18} /> {t('copy')}
                </button>
                <button
                  onClick={() => { setCobrarCode(null); setCobrarAmount(''); }}
                  className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-xl font-bold"
                >
                  {t('new_qr')}
                </button>
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Add Money (Crypto) Sheet */}
      <BottomSheet isOpen={activeSheet === 'addMoney'} onClose={() => setActiveSheet('none')} title={t('deposit_crypto')}>
        <div className="flex flex-col items-center text-center py-8 px-4 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center">
            <Icons.Clock size={30} className="text-[var(--color-primary)]" />
          </div>
          <h3 className="text-lg font-bold uv-text-primary">{t('crypto_deposit_unavailable_title')}</h3>
          <p className="text-sm text-gray-500 max-w-[300px]">{t('crypto_deposit_unavailable_desc')}</p>
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
                className={`w-full flex items-center p-4 rounded-xl border transition-all ${exists ? 'opacity-50 border-transparent uv-surface-2' : 'border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                <div className="w-12 h-12 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center text-2xl mr-4">
                  {curr.flag}
                </div>
                <div className="flex-1 text-left">
                  <div className="font-bold uv-text-primary">{curr.name}</div>
                  <div className="text-xs text-gray-500">1 {curr.ccy} ≈ ${curr.rateToUsd} USD</div>
                </div>
                {exists ? <Icons.Check size={20} className="text-green-500" /> : <Icons.Plus size={20} className="text-[var(--color-primary)]" />}
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
             <div className="text-2xl font-bold mb-1">{txTitle(selectedTx, t)}</div>
             <div className={`text-3xl font-black mb-6 ${selectedTx.amount < 0 ? 'uv-text-primary' : 'text-green-600'}`}>
                {selectedTx.amount > 0 ? '+' : ''}{formatCurrency(selectedTx.amount, selectedTx.ccy)}
             </div>

             <div className="w-full space-y-4">
                <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                   <span className="uv-text-muted">{t('status')}</span>
                   <span className="font-bold uv-text-primary capitalize flex items-center gap-2">
                     {selectedTx.status} <Icons.Check size={14} className="text-green-500" />
                   </span>
                </div>
                <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                   <span className="uv-text-muted">{t('date')}</span>
                   <span className="font-bold uv-text-primary">{selectedTx.date}</span>
                </div>
                <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                   <span className="uv-text-muted">{t('category')}</span>
                   <span className="font-bold uv-text-primary">{selectedTx.category || 'General'}</span>
                </div>
                <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                   <span className="uv-text-muted">{t('transaction_id')}</span>
                   <span className="font-mono text-xs font-bold uv-text-primary">#{selectedTx.id}</span>
                </div>
             </div>

             <button className="mt-8 py-3 px-6 rounded-xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-slate-700 dark:text-white font-bold text-sm w-full">
               {t('report_issue')}
             </button>
          </div>
        </BottomSheet>
      )}

      {/* QR Scanner Sheet — cámara real (jsQR) con fallback manual */}
      <BottomSheet
        isOpen={activeSheet === 'scanner'}
        onClose={() => setActiveSheet('none')}
        title={t('qr_scanner')}
      >
        <QrScannerPanel active={activeSheet === 'scanner'} onDecode={handleScannedCode}>
          {/* Monedas soportadas */}
          <div className="flex gap-4 justify-center mt-6">
            {(['BTC', 'ETH', 'CRC', 'USD'] as QRCurrency[]).map((ccy) => {
              const info = getCurrencyInfo(ccy);
              return (
                <div key={ccy} className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center text-lg mb-1">
                    {info.flag}
                  </div>
                  <span className="text-xs text-gray-500">{ccy}</span>
                </div>
              );
            })}
          </div>
        </QrScannerPanel>
      </BottomSheet>

      {/* Scan Result / Pay Sheet — pago real via scanAndPay (mueve dinero en el ledger) */}
      {scannedQrData && (
        <BottomSheet
          isOpen={activeSheet === 'scanResult'}
          onClose={() => { setActiveSheet('none'); setScannedQrData(null); setPaymentAmount(''); setPayError(''); setPayResult(null); }}
          title={payResult ? t('payment_done') : t('payment_detected')}
        >
          {payResult ? (
            <div className="flex flex-col items-center space-y-4 py-4">
              <div className="w-16 h-16 rounded-full bg-[var(--color-success-soft)] flex items-center justify-center">
                <Icons.Check size={32} className="text-[var(--color-success)]" />
              </div>
              <p className="text-3xl font-black uv-text-primary tabular-nums">
                {payResult.currency} {payResult.amount}
              </p>
              <p className="uv-text-muted text-sm">{t('payment_done')}</p>
              <button
                onClick={() => { setActiveSheet('none'); setScannedQrData(null); setPaymentAmount(''); setPayResult(null); }}
                className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-xl font-bold"
              >
                {t('done')}
              </button>
            </div>
          ) : (() => {
            // El QR de KiramoPay trae el monto adentro (en centimos): si es
            // fijo, se MUESTRA grande y pagar es UN toque — nada de payload
            // tecnico en pantalla ni de teclear lo que el codigo ya dice.
            const qr = parsearQrKiramo(scannedQrData || '');
            const montoFijo = qr && qr.monto > 0 ? qr.monto : null;
            return (
              <div className="space-y-6">
                <div className="text-center py-2">
                  {montoFijo !== null ? (
                    <>
                      <p className="text-sm uv-text-muted mb-1">{t('qr_te_solicitan')}</p>
                      <p className="text-4xl font-black uv-text-primary tabular-nums">
                        {formatCurrency(montoFijo, qr?.moneda || 'CRC')}
                      </p>
                    </>
                  ) : (
                    <div>
                      <label className="text-sm text-gray-500 font-medium mb-2 block">
                        {t('amount')} ({baseAccount?.ccy ?? 'CRC'})
                      </label>
                      <div className="flex items-center bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl p-4">
                        <span className="text-2xl font-bold uv-text-primary mr-2">{baseAccount?.symbol ?? '₡'}</span>
                        <input
                          type="number"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          placeholder="0.00"
                          className="flex-1 bg-transparent text-2xl font-bold outline-none uv-text-primary"
                          autoFocus
                        />
                      </div>
                    </div>
                  )}
                </div>

                {payError && (
                  <p className="text-[var(--color-danger)] text-sm text-center" aria-live="polite">{payError}</p>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => { setActiveSheet('none'); setScannedQrData(null); setPaymentAmount(''); setPayError(''); }}
                    className="flex-1 py-4 rounded-xl border-2 border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary font-bold"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={handleScannedPayment}
                    disabled={payLoading || (montoFijo === null && !(parseFloat(paymentAmount) > 0))}
                    className="flex-1 py-4 rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {payLoading && <div className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                    {payLoading ? t('paying') : t('pay')}
                  </button>
                </div>
              </div>
            );
          })()}
        </BottomSheet>
      )}

      {/* Envio directo al usuario escaneado: escanear -> monto -> enviar.
          Guardar el contacto es la accion secundaria, no el destino. */}
      <BottomSheet
        isOpen={activeSheet === 'enviarA'}
        onClose={() => { setActiveSheet('none'); setScannedContact(null); }}
        dismissable={!enviando}
        title={envioListo ? t('payment_done') : t('send_money')}
      >
        {scannedContact && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 uv-gradient-brand rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0">
                {scannedContact.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold uv-text-primary truncate">{scannedContact.name}</p>
                <p className="text-sm uv-text-muted tabular-nums">{formatearTelefonoCR(scannedContact.phone)}</p>
              </div>
            </div>

            {envioListo ? (
              <div className="flex flex-col items-center py-4 gap-3">
                <div className="w-14 h-14 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] flex items-center justify-center">
                  <Icons.Check size={28} />
                </div>
                <p className="text-2xl font-black uv-text-primary tabular-nums">{formatCurrency(parseFloat(envioMonto), 'CRC')}</p>
                <button
                  onClick={() => { setActiveSheet('none'); setScannedContact(null); }}
                  className="mt-2 w-full py-3.5 rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white font-bold"
                >
                  {t('done')}
                </button>
              </div>
            ) : (
              <>
                {/* Monto: el unico campo obligatorio, grande y con foco */}
                <div className="text-center py-2">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-3xl font-bold uv-text-muted">₡</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      autoFocus
                      value={envioMonto}
                      onChange={(e) => { setEnvioMonto(e.target.value); setEnvioError(''); }}
                      placeholder="0"
                      className="text-4xl font-black uv-text-primary bg-transparent outline-none w-40 text-center tabular-nums placeholder:uv-text-muted"
                    />
                  </div>
                </div>

                <input
                  type="text"
                  value={envioNota}
                  onChange={(e) => setEnvioNota(e.target.value)}
                  placeholder={t('sinpe_send_desc_ph')}
                  maxLength={60}
                  className="w-full h-12 px-4 rounded-xl uv-surface-2 uv-text-primary text-sm outline-none border border-transparent focus:border-[var(--color-primary)]"
                />

                {envioError && (
                  <p className="text-[var(--color-danger)] text-sm flex items-center gap-1">
                    <Icons.AlertCircle size={14} /> {envioError}
                  </p>
                )}

                <button
                  onClick={handleEnviarAEscaneado}
                  disabled={enviando || !(parseFloat(envioMonto) > 0)}
                  className="w-full py-4 rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {enviando ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      {t('processing')}
                    </>
                  ) : (
                    <>
                      <Icons.Send size={18} /> {t('send_money')}
                    </>
                  )}
                </button>

                <button
                  onClick={handleAddScannedContact}
                  disabled={contactoGuardado}
                  className="w-full py-2.5 text-sm font-semibold text-[var(--color-primary)] disabled:uv-text-muted"
                >
                  {contactoGuardado ? t('sinpe_contact_saved') : t('add_contact')}
                </button>
              </>
            )}
          </div>
        )}
      </BottomSheet>

      {/* TOTP para envios de monto alto desde el flujo de escaneo */}
      <MfaChallengeSheet
        isOpen={showEnvioMfa}
        onClose={() => setShowEnvioMfa(false)}
        onVerified={() => {
          setShowEnvioMfa(false);
          handleEnviarAEscaneado();
        }}
      />

    </div>
  );
};
