import React, { useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { Icons } from '../../components/Icons';
import { Button } from '../../components/ui';
import { BottomSheet } from '../../components/BottomSheet';

export const CardsView: React.FC = () => {
  const { state, dispatch } = useApp();
  const [showLimits, setShowLimits] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const [tempLimits, setTempLimits] = useState(state.cards.limits);

  const handleLimitChange = (type: 'online' | 'atm', val: number) => {
    setTempLimits(prev => ({ ...prev, [type]: val }));
  };

  const saveLimits = () => {
    dispatch({ type: 'UPDATE_LIMITS', payload: tempLimits });
    setShowLimits(false);
  };

  return (
    <div className="pt-4 px-4 pb-24 space-y-6">
      {/* Card Visual */}
      <div className="relative h-56 w-full max-w-md mx-auto perspective-1000 group">
        <div
          className={`relative w-full h-full rounded-3xl p-6 text-white uv-shadow-floating transition-all duration-500 transform overflow-hidden uv-gradient-brand ${
            state.cards.frozen ? 'grayscale opacity-90' : ''
          }`}
        >
          {/* Decorative orb */}
          <div
            className="absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-30 pointer-events-none"
            style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.6), transparent)' }}
          />
          {/* Frozen Mask Effect */}
          {state.cards.frozen && (
            <div className="absolute inset-0 bg-[var(--color-navy-950)]/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center rounded-3xl">
              <Icons.Lock size={48} className="text-white/60 mb-2" />
              <span className="font-bold text-white/85 tracking-widest">CARD FROZEN</span>
            </div>
          )}

          <div className="relative flex justify-between items-start mb-8 z-10">
            <span className="font-bold text-lg tracking-wide opacity-90">KiramoPay</span>
            <Icons.SignalHigh size={24} className="opacity-70" />
          </div>

          <div className="relative mb-8 z-10">
            <div className="w-12 h-8 rounded-md mb-2 bg-gradient-to-br from-amber-200 to-yellow-400 uv-shadow-soft" /> {/* Chip */}
            <div className="font-mono text-2xl tracking-widest drop-shadow-md tabular-nums">
              {state.cards.frozen
                ? '•••• •••• •••• ••••'
                : `•••• •••• •••• ${state.cards.last4}`}
            </div>
          </div>

          <div className="relative flex justify-between items-end z-10">
            <div>
              <div className="text-[10px] opacity-70 uppercase tracking-widest mb-1">Card Holder</div>
              <div className="font-medium tracking-wide">DEMO USER</div>
            </div>
            <div className="text-2xl font-bold italic opacity-85">VISA</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div>
        <h3 className="text-base font-bold uv-text-primary mb-3 tracking-tight">Controles de tarjeta</h3>
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          <button
            onClick={() => dispatch({ type: 'TOGGLE_FREEZE' })}
            className="w-full flex items-center px-4 py-4 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors active:scale-[0.997]"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center mr-4 shrink-0">
              <Icons.Freeze size={20} />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="font-semibold uv-text-primary text-sm">
                {state.cards.frozen ? 'Descongelar tarjeta' : 'Congelar tarjeta'}
              </div>
              <div className="text-xs uv-text-muted mt-0.5">Desactivar temporalmente</div>
            </div>
            <div
              className={`w-12 h-7 rounded-full p-1 transition-colors shrink-0 ${
                state.cards.frozen ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border-strong)] dark:bg-[var(--color-border-dark)]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full uv-shadow-soft transition-transform ${
                  state.cards.frozen ? 'translate-x-5' : ''
                }`}
              />
            </div>
          </button>

          <button
            onClick={() => setShowLimits(true)}
            className="w-full flex items-center px-4 py-4 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors active:scale-[0.997]"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center mr-4 shrink-0">
              <Icons.Sliders size={20} />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="font-semibold uv-text-primary text-sm">Ajustes y limites</div>
              <div className="text-xs uv-text-muted mt-0.5">Compras online, retiros en ATM</div>
            </div>
            <Icons.ChevronRight size={20} className="uv-text-muted shrink-0" />
          </button>

          <button
            onClick={() => setShowPin(true)}
            className="w-full flex items-center px-4 py-4 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors active:scale-[0.997]"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--color-warning-soft)] text-[var(--color-warning)] flex items-center justify-center mr-4 shrink-0">
              <Icons.Shield size={20} />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="font-semibold uv-text-primary text-sm">Ver PIN</div>
              <div className="text-xs uv-text-muted mt-0.5">Revelar tu PIN de 4 digitos</div>
            </div>
            <Icons.ChevronRight size={20} className="uv-text-muted shrink-0" />
          </button>
        </div>
      </div>

      {/* Info card — encourages future virtual cards / bank links */}
      <div className="uv-surface-2 rounded-2xl p-4 border border-dashed border-[var(--color-border-strong)] dark:border-[var(--color-border-dark)]">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center shrink-0">
            <Icons.Plus size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold uv-text-primary text-sm">Agregar tarjeta virtual</div>
            <div className="text-xs uv-text-muted mt-0.5">Crea una tarjeta desechable para compras online</div>
          </div>
          <Icons.ChevronRight size={20} className="uv-text-muted shrink-0" />
        </div>
      </div>

      {/* Limits Bottom Sheet */}
      <BottomSheet isOpen={showLimits} onClose={() => setShowLimits(false)} title="Limites de tarjeta">
        <div className="space-y-8 p-2">
          <div>
            <div className="flex justify-between mb-2">
              <label className="font-semibold uv-text-primary">Compras online</label>
              <span className="text-[var(--color-primary)] font-bold tabular-nums">${tempLimits.online}</span>
            </div>
            <input
              type="range"
              min="0"
              max="10000"
              step="100"
              value={tempLimits.online}
              onChange={(e) => handleLimitChange('online', parseInt(e.target.value))}
              className="w-full h-2 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-lg appearance-none cursor-pointer accent-[var(--color-primary)]"
            />
            <p className="text-xs uv-text-muted mt-2">Limite diario para compras en internet.</p>
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label className="font-semibold uv-text-primary">Retiros en ATM</label>
              <span className="text-[var(--color-primary)] font-bold tabular-nums">${tempLimits.atm}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2000"
              step="50"
              value={tempLimits.atm}
              onChange={(e) => handleLimitChange('atm', parseInt(e.target.value))}
              className="w-full h-2 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-lg appearance-none cursor-pointer accent-[var(--color-primary)]"
            />
            <p className="text-xs uv-text-muted mt-2">Limite diario para retiros en efectivo.</p>
          </div>

          <Button onClick={saveLimits} size="lg" fullWidth>
            Guardar cambios
          </Button>
        </div>
      </BottomSheet>

      {/* PIN Display Sheet */}
      <BottomSheet isOpen={showPin} onClose={() => setShowPin(false)} title="Tu PIN">
        <div className="flex flex-col items-center py-8">
          <div className="text-6xl font-mono font-black tracking-[1rem] uv-text-primary mb-4">
            8842
          </div>
          <p className="text-center uv-text-muted text-sm">
            No compartas este codigo con nadie.<br />
            Es para transacciones en ATM y POS.
          </p>
        </div>
      </BottomSheet>
    </div>
  );
};
