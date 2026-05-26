import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useLanguage } from '@/i18n/LanguageContext';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({ isOpen, onClose, children, title }) => {
  const { t } = useLanguage();
  const viewportHeight = CSS.supports?.('height', '100dvh') ? '100dvh' : '100vh';
  const [visible, setVisible] = useState(isOpen);

  // Sync visible immediately when isOpen becomes true (React 18+ render-time state update)
  if (isOpen && !visible) {
    setVisible(true);
  }

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!visible && !isOpen) return null;

  // Use portal to render at document root level
  return ReactDOM.createPortal(
    <div
      className="flex items-end justify-center sm:items-center"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: viewportHeight,
        zIndex: 9999,
      }}
    >
      {/* Backdrop - covers entire viewport with extra overflow */}
      <div
        role="presentation"
        onClick={onClose}
        className={`transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        style={{
          position: 'absolute',
          top: '-100px',
          left: '-100px',
          right: '-100px',
          bottom: '-100px',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        {...(title ? { 'aria-labelledby': 'bottom-sheet-title' } : {})}
        className={`
          relative w-full max-w-md bg-surface dark:bg-surface-dark rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl transform transition-transform duration-300
          ${isOpen ? 'translate-y-0 scale-100' : 'translate-y-full sm:translate-y-10 sm:scale-95'}
        `}
        style={{ maxHeight: '85vh' }}
      >
        {/* Handle for mobile feel */}
        <div className="w-12 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-6 sm:hidden" />

        {title && (
          <div className="flex justify-between items-center mb-4">
            <h2 id="bottom-sheet-title" className="text-xl font-bold dark:text-white">{title}</h2>
            <button onClick={onClose} aria-label={t('close')} className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              ✕
            </button>
          </div>
        )}

        <div className="max-h-[70vh] overflow-y-auto no-scrollbar">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};