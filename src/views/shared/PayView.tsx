import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Icons } from '../../components/Icons';
import { useApp } from '@/hooks/useApp';

export const PayView: React.FC = () => {
  const [mode, setMode] = useState<'scan' | 'code'>('scan');
  const [scanned, setScanned] = useState(false);
  const { state } = useApp();

  // Simulate scanning
  useEffect(() => {
    if (mode === 'scan' && !scanned) {
      const timer = setTimeout(() => {
        setScanned(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [mode, scanned]);

  // Reset scanned state when switching to code mode
  const handleModeChange = (newMode: 'scan' | 'code') => {
    setMode(newMode);
    if (newMode === 'code') {
      setScanned(false);
    }
  };

  return (
    <div className="h-full flex flex-col pt-4 px-4 pb-24">
      {/* Segmented Control */}
      <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-xl flex mb-6">
        <button
          onClick={() => handleModeChange('scan')}
          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
            mode === 'scan'
              ? 'bg-white dark:bg-surface-dark shadow-sm text-slate-900 dark:text-white'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          Scan QR
        </button>
        <button
          onClick={() => handleModeChange('code')}
          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
            mode === 'code'
              ? 'bg-white dark:bg-surface-dark shadow-sm text-slate-900 dark:text-white'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          My Code
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center">
        {mode === 'scan' ? (
          <div className="w-full max-w-sm aspect-square relative bg-black rounded-3xl overflow-hidden shadow-2xl border-4 border-white dark:border-gray-700">
             {/* Camera Simulation */}
            <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
               <div className="text-white/50 text-sm">Camera Simulation</div>
            </div>
            
            {/* Scan Overlay */}
            {!scanned ? (
              <>
                <div className="absolute inset-0 border-[40px] border-black/50 z-10" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-accent rounded-lg z-20">
                   <div className="w-full h-0.5 bg-accent/80 shadow-[0_0_10px_rgba(255,122,0,0.8)] animate-scan absolute" />
                </div>
              </>
            ) : (
              <div className="absolute inset-0 bg-accent/90 z-30 flex flex-col items-center justify-center text-white p-6 text-center animate-in fade-in zoom-in duration-300">
                 <div className="w-16 h-16 bg-white rounded-full text-accent flex items-center justify-center mb-4 shadow-lg">
                   <Icons.Shield size={32} />
                 </div>
                 <h3 className="text-xl font-bold mb-1">Merchant Detected</h3>
                 <p className="text-white/90 mb-6">Café Alma - San José</p>
                 <button 
                   onClick={() => setScanned(false)}
                   className="bg-white text-accent px-6 py-3 rounded-xl font-bold w-full shadow-lg active:scale-95 transition-transform"
                 >
                   Pay ₡2,500
                 </button>
              </div>
            )}
            
            {/* Helper Text */}
            <div className="absolute bottom-8 left-0 right-0 text-center text-white/80 z-20 text-sm font-medium">
              {scanned ? 'Tap to pay' : 'Align QR code within frame'}
            </div>
          </div>
        ) : (
          <div className="w-full max-w-sm bg-white dark:bg-surface-dark p-8 rounded-3xl shadow-xl border border-gray-100 dark:border-gray-700 flex flex-col items-center text-center animate-in slide-in-from-bottom-4 duration-300">
            <div className="w-16 h-16 bg-gradient-to-tr from-primary to-accent rounded-2xl mb-4 shadow-lg" />
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">Demo User</h3>
            <p className="text-gray-500 text-sm mb-6">@demouser • {state.baseCurrency}</p>
            
            <div className="p-4 bg-white rounded-2xl shadow-inner border border-gray-100 mb-6">
              <QRCodeSVG value="https://kiramopay.demo/u/demouser" size={180} />
            </div>

            <div className="flex gap-3 w-full">
              <button className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-bold text-slate-700 dark:text-slate-300">
                Copy Link
              </button>
              <button className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-bold text-slate-700 dark:text-slate-300">
                Share
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};