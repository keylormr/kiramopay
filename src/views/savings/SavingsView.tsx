import React, { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { useSavingsStore, SavingsGoal } from '@/stores/savings.store';
import { useApp } from '@/hooks/useApp';
import type { Transaction } from '@/types';

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
  const { goals, addGoal, addToGoal, removeGoal } = useSavingsStore();

  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showDepositSheet, setShowDepositSheet] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null);
  const [depositAmount, setDepositAmount] = useState('');

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
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'CRC' }).format(amount);
    } catch {
      return `${amount.toFixed(2)} CRC`;
    }
  };

  const handleAddGoal = () => {
    if (!goalName || !goalTarget) return;
    addGoal({
      id: Date.now().toString(),
      name: goalName,
      target: parseFloat(goalTarget),
      saved: 0,
      icon: goalIcon,
      color: goalColor,
      createdAt: new Date().toISOString(),
    });
    setGoalName('');
    setGoalTarget('');
    setGoalIcon('piggy-bank');
    setGoalColor(GOAL_COLORS[0]);
    setShowAddSheet(false);
  };

  const handleDeposit = () => {
    if (!selectedGoal || !depositAmount) return;
    const amount = parseFloat(depositAmount);
    if (amount <= 0) return;

    // Check sufficient funds
    const baseAccount = state.accounts.find(a => a.ccy === (state.baseCurrency || 'CRC')) || state.accounts[0];
    if (!baseAccount || amount > baseAccount.balance) return;

    // Add to savings goal
    addToGoal(selectedGoal.id, amount);

    // Deduct from account balance via transaction
    const tx: Transaction = {
      id: Date.now().toString(),
      title: `${t('savings_title')}: ${selectedGoal.name}`,
      amount: -amount,
      ccy: baseAccount.ccy,
      date: new Date().toLocaleDateString(),
      type: 'debit',
      category: 'Savings',
      status: 'completed',
    };
    dispatch({ type: 'ADD_TRANSACTION', payload: tx });

    setDepositAmount('');
    setShowDepositSheet(false);
    setSelectedGoal(null);
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
            <button
              onClick={() => setShowAddSheet(true)}
              className="px-6 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
            >
              {t('savings_create_first')}
            </button>
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
                      onClick={() => removeGoal(goal.id)}
                      className="px-4 py-2.5 rounded-xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-gray-500 text-sm font-bold active:scale-95 transition-all"
                    >
                      <Icons.X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
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

          {/* Create button */}
          <button
            onClick={handleAddGoal}
            disabled={!goalName || !goalTarget}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {t('savings_create_goal')}
          </button>
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
            const baseAccount = state.accounts.find(a => a.ccy === (state.baseCurrency || 'CRC')) || state.accounts[0];
            const currentBalance = baseAccount?.balance ?? 0;
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

                <button
                  onClick={handleDeposit}
                  disabled={!depositAmount || numAmount <= 0 || isInsufficient}
                  className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  {t('savings_deposit')}
                </button>
              </div>
            );
          })()}
        </BottomSheet>
      )}
    </div>
  );
};
