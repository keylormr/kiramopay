import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui/Button';
import { useSavingsStore, SavingsGoal } from '@/stores/savings.store';
import { useApp } from '@/hooks/useApp';
import { getApiLayer } from '@/api';
import { refreshAccounts } from '@/services/dataSync';
import type { Transaction } from '@/types';

const hasBackend = !!import.meta.env.VITE_API_URL;

const GOAL_ICONS = [
  { id: 'piggy-bank', Icon: Icons.PiggyBank, label: 'Ahorro' },
  { id: 'home', Icon: Icons.Home, label: 'Casa' },
  { id: 'car', Icon: Icons.Car, label: 'Auto' },
  { id: 'plane', Icon: Icons.Navigation, label: 'Viaje' },
  { id: 'gift', Icon: Icons.Gift, label: 'Regalo' },
  { id: 'trophy', Icon: Icons.Trophy, label: 'Meta' },
  { id: 'heart', Icon: Icons.Heart, label: 'Salud' },
  { id: 'star', Icon: Icons.Star, label: 'Especial' },
];

const GOAL_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

const iconLookup: Record<string, React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  'piggy-bank': Icons.PiggyBank,
  home: Icons.Home,
  car: Icons.Car,
  plane: Icons.Navigation,
  gift: Icons.Gift,
  trophy: Icons.Trophy,
  heart: Icons.Heart,
  star: Icons.Star,
};

