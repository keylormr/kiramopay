import React from 'react';
import { Icons } from './Icons';
import { useLanguage } from '../i18n/LanguageContext';

interface OverlayShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

// Full-screen overlay wrapper with a sticky back-header, used to host views that
// render their own body but no chrome (e.g. Marketplace). Mirrors the header of
// the other overlay views (SavingsView, EscrowView, …) for a consistent feel.
export const OverlayShell: React.FC<OverlayShellProps> = ({ title, onClose, children }) => {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] animate-fade-in">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-[#121E3A]/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 min-h-14 pt-safe flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onClose}
          aria-label={t('back')}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-text-secondary"
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <span className="font-bold text-lg tracking-tight uv-text-primary">{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto max-w-2xl mx-auto w-full">
        {children}
      </div>
    </div>
  );
};
