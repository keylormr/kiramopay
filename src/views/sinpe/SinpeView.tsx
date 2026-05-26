import React, { useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '../../i18n/LanguageContext';
import { Icons } from '../../components/Icons';
import { BottomSheet } from '../../components/BottomSheet';
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

  const handleSendMoney = () => {
    if (!amount || !phone) return;

    const numAmount = parseFloat(amount);
    if (numAmount > balance) return;

    setIsProcessing(true);

    setTimeout(() => {
      const tx: SinpeTransaction = {
        id: Date.now().toString(),
        type: 'sent',
        amount: numAmount,
        phone,
        name: selectedContact?.name || phone,
        date: 'Ahora',
        status: 'completed',
        reference,
      };

      dispatch({ type: 'ADD_SINPE_TRANSACTION', payload: tx });
      setLastTransaction(tx);
      setIsProcessing(false);
      setShowSendSheet(false);
      setShowSuccessSheet(true);

      // Reset form
      setAmount('');
      setPhone('');
      setReference('');
      setSelectedContact(null);
    }, 2000);
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
        <div aria-live="assertive" className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-4 duration-200">
          {t('copied_to_clipboard')}
        </div>
      )}

      {/* Header con balance */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-3xl p-6 text-white">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <span className="text-lg">🇨🇷</span>
          </div>
          <span className="font-medium text-white/80">{t('sinpe_mobile')}</span>
        </div>
        <div className="text-3xl font-black mb-1">
          {formatCurrency(balance)}
        </div>
        <div className="text-blue-200 text-sm">{t('available_to_send')}</div>

        <div className="flex gap-3 mt-4">
          <button
            onClick={() => setShowSendSheet(true)}
            className="flex-1 bg-white text-blue-600 py-3 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <Icons.Send size={18} />
            {t('send')}
          </button>
          <button
            onClick={() => setShowReceiveSheet(true)}
            className="flex-1 bg-white/20 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <Icons.Receive size={18} />
            {t('request')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
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
                ? 'bg-white dark:bg-gray-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-gray-500'
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
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
              {t('favorites')}
            </h3>
            <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
              {favorites.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => handleSelectContact(contact)}
                  className="flex flex-col items-center gap-2 min-w-[70px]"
                >
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                    {contact.name.charAt(0)}
                  </div>
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate w-16 text-center">
                    {contact.name.split(' ')[0]}
                  </span>
                </button>
              ))}
              <button
                onClick={() => setShowAddContactSheet(true)}
                aria-label={t('add_contact')}
                className="flex flex-col items-center gap-2 min-w-[70px]"
              >
                <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-full flex items-center justify-center">
                  <Icons.Plus size={20} className="text-gray-400" />
                </div>
                <span className="text-xs text-gray-400">{t('add')}</span>
              </button>
            </div>
          </div>

          {/* Todos los contactos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase">
                {t('sinpe_contacts')}
              </h3>
              <button
                onClick={() => setShowAddContactSheet(true)}
                className="text-primary text-sm font-medium flex items-center gap-1"
              >
                <Icons.Plus size={16} />
                {t('new_contact')}
              </button>
            </div>
            <div className="bg-white dark:bg-surface-dark rounded-2xl divide-y divide-gray-100 dark:divide-gray-800">
              {allContacts.length === 0 ? (
                <div className="p-8 text-center">
                  <Icons.Users size={48} className="mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 mb-2">{t('no_contacts_yet')}</p>
                  <button
                    onClick={() => setShowAddContactSheet(true)}
                    className="text-primary font-medium"
                  >
                    {t('add_contact')}
                  </button>
                </div>
              ) : (
                allContacts.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => handleSelectContact(contact)}
                    className="w-full flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-bold mr-3">
                      {contact.name.charAt(0)}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        {contact.name}
                        {contact.isFavorite && (
                          <Icons.Star size={14} className="text-yellow-500 fill-yellow-500" />
                        )}
                      </div>
                      <div className="text-sm text-gray-500">{contact.phone}</div>
                    </div>
                    <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg text-gray-500">
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
            className="w-full bg-gray-100 dark:bg-gray-800 p-4 rounded-2xl flex items-center justify-center gap-2 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <Icons.Phone size={18} />
            {t('send_to_new_number')}
          </button>
        </div>
      )}

      {activeTab === 'receive' && (
        <div className="space-y-6">
          {/* Mi numero SINPE */}
          <div className="bg-white dark:bg-surface-dark rounded-2xl p-6 text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Icons.QrCode size={32} className="text-white" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
              {t('my_sinpe_number')}
            </h3>
            <p className="text-2xl font-black text-slate-900 dark:text-white mb-2">
              {userPhone}
            </p>
            <p className="text-gray-500 text-sm mb-4">
              {t('share_number_message')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleCopy(userPhone.replace(/\s/g, ''), 'numero')}
                aria-label={t('copy')}
                className="flex-1 bg-gray-100 dark:bg-gray-800 py-3 rounded-xl font-medium flex items-center justify-center gap-2 active:scale-95 transition-transform"
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
                className="flex-1 bg-gray-100 dark:bg-gray-800 py-3 rounded-xl font-medium flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <Icons.Share size={16} />
                {t('share')}
              </button>
            </div>
          </div>

          {/* Solicitar a contacto */}
          <button
            onClick={() => setShowReceiveSheet(true)}
            className="w-full bg-green-500 text-white p-4 rounded-2xl flex items-center justify-center gap-2 font-bold text-lg active:scale-95 transition-transform"
          >
            <Icons.Receive size={20} />
            {t('request_money')}
          </button>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-surface-dark rounded-2xl divide-y divide-gray-100 dark:divide-gray-800">
            {state.sinpeHistory.length === 0 ? (
              <div className="p-8 text-center">
                <Icons.History size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">{t('no_transactions_yet')}</p>
              </div>
            ) : (
              state.sinpeHistory.map((tx) => (
                <div key={tx.id} className="flex items-center p-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mr-3 ${
                    tx.type === 'sent'
                      ? 'bg-red-100 dark:bg-red-900/20 text-red-500'
                      : 'bg-green-100 dark:bg-green-900/20 text-green-500'
                  }`}>
                    {tx.type === 'sent' ? <Icons.ArrowUpRight size={20} /> : <Icons.ArrowDownLeft size={20} />}
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-slate-900 dark:text-white">
                      {tx.type === 'sent' ? `${t('sent_to')} ${tx.name}` : `${t('received_from')} ${tx.name}`}
                    </div>
                    <div className="text-sm text-gray-500">
                      {tx.date} - {tx.phone}
                    </div>
                    {tx.reference && (
                      <div className="text-xs text-gray-400 mt-1">"{tx.reference}"</div>
                    )}
                  </div>
                  <div className={`font-bold ${
                    tx.type === 'sent' ? 'text-red-500' : 'text-green-500'
                  }`}>
                    {tx.type === 'sent' ? '-' : '+'}
                    {formatCurrency(tx.amount)}
                  </div>
                </div>
              ))
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
              placeholder="Ej: Juan Perez"
              className="w-full bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Telefono */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('phone_number')}
            </label>
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded-xl">
              <span className="text-gray-500">+506</span>
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
              className="w-full bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-primary"
            >
              {BANKS.map((bank) => (
                <option key={bank} value={bank}>{bank}</option>
              ))}
            </select>
          </div>

          {/* Favorito */}
          <button
            onClick={() => setNewContactFavorite(!newContactFavorite)}
            className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-xl"
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
            className="w-full bg-primary text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-2"
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
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl">
            <label className="text-xs text-gray-500 font-bold uppercase block mb-2">
              {t('phone_number')}
            </label>
            {selectedContact ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-bold">
                  {selectedContact.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-slate-900 dark:text-white">{selectedContact.name}</div>
                  <div className="text-sm text-gray-500">{selectedContact.phone}</div>
                </div>
                <button
                  onClick={() => { setSelectedContact(null); setPhone(''); }}
                  aria-label={t('close')}
                  className="text-gray-400"
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
                  className="flex-1 bg-transparent outline-none text-lg font-semibold text-slate-900 dark:text-white"
                />
              </div>
            )}
          </div>

          {/* Monto */}
          <div className="text-center">
            <label className="text-sm text-gray-500 mb-2 block">{t('amount_to_send')}</label>
            <div className="flex items-center justify-center gap-2">
              <span className="text-4xl font-bold text-slate-900 dark:text-white">₡</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="text-5xl font-black bg-transparent w-48 text-center outline-none text-slate-900 dark:text-white placeholder-gray-300"
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
                className="flex-1 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-bold text-gray-600 dark:text-gray-400"
              >
                {formatCurrency(val).replace(',00', '')}
              </button>
            ))}
          </div>

          {/* Referencia opcional */}
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl">
            <label className="text-xs text-gray-500 font-bold uppercase block mb-2">
              {t('detail_optional')}
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ej: Almuerzo, pago deuda..."
              className="w-full bg-transparent outline-none text-slate-900 dark:text-white"
              maxLength={50}
            />
          </div>

          {/* Boton enviar */}
          <button
            onClick={handleSendMoney}
            disabled={!phone || !amount || parseFloat(amount) > balance || isProcessing}
            className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-2 active:scale-95 transition-transform"
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

      {/* Receive Money Sheet */}
      <BottomSheet
        isOpen={showReceiveSheet}
        onClose={() => setShowReceiveSheet(false)}
        title={t('request_money')}
      >
        <div className="space-y-6">
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl">
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
                className="flex-1 bg-transparent outline-none text-lg font-semibold text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="text-center">
            <label className="text-sm text-gray-500 mb-2 block">{t('amount_to_request')}</label>
            <div className="flex items-center justify-center gap-2">
              <span className="text-4xl font-bold text-slate-900 dark:text-white">₡</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="text-5xl font-black bg-transparent w-48 text-center outline-none text-slate-900 dark:text-white placeholder-gray-300"
              />
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl">
            <label className="text-xs text-gray-500 font-bold uppercase block mb-2">
              {t('reason_optional')}
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ej: Pago de almuerzo..."
              className="w-full bg-transparent outline-none text-slate-900 dark:text-white"
            />
          </div>

          <button
            onClick={handleRequestMoney}
            disabled={!phone || !amount || isProcessing}
            className="w-full bg-green-500 text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-2"
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
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icons.Check size={40} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2">
            {t('sent_success')}
          </h2>
          <p className="text-gray-500 mb-6">
            {t('sinpe_transfer_success')}
          </p>

          {lastTransaction && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 mb-6 text-left">
              <div className="flex justify-between py-2">
                <span className="text-gray-500">{t('amount')}</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {formatCurrency(lastTransaction.amount)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-t border-gray-200 dark:border-gray-700">
                <span className="text-gray-500">{t('sent_to_label')}</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {lastTransaction.name}
                </span>
              </div>
              <div className="flex justify-between py-2 border-t border-gray-200 dark:border-gray-700">
                <span className="text-gray-500">{t('phone')}</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  +506 {lastTransaction.phone}
                </span>
              </div>
              {lastTransaction.reference && (
                <div className="flex justify-between py-2 border-t border-gray-200 dark:border-gray-700">
                  <span className="text-gray-500">{t('detail')}</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {lastTransaction.reference}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setShowSuccessSheet(false)}
              className="flex-1 bg-gray-100 dark:bg-gray-800 py-4 rounded-xl font-bold"
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
              className="flex-1 bg-blue-600 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2"
            >
              <Icons.Share size={18} />
              {t('share')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};
