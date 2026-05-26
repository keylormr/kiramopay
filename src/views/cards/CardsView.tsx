
import React, { useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { Icons } from '../../components/Icons';
import { BottomSheet } from '../../components/BottomSheet';

export const CardsView: React.FC = () => {
  const { state, dispatch } = useApp();
  const [showLimits, setShowLimits] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Local state for limits before saving
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
        <div className={`
          relative w-full h-full rounded-3xl p-6 text-white shadow-2xl transition-all duration-500 transform overflow-hidden
          bg-gradient-to-br from-primary via-blue-600 to-purple-600
          ${state.cards.frozen ? 'grayscale opacity-90' : ''}
        `}>
          {/* Frozen Mask Effect */}
          {state.cards.frozen && (
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
               <Icons.Lock size={48} className="text-white/50 mb-2" />
               <span className="font-bold text-white/80 tracking-widest">CARD FROZEN</span>
            </div>
          )}

          <div className="flex justify-between items-start mb-8 relative z-10">
             <span className="font-bold text-lg tracking-wider opacity-90">Kiramopay</span>
             <Icons.SignalHigh size={24} className="opacity-70" />
          </div>
          
          <div className="mb-8 relative z-10">
             <div className="w-12 h-8 bg-yellow-200/80 rounded-md mb-2" /> {/* Chip */}
             <div className="font-mono text-2xl tracking-widest drop-shadow-md">
               {state.cards.frozen 
                 ? '•••• •••• •••• ••••' 
                 : `•••• •••• •••• ${state.cards.last4}`
               }
             </div>
          </div>

          <div className="flex justify-between items-end relative z-10">
            <div>
              <div className="text-[10px] opacity-70 uppercase tracking-widest mb-1">Card Holder</div>
              <div className="font-medium tracking-wide">DEMO USER</div>
            </div>
            <div className="text-2xl font-bold italic opacity-80">VISA</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-3">Card Controls</h3>
        <div className="bg-white dark:bg-surface-dark rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          <button 
            onClick={() => dispatch({ type: 'TOGGLE_FREEZE' })}
            className="w-full flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors active:bg-gray-100"
          >
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 flex items-center justify-center mr-4">
              <Icons.Freeze size={20} />
            </div>
            <div className="flex-1 text-left">
              <div className="font-bold text-slate-900 dark:text-white text-sm">{state.cards.frozen ? 'Unfreeze Card' : 'Freeze Card'}</div>
              <div className="text-xs text-gray-500">Temporarily disable this card</div>
            </div>
            <div className={`w-12 h-7 rounded-full p-1 transition-colors ${state.cards.frozen ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${state.cards.frozen ? 'translate-x-5' : ''}`} />
            </div>
          </button>
          
          <button 
            onClick={() => setShowLimits(true)}
            className="w-full flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors active:bg-gray-100"
          >
             <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 flex items-center justify-center mr-4">
               <Icons.Sliders size={20} />
             </div>
             <div className="flex-1 text-left">
               <div className="font-bold text-slate-900 dark:text-white text-sm">Settings & Limits</div>
               <div className="text-xs text-gray-500">Online payments, ATM withdrawals</div>
             </div>
             <Icons.ChevronRight size={20} className="text-gray-400" />
          </button>

          <button 
             onClick={() => setShowPin(true)}
             className="w-full flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors active:bg-gray-100"
          >
             <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 flex items-center justify-center mr-4">
               <Icons.Shield size={20} />
             </div>
             <div className="flex-1 text-left">
               <div className="font-bold text-slate-900 dark:text-white text-sm">View PIN</div>
               <div className="text-xs text-gray-500">Reveal your 4-digit PIN</div>
             </div>
             <Icons.ChevronRight size={20} className="text-gray-400" />
          </button>
        </div>
      </div>

      {/* Limits Bottom Sheet */}
      <BottomSheet isOpen={showLimits} onClose={() => setShowLimits(false)} title="Card Limits">
        <div className="space-y-8 p-2">
          <div>
            <div className="flex justify-between mb-2">
              <label className="font-bold text-slate-900 dark:text-white">Online Spending</label>
              <span className="text-primary font-bold">${tempLimits.online}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="10000" 
              step="100"
              value={tempLimits.online}
              onChange={(e) => handleLimitChange('online', parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <p className="text-xs text-gray-500 mt-2">Daily limit for online purchases.</p>
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label className="font-bold text-slate-900 dark:text-white">ATM Withdrawals</label>
              <span className="text-primary font-bold">${tempLimits.atm}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="2000" 
              step="50"
              value={tempLimits.atm}
              onChange={(e) => handleLimitChange('atm', parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <p className="text-xs text-gray-500 mt-2">Daily limit for cash withdrawals.</p>
          </div>

          <button 
            onClick={saveLimits}
            className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-4 rounded-xl font-bold"
          >
            Save Changes
          </button>
        </div>
      </BottomSheet>

      {/* PIN Display Sheet (Mock) */}
      <BottomSheet isOpen={showPin} onClose={() => setShowPin(false)} title="Your PIN">
         <div className="flex flex-col items-center py-8">
            <div className="text-6xl font-mono font-black tracking-[1rem] text-slate-900 dark:text-white mb-4">
              8842
            </div>
            <p className="text-center text-gray-500 text-sm">Do not share this code with anyone.<br/>This is for ATM and POS transactions.</p>
         </div>
      </BottomSheet>
    </div>
  );
};
