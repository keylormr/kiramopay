import React, { useState, useMemo } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useAccountStore } from '@/stores/account.store';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui/Button';
import type { Budget } from '@/types';
import {
  UtensilsCrossed,
  Car,
  Gamepad2,
  Zap,
  ShoppingCart,
  Heart,
  Home,
  Wifi,
  Film,
  Gift,
  Plane,
  GraduationCap,
  Dumbbell,
  Stethoscope,
  PiggyBank,
  Music,
} from 'lucide-react';

// Map icon name strings to lucide components
const iconMap: Record<string, React.FC<{ size?: number; className?: string }>> = {
  utensils: UtensilsCrossed,
  car: Car,
  'gamepad-2': Gamepad2,
  zap: Zap,
  'shopping-cart': ShoppingCart,
  heart: Heart,
  home: Home,
  wifi: Wifi,
  film: Film,
  gift: Gift,
  plane: Plane,
  'graduation-cap': GraduationCap,
  dumbbell: Dumbbell,
  stethoscope: Stethoscope,
  'piggy-bank': PiggyBank,
  music: Music,
};

const PRESET_COLORS = [
  '#f97316', '#3b82f6', '#a855f7', '#eab308',
  '#ef4444', '#22c55e', '#ec4899', '#14b8a6',
  '#6366f1', '#f59e0b', '#8b5cf6', '#06b6d4',
];

const PRESET_ICONS = [
  { name: 'utensils', label: 'Comida' },
  { name: 'car', label: 'Transporte' },
  { name: 'gamepad-2', label: 'Entretenimiento' },
  { name: 'zap', label: 'Servicios' },
  { name: 'shopping-cart', label: 'Compras' },
  { name: 'heart', label: 'Salud' },
  { name: 'home', label: 'Hogar' },
  { name: 'wifi', label: 'Internet' },
  { name: 'film', label: 'Cine' },
  { name: 'gift', label: 'Regalos' },
  { name: 'graduation-cap', label: 'Educacion' },
  { name: 'dumbbell', label: 'Gym' },
  { name: 'music', label: 'Musica' },
  { name: 'piggy-bank', label: 'Ahorro' },
  { name: 'plane', label: 'Viajes' },
  { name: 'stethoscope', label: 'Medico' },
];

const getIconComponent = (iconName?: string): React.FC<{ size?: number; className?: string }> => {
  if (iconName && iconMap[iconName]) return iconMap[iconName];
  return Icons.Receipt;
};

const getProgressColor = (percentage: number): string => {
  if (percentage >= 90) return 'bg-red-500';
  if (percentage >= 70) return 'bg-yellow-500';
  return 'bg-green-500';
};

const getProgressTextColor = (percentage: number): string => {
  if (percentage >= 90) return 'text-red-500';
  if (percentage >= 70) return 'text-yellow-500';
  return 'text-green-500';
};

const formatCurrency = (amount: number, ccy: string) => {
  try {
    return new Intl.NumberFormat('es-CR', { style: 'currency', currency: ccy }).format(amount);
  } catch {
    return `${amount} ${ccy}`;
  }
};

interface BudgetViewProps {
  onClose: () => void;
}

