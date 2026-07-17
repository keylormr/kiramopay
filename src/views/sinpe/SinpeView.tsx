import React, { useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '../../i18n/LanguageContext';
import { Icons } from '../../components/Icons';
import { BottomSheet } from '../../components/BottomSheet';
import { MfaChallengeSheet } from '../../components/MfaChallengeSheet';
import { ConfirmSendSheet } from '../../components/ConfirmSendSheet';
import { getApiLayer, MFA_REQUIRED } from '@/api';
import { SinpeContact, SinpeTransaction } from '../../types';

// Bancos de Costa Rica para selección
const BANKS = [
  'Desconocido',
  'BAC',
  'BCR',
  'Banco Nacional',
  'Scotiabank',
  'Promerica',
  'Davivienda',
  'Lafise',
  'Mucap',
  'Coopenae',
  'Coopeservidores',
];

export const SinpeView: React.FC = () => {
  const { state, dispatch } = useApp();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'send' | 'receive' | 'history'>('send');
  const [showSendSheet, setShowSendSheet] = useState(false);
  const [showReceiveSheet, setShowReceiveSheet] = useState(false);
  const [showSuccessSheet, setShowSuccessSheet] = useState(false);
  const [showAddContactSheet, setShowAddContactSheet] = useState(false);
  const [selectedContact, setSelectedContact] = useState<SinpeContact | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Form states
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<SinpeTransaction | null>(null);

  // Add contact form states
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactBank, setNewContactBank] = useState('Desconocido');
  const [newContactFavorite, setNewContactFavorite] = useState(false);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' }).format(amount);
  };

  const crcAccount = state.accounts.find(a => a.ccy === 'CRC');
  const balance = crcAccount?.balance || 0;

  const handleSelectContact = (contact: SinpeContact) => {
    setSelectedContact(contact);
    setPhone(contact.phone.replace(/-/g, ''));
    setShowSendSheet(true);
  };

  const handleSendMoney = async () => {
    if (!amount || !phone) return;

    const numAmount = parseFloat(amount);
    if (numAmount > balance) return;

    setIsProcessing(true);
    setSendError('');
    // Real transfer through the API layer: the mock adapter records it locally,
    // the HTTP adapter moves money on the backend (and may require MFA).
    const res = await getApiLayer().sinpe.send({ phone, amount: numAmount, description: reference });
    setIsProcessing(false);

    if (!res.success || !res.data) {
      // High-value transfer: prompt for a TOTP code, then retry (form persists).
      if (res.error?.code === MFA_REQUIRED) {
        setShowConfirm(false);
        setShowMfa(true);
        return;
      }
      setShowConfirm(false);
      setSendError(res.error?.message || t('assistant_action_failed'));
      return;
    }

    const tx: SinpeTransaction = {
      id: res.data.id,
      type: 'sent',
      amount: numAmount,
      phone,
      name: selectedContact?.name || res.data.name || phone,
      date: 'Ahora',
      status: res.data.status,
      reference,
    };

    dispatch({ type: 'ADD_SINPE_TRANSACTION', payload: tx });
    setLastTransaction(tx);
    setShowConfirm(false);
    setShowSendSheet(false);
    setShowSuccessSheet(true);

    // Reset form
    setAmount('');
    setPhone('');
    setReference('');
    setSelectedContact(null);
  };

  const handleRequestMoney = () => {
    if (!amount || !phone) return;

    setIsProcessing(true);

    setTimeout(() => {
      setIsProcessing(false);
      setShowReceiveSheet(false);
      setAmount('');
      setPhone('');
      setReference('');
    }, 1500);
  };

  const handleAddContact = () => {
    if (!newContactName || !newContactPhone) return;

    const newContact: SinpeContact = {
      id: Date.now().toString(),
      name: newContactName,
      phone: newContactPhone.slice(0, 4) + '-' + newContactPhone.slice(4),
      bank: newContactBank,
      isFavorite: newContactFavorite,
    };

    dispatch({ type: 'ADD_SINPE_CONTACT', payload: newContact });

    // Reset form
    setNewContactName('');
    setNewContactPhone('');
    setNewContactBank('Desconocido');
    setNewContactFavorite(false);
    setShowAddContactSheet(false);
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    }
  };

  const handleShare = async (title: string, text: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
      } catch {
        // User cancelled or error
      }
    } else {
      // Fallback: copy to clipboard
      handleCopy(text, 'info');
    }
  };

  const favorites = state.sinpeContacts.filter(c => c.isFavorite);
  const allContacts = state.sinpeContacts;
  const userPhone = state.user?.phone || '+506 8888-0000';

  return (
    <div className="pb-24 pt-4 space-y-6 px-4">
      {/* Toast de copiado */}
      {copiedText && (
        <div aria-live="assertive" className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[var(--color-navy-900)] text-white px-4 py-2 rounded-full text-sm font-semibold uv-shadow-floating animate-fade-in-scale">
          {t('copied_to_clipboard')}
        </div>
      )}

      {/* Hero balance card — Unified Vision */}
      <div className="relative overflow-hidden uv-gradient-brand rounded-3xl p-6 text-white uv-shadow-floating">
        <div
          className="absolute -right-12 -bottom-12 w-40 h-40 rounded-full opacity-30 pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.5), transparent)' }}
        />
        <div className="relative flex items-center gap-2 mb-3">
          <div className="w-8 h-8 bg-white/15 rounded-lg flex items-center justify-center backdrop-blur-sm">
            <span className="text-base">🇨🇷</span>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-white/70">{t('sinpe_mobile')}</span>
        </div>
        <div className="relative text-3xl font-black mb-1 tabular-nums">
          {formatCurrency(balance)}
        </div>
        <div className="relative text-white/70 text-sm">{t('available_to_send')}</div>

        <div className="relative flex gap-2.5 mt-5">
          <button
            onClick={() => setShowSendSheet(true)}
            className="flex-1 bg-white text-[var(--color-navy-800)] h-11 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Icons.Send size={18} />
            {t('send')}
          </button>
          <button
            onClick={() => setShowReceiveSheet(true)}
            className="flex-1 bg-white/15 text-white h-11 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform border border-white/20 backdrop-blur-sm"
          >
            <Icons.Receive size={18} />
            {t('request')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] p-1 rounded-xl">
        {[
          { id: 'send', label: t('send') },
          { id: 'receive', label: t('request') },
          { id: 'history', label: t('history') },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'send' | 'receive' | 'history')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === tab.id
                ? 'uv-surface-1 uv-text-primary uv-shadow-soft'
                : 'uv-text-muted hover:uv-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content based on active tab */}
      {activeTab === 'send' && (
        <div className="space-y-6">
          {/* Favoritos */}
          <div>
            <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-3">
              {t('favorites')}
            </h3>
            <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
              {favorites.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => handleSelectContact(contact)}
                  className="flex flex-col items-center gap-2 min-w-[70px] group"
                >
                  <div className="w-14 h-14 uv-gradient-brand rounded-full flex items-center justify-center text-white font-bold text-lg uv-shadow-elevated group-active:scale-[0.94] transition-transform">
                    {contact.name.charAt(0)}
                  </div>
                  <span className="text-xs font-semibold uv-text-secondary truncate w-16 text-center">
                    {contact.name.split(' ')[0]}
                  </span>
                </button>
              ))}
              <button
                onClick={() => setShowAddContactSheet(true)}
                aria-label={t('add_contact')}
                className="flex flex-col items-center gap-2 min-w-[70px] group"
              >
                <div className="w-14 h-14 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] border-2 border-dashed border-[var(--color-border-strong)] dark:border-[var(--color-border-dark)] rounded-full flex items-center justify-center group-active:scale-[0.94] transition-transform">
                  <Icons.Plus size={20} className="uv-text-muted" />
                </div>
                <span className="text-xs font-semibold uv-text-muted">{t('add')}</span>
              </button>
            </div>
          </div>

          {/* Todos los contactos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider">
                {t('sinpe_contacts')}
              </h3>
              <button
                onClick={() => setShowAddContactSheet(true)}
                className="text-[var(--color-primary)] text-sm font-semibold flex items-center gap-1 hover:underline"
              >
                <Icons.Plus size={16} />
                {t('new_contact')}
              </button>
            </div>
            <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
              {allContacts.length === 0 ? (
                <div className="p-8 text-center">
                  <Icons.Users size={48} className="mx-auto uv-text-muted mb-4 opacity-50" />
                  <p className="uv-text-secondary mb-2">{t('no_contacts_yet')}</p>
                  <button
                    onClick={() => setShowAddContactSheet(true)}
                    className="text-[var(--color-primary)] font-semibold hover:underline"
                  >
                    {t('add_contact')}
                  </button>
                </div>
              ) : (
                allContacts.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => handleSelectContact(contact)}
                    className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
                  >
                    <div className="w-12 h-12 uv-gradient-brand rounded-full flex items-center justify-center text-white font-bold mr-3 shrink-0">
                      {contact.name.charAt(0)}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="font-semibold uv-text-primary flex items-center gap-1.5 truncate">
                        {contact.name}
                        {contact.isFavorite && (
                          <Icons.Star size={13} className="text-[var(--color-accent)] fill-[var(--color-accent)] shrink-0" />
                        )}
                      </div>
                      <div className="text-xs uv-text-muted">{contact.phone}</div>
                    </div>
                    <span className="text-[11px] font-semibold bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-2 py-1 rounded-md uv-text-secondary ml-2 shrink-0">
                      {contact.bank || t('unknown_bank')}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Nuevo numero */}
          <button
            onClick={() => setShowSendSheet(true)}
            className="w-full uv-surface-2 p-4 rounded-2xl flex items-center justify-center gap-2 uv-text-secondary font-semibold hover:uv-shadow-elevated transition-all"
          >
            <Icons.Phone size={18} />
            {t('send_to_new_number')}
          </button>
        </div>
      )}

      {activeTab === 'receive' && (
        <div className="space-y-6">
          {/* Mi numero SINPE */}
          <div className="uv-surface-1 rounded-2xl p-6 text-center uv-shadow-soft">
            <div className="w-16 h-16 bg-[var(--color-success-soft)] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Icons.QrCode size={32} className="text-[var(--color-success)]" />
            </div>
            <h3 className="text-lg font-bold uv-text-primary mb-1">
              {t('my_sinpe_number')}
            </h3>
            <p className="text-2xl font-black uv-text-primary mb-2 tabular-nums">
              {userPhone}
            </p>
            <p className="uv-text-muted text-sm mb-4">
              {t('share_number_message')}
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={() => handleCopy(userPhone.replace(/\s/g, ''), 'numero')}
                aria-label={t('copy')}
                className="flex-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] py-3 rounded-xl font-semibold uv-text-primary flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Icons.Copy size={16} />
                {t('copy')}
              </button>
              <button
                onClick={() => handleShare(
                  t('sinpe_mobile'),
                  `${t('share_number_message')}: ${userPhone}`
                )}
                aria-label={t('share')}
                className="flex-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] py-3 rounded-xl font-semibold uv-text-primary flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Icons.Share size={16} />
                {t('share')}
              </button>
            </div>
          </div>

          {/* Solicitar a contacto */}
          <button
            onClick={() => setShowReceiveSheet(true)}
            className="w-full bg-[var(--color-success)] text-white p-4 rounded-2xl flex items-center justify-center gap-2 font-bold text-lg active:scale-[0.98] transition-transform uv-shadow-elevated"
          >
            <Icons.Receive size={20} />
            {t('request_money')}
          </button>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
            {state.sinpeHistory.length === 0 ? (
              <div className="p-8 text-center">
                <Icons.History size={48} className="mx-auto uv-text-muted opacity-50 mb-4" />
                <p className="uv-text-muted">{t('no_transactions_yet')}</p>
              </div>
            ) : (
              state.sinpeHistory.map((tx) => {
                const incoming = tx.type !== 'sent';
                return (
                  <div key={tx.id} className="flex items-center px-4 py-3.5">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center mr-3.5 shrink-0 ${
                      incoming
                        ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
                        : 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
                    }`}>
                      {incoming ? <Icons.ArrowDownLeft size={20} /> : <Icons.ArrowUpRight size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold uv-text-primary truncate">
                        {incoming ? `${t('received_from')} ${tx.name}` : `${t('sent_to')} ${tx.name}`}
                      </div>
                      <div className="text-xs uv-text-muted mt-0.5">
                        {tx.date} · {tx.phone}
                      </div>
                      {tx.reference && (
                        <div className="text-xs uv-text-muted italic mt-1">"{tx.reference}"</div>
                      )}
                    </div>
                    <div className={`font-bold tabular-nums shrink-0 ${
                      incoming ? 'text-[var(--color-success)]' : 'uv-text-primary'
                    }`}>
                      {incoming ? '+' : '-'}
                      {formatCurrency(tx.amount)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Add Contact Sheet */}
      <BottomSheet
        isOpen={showAddContactSheet}
        onClose={() => {
          setShowAddContactSheet(false);
          setNewContactName('');
          setNewContactPhone('');
          setNewContactBank('Desconocido');
          setNewContactFavorite(false);
        }}
        title={t('add_sinpe_contact')}
      >
        <div className="space-y-4">
          {/* Nombre */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('contact_name')}
            </label>
            <input
              type="text"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              placeholder={t('sinpe_contact_name_ph')}
              className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all"
            />
          </div>

          {/* Telefono */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('phone_number')}
            </label>
            <div className="flex items-center gap-2 bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 py-3 rounded-xl focus-within:border-[var(--color-primary)] focus-within:ring-[3px] focus-within:ring-[var(--color-primary-soft)] transition-all">
              <span className="uv-text-muted">+506</span>
              <input
                type="tel"
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="8888-0000"
                className="flex-1 bg-transparent outline-none"
              />
            </div>
          </div>

          {/* Banco */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('bank_optional')}
            </label>
            <select
              value={newContactBank}
              onChange={(e) => setNewContactBank(e.target.value)}
              className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all"
            >
              {BANKS.map((bank) => (
                <option key={bank} value={bank}>{bank === 'Desconocido' ? t('unknown_bank') : bank}</option>
              ))}
            </select>
          </div>

          {/* Favorito */}
          <button
            onClick={() => setNewContactFavorite(!newContactFavorite)}
            className="w-full flex items-center justify-between p-4 uv-surface-2 rounded-xl"
          >
            <div className="flex items-center gap-3">
              <Icons.Star size={20} className={newContactFavorite ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400'} />
              <span className="font-medium">{t('mark_as_favorite')}</span>
            </div>
            <div className={`w-12 h-7 rounded-full p-1 transition-colors ${
              newContactFavorite ? 'bg-yellow-500' : 'bg-gray-300'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                newContactFavorite ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
          </button>

          {/* Boton guardar */}
          <button
            onClick={handleAddContact}
            disabled={!newContactName || newContactPhone.length < 8}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] transition-all uv-shadow-primary"
          >
            <Icons.Plus size={20} />
            {t('save_contact')}
          </button>
        </div>
      </BottomSheet>

      {/* Send Money Sheet */}
      <BottomSheet
        isOpen={showSendSheet}
        onClose={() => { setShowSendSheet(false); setSelectedContact(null); setPhone(''); }}
        title={t('send_money')}
      >
        <div className="space-y-6">
          {/* Destinatario */}
          <div className="uv-surface-2 p-4 rounded-xl">
            <label className="text-xs text-gray-500 font-bold uppercase block mb-2">
              {t('phone_number')}
            </label>
            {selectedContact ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 uv-gradient-brand rounded-full flex items-center justify-center text-white font-bold">
                  {selectedContact.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="font-bold uv-text-primary">{selectedContact.name}</div>
                  <div className="text-sm text-gray-500">{selectedContact.phone}</div>
                </div>
                <button
                  onClick={() => { setSelectedContact(null); setPhone(''); }}
                  aria-label={t('close')}
                  className="uv-text-muted"
                >
                  <Icons.X size={18} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <span className="text-lg text-gray-400">+506</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="8888-0000"
                  className="flex-1 bg-transparent outline-none text-lg font-semibold uv-text-primary"
                />
              </div>
            )}
          </div>

          {/* Monto */}
          <div className="text-center">
            <label className="text-sm text-gray-500 mb-2 block">{t('amount_to_send')}</label>
            <div className="flex items-center justify-center gap-2">
              <span className="text-4xl font-bold uv-text-primary">₡</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="text-5xl font-black bg-transparent w-48 text-center outline-none uv-text-primary placeholder-gray-300"
              />
            </div>
            <p className={`text-sm mt-2 ${parseFloat(amount || '0') > balance ? 'text-red-500' : 'text-gray-400'}`}>
              {parseFloat(amount || '0') > balance ? t('insufficient_funds') : `${t('available')}: ${formatCurrency(balance)}`}
            </p>
          </div>

          {/* Montos rapidos */}
          <div className="flex gap-2">
            {[5000, 10000, 25000, 50000].map((val) => (
              <button
                key={val}
                onClick={() => setAmount(val.toString())}
                className="flex-1 py-2 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-lg text-sm font-bold uv-text-secondary hover:bg-[var(--color-primary-soft)] hover:text-[var(--color-primary)] transition-colors"
              >
                {formatCurrency(val).replace(',00', '')}
              </button>
            ))}
          </div>

          {/* Referencia opcional */}
          <div className="uv-surface-2 p-4 rounded-xl">
            <label className="text-xs text-gray-500 font-bold uppercase block mb-2">
              {t('detail_optional')}
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t('sinpe_send_desc_ph')}
              className="w-full bg-transparent outline-none uv-text-primary"
              maxLength={50}
            />
          </div>

          {sendError && <p className="text-red-500 text-sm text-center">{sendError}</p>}

          {/* Boton enviar */}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!phone || !amount || parseFloat(amount) > balance || isProcessing}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] transition-all uv-shadow-primary"
          >
            {isProcessing ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t('processing')}
              </>
            ) : (
              <>
                <Icons.Send size={20} />
                {t('send')} {amount && formatCurrency(parseFloat(amount))}
              </>
            )}
          </button>
        </div>
      </BottomSheet>

      {/* Review-before-send confirmation (money moves are irreversible on the ledger) */}
      <ConfirmSendSheet
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleSendMoney}
        amount={parseFloat(amount || '0')}
        currency="CRC"
        processing={isProcessing}
        confirmLabel={t('send')}
        rows={[
          { label: t('recipient'), value: selectedContact?.name || `+506 ${phone}` },
          ...(reference ? [{ label: t('detail_optional'), value: reference }] : []),
        ]}
      />

      {/* Receive Money Sheet */}
      <BottomSheet
        isOpen={showReceiveSheet}
        onClose={() => setShowReceiveSheet(false)}
        title={t('request_money')}
      >
        <div className="space-y-6">
          <div className="uv-surface-2 p-4 rounded-xl">
            <label className="text-xs text-gray-500 font-bold uppercase block mb-2">
              {t('request_to_number')}
            </label>
            <div className="flex gap-2">
              <span className="text-lg text-gray-400">+506</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="8888-0000"
                className="flex-1 bg-transparent outline-none text-lg font-semibold uv-text-primary"
              />
            </div>
          </div>

          <div className="text-center">
            <label className="text-sm text-gray-500 mb-2 block">{t('amount_to_request')}</label>
            <div className="flex items-center justify-center gap-2">
              <span className="text-4xl font-bold uv-text-primary">₡</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="text-5xl font-black bg-transparent w-48 text-center outline-none uv-text-primary placeholder-gray-300"
              />
            </div>
          </div>

          <div className="uv-surface-2 p-4 rounded-xl">
            <label className="text-xs text-gray-500 font-bold uppercase block mb-2">
              {t('reason_optional')}
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t('sinpe_request_reason_ph')}
              className="w-full bg-transparent outline-none uv-text-primary"
            />
          </div>

          <button
            onClick={handleRequestMoney}
            disabled={!phone || !amount || isProcessing}
            className="w-full bg-[var(--color-success)] hover:opacity-90 text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            {isProcessing ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t('sending_request')}
              </>
            ) : (
              <>
                <Icons.Receive size={20} />
                {t('request')} {amount && formatCurrency(parseFloat(amount))}
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
          <div className="w-20 h-20 bg-[var(--color-success-soft)] rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
            <Icons.Check size={40} className="text-[var(--color-success)]" />
          </div>
          <h2 className="text-2xl font-black uv-text-primary mb-2 tracking-tight">
            {t('sent_success')}
          </h2>
          <p className="uv-text-muted mb-6">
            {t('sinpe_transfer_success')}
          </p>

          {lastTransaction && (
            <div className="uv-surface-2 rounded-2xl p-4 mb-6 text-left">
              <div className="flex justify-between py-2">
                <span className="uv-text-muted text-sm">{t('amount')}</span>
                <span className="font-bold uv-text-primary tabular-nums">
                  {formatCurrency(lastTransaction.amount)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                <span className="uv-text-muted text-sm">{t('sent_to_label')}</span>
                <span className="font-bold uv-text-primary">
                  {lastTransaction.name}
                </span>
              </div>
              <div className="flex justify-between py-2 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                <span className="uv-text-muted text-sm">{t('phone')}</span>
                <span className="font-bold uv-text-primary tabular-nums">
                  +506 {lastTransaction.phone}
                </span>
              </div>
              {lastTransaction.reference && (
                <div className="flex justify-between py-2 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                  <span className="uv-text-muted text-sm">{t('detail')}</span>
                  <span className="font-bold uv-text-primary">
                    {lastTransaction.reference}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2.5">
            <button
              onClick={() => setShowSuccessSheet(false)}
              className="flex-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-primary py-4 rounded-xl font-bold active:scale-[0.98] transition-transform"
            >
              {t('close')}
            </button>
            <button
              onClick={() => {
                if (lastTransaction) {
                  handleShare(
                    t('sinpe_receipt'),
                    `${t('sent_to')} ${lastTransaction.name} (${lastTransaction.phone}) ${formatCurrency(lastTransaction.amount)} - ${t('sinpe_mobile')}${lastTransaction.reference ? ` - ${lastTransaction.reference}` : ''}`
                  );
                }
              }}
              className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 uv-shadow-primary active:scale-[0.98] transition-all"
            >
              <Icons.Share size={18} />
              {t('share')}
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* High-value MFA challenge → on verify, retry the transfer */}
      <MfaChallengeSheet
        isOpen={showMfa}
        onClose={() => setShowMfa(false)}
        onVerified={() => {
          setShowMfa(false);
          handleSendMoney();
        }}
      />
    </div>
  );
};
