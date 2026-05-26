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
      {/* Backdrop */}
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
          backgroundColor: 'rgba(6, 14, 31, 0.55)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        {...(title ? { 'aria-labelledby': 'bottom-sheet-title' } : {})}
        className={`
          relative w-full max-w-md uv-surface-1 uv-shadow-floating
          rounded-t-[2.25rem] sm:rounded-3xl p-6 transform transition-transform duration-300
          ${isOpen ? 'translate-y-0 scale-100' : 'translate-y-full sm:translate-y-10 sm:scale-95'}
        `}
        style={{ maxHeight: '85vh' }}
      >
        {/* Drag handle (mobile only) */}
        <div className="w-10 h-1.5 bg-[var(--color-border-strong)] dark:bg-[var(--color-border-strong-dark)] rounded-full mx-auto mb-5 sm:hidden" />

        {title && (
          <div className="flex justify-between items-center mb-5">
            <h2
              id="bottom-sheet-title"
              className="text-xl font-bold tracking-tight uv-text-primary"
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label={t('close')}
              className="w-9 h-9 flex items-center justify-center bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full uv-text-secondary hover:bg-[var(--color-border)] dark:hover:bg-[var(--color-border-dark)] transition-colors text-base"
            >
              ✕
            </button>
          </div>
        )}

        <div className="max-h-[70vh] overflow-y-auto no-scrollbar">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};