export const BudgetView: React.FC<BudgetViewProps> = ({ onClose }) => {
  const { t } = useLanguage();
  const budgets = useAccountStore((s) => s.budgets);
  const addBudget = useAccountStore((s) => s.addBudget);
  const removeBudget = useAccountStore((s) => s.removeBudget);
  const updateBudget = useAccountStore((s) => s.updateBudget);
  const resetBudgets = useAccountStore((s) => s.resetBudgets);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form state
  const [formLabel, setFormLabel] = useState('');
  const [formLimit, setFormLimit] = useState('');
  const [formCcy, setFormCcy] = useState('CRC');
  const [formIcon, setFormIcon] = useState('utensils');
  const [formColor, setFormColor] = useState('#f97316');

  const totalSpent = useMemo(() => budgets.reduce((sum, b) => sum + b.spent, 0), [budgets]);
  const totalLimit = useMemo(() => budgets.reduce((sum, b) => sum + b.limit, 0), [budgets]);
  const totalPercentage = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;

  const openAddSheet = () => {
    setEditingBudget(null);
    setFormLabel('');
    setFormLimit('');
    setFormCcy('CRC');
    setFormIcon('utensils');
    setFormColor('#f97316');
    setSheetOpen(true);
  };

  const openEditSheet = (budget: Budget) => {
    setEditingBudget(budget);
    setFormLabel(budget.label);
    setFormLimit(String(budget.limit));
    setFormCcy(budget.ccy);
    setFormIcon(budget.icon || 'utensils');
    setFormColor(budget.color || '#f97316');
    setSheetOpen(true);
  };

  const handleSave = () => {
    const limitNum = parseInt(formLimit, 10);
    if (!formLabel.trim() || isNaN(limitNum) || limitNum <= 0) return;

    if (editingBudget) {
      updateBudget(editingBudget.id, {
        label: formLabel.trim(),
        limit: limitNum,
        ccy: formCcy,
        icon: formIcon,
        color: formColor,
      });
    } else {
      const newBudget: Budget = {
        id: Date.now().toString(),
        label: formLabel.trim(),
        spent: 0,
        limit: limitNum,
        ccy: formCcy,
        icon: formIcon,
        color: formColor,
      };
      addBudget(newBudget);
    }
    setSheetOpen(false);
  };

  const handleDelete = (id: string) => {
    removeBudget(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-surface-dark/95 backdrop-blur-lg border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            onClick={onClose}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]"
          >
            <Icons.ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold">{t('expenses')}</h1>
          <button
            onClick={resetBudgets}
            aria-label="Reset"
            className="p-2 -mr-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] text-gray-500"
          >
            <Icons.RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 pb-24 overflow-y-auto h-[calc(100vh-56px)]">
        {/* Total Summary Card */}
        <div className="uv-surface-1 rounded-2xl p-5 mb-5 shadow-sm border border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm uv-text-muted">{t('expenses')}</p>
              <p className="text-2xl font-bold">
                {formatCurrency(totalSpent, 'CRC')}
              </p>
            </div>
            <div className={`text-right ${getProgressTextColor(totalPercentage)}`}>
              <p className="text-3xl font-black">{totalPercentage}%</p>
              <p className="text-xs uv-text-muted">
                / {formatCurrency(totalLimit, 'CRC')}
              </p>
            </div>
          </div>
          {/* Total progress bar */}
          <div className="w-full h-3 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getProgressColor(totalPercentage)}`}
              style={{ width: `${Math.min(totalPercentage, 100)}%` }}
            />
          </div>
        </div>

        {/* Budget List */}
        {budgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full flex items-center justify-center mb-4">
              <Icons.PiggyBank size={40} className="uv-text-muted" />
            </div>
            <h3 className="text-lg font-semibold mb-1">{t('category')}</h3>
            <p className="text-gray-500 text-sm text-center">
              No hay presupuestos configurados.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {budgets.map((budget) => {
              const percentage = budget.limit > 0 ? Math.round((budget.spent / budget.limit) * 100) : 0;
              const IconComp = getIconComponent(budget.icon);

              return (
                <div
                  key={budget.id}
                  className="uv-surface-1 rounded-xl p-4 shadow-sm border border-[var(--color-border)] dark:border-[var(--color-border-dark)] transition-all"
                >
                  {/* Confirm delete overlay */}
                  {confirmDeleteId === budget.id ? (
                    <div className="flex items-center justify-between">
                      <p className="text-sm uv-text-secondary">
                        {t('confirm')} {t('delete').toLowerCase()}?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-3 py-1.5 text-sm rounded-lg bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-gray-600 dark:text-gray-300 font-medium"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          onClick={() => handleDelete(budget.id)}
                          className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white font-medium"
                        >
                          {t('delete')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 mb-3">
                        {/* Icon */}
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${budget.color || '#6b7280'}20`, color: budget.color || '#6b7280' }}
                        >
                          <IconComp size={20} className="flex-shrink-0" />
                        </div>

                        {/* Label + amounts */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-sm truncate">{budget.label}</h3>
                            <span className={`text-sm font-bold ${getProgressTextColor(percentage)}`}>
                              {percentage}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs uv-text-muted">
                              {formatCurrency(budget.spent, budget.ccy)} / {formatCurrency(budget.limit, budget.ccy)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-2 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full overflow-hidden mb-3">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${getProgressColor(percentage)}`}
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => openEditSheet(budget)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                          <Icons.Edit size={14} />
                          {t('edit')}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(budget.id)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                        >
                          <Icons.X size={14} />
                          {t('delete')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add Budget Button */}
        <button
          onClick={openAddSheet}
          className="w-full mt-5 py-3.5 uv-gradient-brand text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-primary/20"
        >
          <Icons.Plus size={18} />
          {t('category')}
        </button>
      </div>

      {/* Add/Edit BottomSheet */}
      <BottomSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editingBudget ? t('edit') : t('category')}
      >
        <div className="space-y-4">
          {/* Label */}
          <div>
            <label className="block text-sm font-medium uv-text-secondary mb-1">
              {t('category')}
            </label>
            <input
              type="text"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="Ej: Comida, Transporte..."
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-surface-2 text-sm outline-none focus:border-primary dark:text-white"
            />
          </div>

          {/* Limit */}
          <div>
            <label className="block text-sm font-medium uv-text-secondary mb-1">
              {t('amount')}
            </label>
            <input
              type="number"
              value={formLimit}
              onChange={(e) => setFormLimit(e.target.value)}
              placeholder="80000"
              min="0"
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-surface-2 text-sm outline-none focus:border-primary dark:text-white"
            />
          </div>

          {/* Currency */}
          <div>
            <label className="block text-sm font-medium uv-text-secondary mb-1">
              Moneda
            </label>
            <div className="flex gap-2">
              {['CRC', 'USD'].map((ccy) => (
                <button
                  key={ccy}
                  onClick={() => setFormCcy(ccy)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    formCcy === ccy
                      ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'
                      : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {ccy}
                </button>
              ))}
            </div>
          </div>

          {/* Icon selection */}
          <div>
            <label className="block text-sm font-medium uv-text-secondary mb-2">
              Icono
            </label>
            <div className="grid grid-cols-8 gap-2">
              {PRESET_ICONS.map((preset) => {
                const PresetIcon = getIconComponent(preset.name);
                return (
                  <button
                    key={preset.name}
                    onClick={() => setFormIcon(preset.name)}
                    title={preset.label}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                      formIcon === preset.name
                        ? 'bg-primary/20 ring-2 ring-primary'
                        : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    <PresetIcon size={18} className="uv-text-secondary" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color selection */}
          <div>
            <label className="block text-sm font-medium uv-text-secondary mb-2">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setFormColor(color)}
                  className={`w-8 h-8 rounded-full transition-all ${
                    formColor === color ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => setSheetOpen(false)}
            >
              {t('cancel')}
            </Button>
            <button
              onClick={handleSave}
              disabled={!formLabel.trim() || !formLimit || parseInt(formLimit, 10) <= 0}
              className="flex-1 py-3 rounded-xl uv-gradient-brand text-white font-medium text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {t('save')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};