export const SavingsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const { state, dispatch } = useApp();
  const { goals, addGoal, removeGoal, setGoals, updateGoal } = useSavingsStore();

  // Una consulta que falla NO es una lista vacia. Sin estas dos banderas la
  // pantalla afirmaba "Total ahorrado 0" y "Sin metas de ahorro" cuando lo
  // unico cierto era que no se habian podido consultar: al usuario se le decia
  // que no tiene ahorros teniendolos.
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);

  // Una respuesta que llega despues de cerrar la pantalla no debe tocar estado.
  const vivo = React.useRef(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(false);
    const api = getApiLayer();
    if (!api.savings) {
      if (vivo.current) {
        setErrorCarga(true);
        setCargando(false);
      }
      return;
    }
    try {
      const res = await api.savings.getGoals();
      if (!vivo.current) return;
      if (res.success && res.data) setGoals(res.data);
      else setErrorCarga(true);
    } catch {
      if (vivo.current) setErrorCarga(true);
    } finally {
      if (vivo.current) setCargando(false);
    }
  }, [setGoals]);

  useEffect(() => {
    vivo.current = true;
    void cargar();
    return () => { vivo.current = false; };
  }, [cargar]);

  // Las metas se crean y se rotulan SIEMPRE en colones (el formulario y la hoja
  // de deposito escriben el simbolo a mano), asi que el saldo, la validacion y
  // el movimiento espejo salen de la cuenta en colones — no de la cuenta de la
  // moneda base, que se cambia con un toque en el home.
  const cuentaCRC = state.accounts.find((a) => a.ccy === 'CRC');

  // In mock mode there is no backend ledger, so the view mirrors the wallet
  // movement locally; in http mode the backend moves the money and we refresh.
  const localWalletTx = (amount: number, label: string, credit: boolean) => {
    if (!cuentaCRC) return;
    const tx: Transaction = {
      id: Date.now().toString(),
      title: label,
      amount: credit ? amount : -amount,
      ccy: cuentaCRC.ccy,
      date: new Date().toLocaleDateString(),
      type: credit ? 'credit' : 'debit',
      category: 'Savings',
      status: 'completed',
    };
    dispatch({ type: 'ADD_TRANSACTION', payload: tx });
  };

  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showDepositSheet, setShowDepositSheet] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // El error de cada hoja se muestra DENTRO de la hoja y la deja abierta: si se
  // cierra igual que cuando sale bien, un deposito rechazado se ve exactamente
  // como uno exitoso.
  const [errorHoja, setErrorHoja] = useState<string | null>(null);
  const [metaAEliminar, setMetaAEliminar] = useState<SavingsGoal | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // New goal form
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalIcon, setGoalIcon] = useState('piggy-bank');
  const [goalColor, setGoalColor] = useState(GOAL_COLORS[0]);

  const totalSaved = goals.reduce((s, g) => s + g.saved, 0);
  const totalTarget = goals.reduce((s, g) => s + g.target, 0);
  const overallProgress = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;

  const formatCurrency = (amount: number) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currencyDisplay: 'narrowSymbol', currency: 'CRC' }).format(amount);
    } catch {
      return `${amount.toFixed(2)} CRC`;
    }
  };

  const handleAddGoal = async () => {
    if (isCreating) return;
    if (!goalName || !goalTarget) return;
    const api = getApiLayer();
    if (!api.savings) return;
    setIsCreating(true);
    setErrorHoja(null);
    try {
      const res = await api.savings.createGoal({
        name: goalName,
        target: parseFloat(goalTarget),
        icon: goalIcon,
        color: goalColor,
      });
      if (!res.success || !res.data) {
        setErrorHoja(t('savings_err_create'));
        return;
      }
      addGoal(res.data);
      setGoalName('');
      setGoalTarget('');
      setGoalIcon('piggy-bank');
      setGoalColor(GOAL_COLORS[0]);
      setShowAddSheet(false);
    } catch {
      setErrorHoja(t('savings_err_create'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeposit = async () => {
    if (isDepositing) return;
    if (!selectedGoal || !depositAmount) return;
    const amount = parseFloat(depositAmount);
    if (amount <= 0) return;

    // Check sufficient funds against the displayed wallet balance.
    if (!cuentaCRC || amount > cuentaCRC.balance) return;

    const api = getApiLayer();
    if (!api.savings) return;
    setIsDepositing(true);
    setErrorHoja(null);
    try {
      const res = await api.savings.deposit(selectedGoal.id, amount);
      // El `finally` cerraba la hoja y limpiaba el monto pasara lo que pasara,
      // asi que un deposito RECHAZADO se veia igual que uno exitoso. Ahora un
      // fallo deja la hoja abierta, el monto escrito y el motivo a la vista.
      if (!res.success || !res.data) {
        setErrorHoja(t('savings_err_deposit'));
        return;
      }
      updateGoal(selectedGoal.id, { saved: res.data.saved });
      // http: the backend moved the money; sync the real balance.
      // mock: mirror the wallet debit locally.
      if (hasBackend) refreshAccounts().catch(() => {});
      else localWalletTx(amount, `${t('savings_title')}: ${selectedGoal.name}`, false);

      setDepositAmount('');
      setShowDepositSheet(false);
      setSelectedGoal(null);
    } catch {
      setErrorHoja(t('savings_err_deposit'));
    } finally {
      setIsDepositing(false);
    }
  };

  // Borrar una meta con plata adentro no puede ser un toque sin pregunta. El
  // dinero no se pierde —el servidor lo devuelve a la billetera— pero eso no se
  // veia por ningun lado: desaparecia la meta y el saldo aparecia cambiado sin
  // explicacion.
  const confirmarBorrado = async () => {
    const goal = metaAEliminar;
    if (!goal || deletingId) return;
    const api = getApiLayer();
    if (!api.savings) return;
    setDeletingId(goal.id);
    setErrorHoja(null);
    try {
      const res = await api.savings.deleteGoal(goal.id);
      if (!res.success) {
        setErrorHoja(t('savings_err_delete'));
        return;
      }
      removeGoal(goal.id);
      // Deleting returns any held savings to the wallet.
      if (hasBackend) refreshAccounts().catch(() => {});
      else if (goal.saved > 0) localWalletTx(goal.saved, `${t('savings_title')}: ${goal.name}`, true);
      setMetaAEliminar(null);
      if (goal.saved > 0) {
        setAviso(t('savings_deleted_returned').replace('{amount}', formatCurrency(goal.saved)));
      }
    } catch {
      setErrorHoja(t('savings_err_delete'));
    } finally {
      setDeletingId(null);
    }
  };

  const openDeposit = (goal: SavingsGoal) => {
    setSelectedGoal(goal);
    setDepositAmount('');
    setShowDepositSheet(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('savings_title')}</h1>
        <button
          onClick={() => setShowAddSheet(true)}
          className="p-2 -mr-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors text-[var(--color-primary)]"
          aria-label={t('savings_add_goal')}
        >
          <Icons.Plus size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        {cargando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : errorCarga ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <Icons.AlertCircle size={26} className="text-[var(--color-danger)] mb-3" aria-hidden="true" />
            <p className="font-semibold uv-text-primary" role="alert">{t('savings_err_load')}</p>
            <button
              type="button"
              onClick={() => void cargar()}
              className="mt-4 px-5 py-2.5 rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-bold"
            >
              {t('error_retry')}
            </button>
          </div>
        ) : (
          <>
        {aviso && (
          <div
            role="status"
            aria-live="polite"
            className="mx-4 mt-4 flex items-start gap-2.5 rounded-xl px-3 py-2.5 uv-chip-success"
          >
            <Icons.Check size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm font-medium">{aviso}</p>
          </div>
        )}

        {/* Overall Progress Card */}
        <div className="px-4 pt-4 pb-2">
          <div className="bg-gradient-to-br from-primary/10 to-blue-500/5 dark:from-primary/20 dark:to-blue-900/10 rounded-3xl border border-primary/20 dark:border-primary/30 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-bold text-primary/60 uppercase tracking-wider mb-1">{t('savings_total_saved')}</p>
                <p className="text-3xl font-black uv-text-primary">{formatCurrency(totalSaved)}</p>
              </div>
              {/* Circular progress */}
              <div className="relative w-16 h-16">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4"
                    className="text-gray-200 dark:text-gray-700" />
                  <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4"
                    className="text-[var(--color-primary)]"
                    strokeDasharray={`${overallProgress * 1.76} 176`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dasharray 0.7s ease-out' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-black text-[var(--color-primary)]">{Math.round(overallProgress)}%</span>
                </div>
              </div>
            </div>
            {totalTarget > 0 && (
              <p className="text-xs uv-text-muted">
                {t('savings_of_target')} {formatCurrency(totalTarget)}
              </p>
            )}
          </div>
        </div>

        {/* Goals List */}
        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 px-4">
            <div className="w-24 h-24 rounded-3xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center mb-4">
              <Icons.PiggyBank size={48} className="opacity-30" />
            </div>
            <p className="text-lg font-bold mb-2 uv-text-primary">{t('savings_no_goals')}</p>
            <p className="text-sm text-gray-400 text-center mb-6">{t('savings_no_goals_desc')}</p>
            <Button
              variant="primary"
              size="md"
              onClick={() => setShowAddSheet(true)}
            >
              {t('savings_create_first')}
            </Button>
          </div>
        ) : (
          <div className="px-4 py-2 space-y-3">
            {goals.map((goal, i) => {
              const progress = goal.target > 0 ? (goal.saved / goal.target) * 100 : 0;
              const isComplete = progress >= 100;
              const GoalIcon = iconLookup[goal.icon] || Icons.PiggyBank;

              return (
                <div
                  key={goal.id}
                  className="uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4 shadow-sm animate-stagger hover:shadow-md transition-all"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${goal.color}20` }}
                    >
                      <GoalIcon size={24} style={{ color: goal.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-bold uv-text-primary text-sm truncate">{goal.name}</h3>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatCurrency(goal.saved)} / {formatCurrency(goal.target)}
                          </p>
                        </div>
                        {isComplete ? (
                          <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 text-[10px] font-bold rounded-full">
                            {t('done')}
                          </span>
                        ) : (
                          <span className="text-sm font-extrabold" style={{ color: goal.color }}>
                            {Math.round(progress)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2.5 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] overflow-hidden mb-3">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out animate-bar-grow"
                      style={{
                        width: `${Math.min(progress, 100)}%`,
                        backgroundColor: goal.color,
                      }}
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => openDeposit(goal)}
                      disabled={isComplete}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
                      style={{
                        backgroundColor: `${goal.color}15`,
                        color: goal.color,
                      }}
                    >
                      {t('savings_add_money')}
                    </button>
                    <button
                      onClick={() => { setErrorHoja(null); setMetaAEliminar(goal); }}
                      disabled={deletingId !== null}
                      aria-label={t('delete')}
                      className={`px-4 py-2.5 rounded-xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-gray-500 text-sm font-bold active:scale-95 transition-all disabled:opacity-50 ${deletingId === goal.id ? 'opacity-50' : ''}`}
                    >
                      <Icons.X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
          </>
        )}
      </div>

      {/* Add Goal Sheet */}
      <BottomSheet isOpen={showAddSheet} onClose={() => setShowAddSheet(false)} title={t('savings_add_goal')}>
        <div className="space-y-5 pb-2">
          {/* Name */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">{t('savings_goal_name')}</label>
            <input
              type="text"
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              placeholder={t('savings_goal_name_placeholder')}
              className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-4 py-3 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Target */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">{t('savings_target_amount')}</label>
            <div className="flex items-center bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl px-4 py-3">
              <span className="text-lg font-bold text-gray-400 mr-2">₡</span>
              <input
                type="number"
                value={goalTarget}
                onChange={(e) => setGoalTarget(e.target.value)}
                placeholder="0"
                className="flex-1 bg-transparent text-lg font-bold outline-none uv-text-primary"
              />
            </div>
          </div>

          {/* Icon selection */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">{t('icon')}</label>
            <div className="grid grid-cols-4 gap-2">
              {GOAL_ICONS.map(({ id, Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setGoalIcon(id)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                    goalIcon === id
                      ? 'border-primary bg-primary/10'
                      : 'border-transparent uv-surface-2'
                  }`}
                >
                  <Icon size={20} className={goalIcon === id ? 'text-primary' : 'text-gray-400'} />
                  <span className="text-[10px] font-medium text-gray-500">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color selection */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">{t('color')}</label>
            <div className="flex gap-2 flex-wrap">
              {GOAL_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setGoalColor(color)}
                  className={`w-9 h-9 rounded-full transition-all ${
                    goalColor === color ? 'ring-2 ring-offset-2 ring-primary scale-110' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {errorHoja && !showDepositSheet && (
            <p className="text-sm text-[var(--color-danger)]" role="alert">{errorHoja}</p>
          )}

          {/* Create button */}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleAddGoal}
            loading={isCreating}
            disabled={isCreating || !goalName || !goalTarget}
          >
            {t('savings_create_goal')}
          </Button>
        </div>
      </BottomSheet>

      {/* Deposit Sheet */}
      {selectedGoal && (
        <BottomSheet
          isOpen={showDepositSheet}
          onClose={() => { setShowDepositSheet(false); setSelectedGoal(null); }}
          title={t('savings_add_money')}
        >
          {(() => {
            const currentBalance = cuentaCRC?.balance ?? 0;
            const numAmount = parseFloat(depositAmount || '0');
            const isInsufficient = numAmount > currentBalance;
            return (
              <div className="space-y-5 pb-2">
                <div className="text-center py-2">
                  <p className="text-sm text-gray-500 mb-1">{selectedGoal.name}</p>
                  <p className="text-xs text-gray-400">
                    {formatCurrency(selectedGoal.saved)} / {formatCurrency(selectedGoal.target)}
                  </p>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <span className={`text-3xl font-bold ${isInsufficient ? 'text-red-500' : 'text-gray-400'}`}>₡</span>
                  <input
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="0"
                    className={`text-4xl font-black bg-transparent w-48 text-center outline-none placeholder-gray-300 ${isInsufficient ? 'text-red-500' : 'uv-text-primary'}`}
                    autoFocus
                  />
                </div>

                {/* Available balance */}
                <p className={`text-center text-sm font-medium ${isInsufficient ? 'text-red-500' : 'text-gray-400'}`}>
                  {isInsufficient ? t('insufficient_funds') : `${t('available')}: ${formatCurrency(currentBalance)}`}
                </p>

                {/* Quick amounts */}
                <div className="flex gap-2 justify-center">
                  {[5000, 10000, 25000, 50000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setDepositAmount(amt.toString())}
                      className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-xs font-bold uv-text-secondary active:scale-95 transition-transform"
                    >
                      ₡{(amt / 1000).toFixed(0)}K
                    </button>
                  ))}
                </div>

                {errorHoja && (
                  <p className="text-sm text-center text-[var(--color-danger)]" role="alert">{errorHoja}</p>
                )}

                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={handleDeposit}
                  loading={isDepositing}
                  disabled={isDepositing || !depositAmount || numAmount <= 0 || isInsufficient}
                >
                  {t('savings_deposit')}
                </Button>
              </div>
            );
          })()}
        </BottomSheet>
      )}

      {/* Confirmacion de borrado */}
      <BottomSheet
        isOpen={metaAEliminar !== null}
        onClose={() => { if (!deletingId) setMetaAEliminar(null); }}
        title={t('savings_delete_title')}
        dismissable={!deletingId}
      >
        {metaAEliminar && (
          <div className="space-y-4 pb-2">
            <div className="flex gap-3 rounded-xl bg-[var(--color-danger-soft)] p-3">
              <Icons.AlertTriangle size={18} className="shrink-0 mt-0.5 text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]" aria-hidden="true" />
              <p className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
                {t('savings_delete_warning').replace('{name}', metaAEliminar.name)}
              </p>
            </div>
            {metaAEliminar.saved > 0 && (
              <p className="text-sm uv-text-secondary">
                {t('savings_delete_returns').replace('{amount}', formatCurrency(metaAEliminar.saved))}
              </p>
            )}
            {errorHoja && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{errorHoja}</p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setMetaAEliminar(null)}
                disabled={deletingId !== null}
                className="flex-1 py-3.5 rounded-xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] font-bold disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void confirmarBorrado()}
                disabled={deletingId !== null}
                className="flex-1 bg-[var(--color-danger)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50"
              >
                {deletingId ? t('loading') : t('delete')}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
};
