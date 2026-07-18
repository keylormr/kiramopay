import React from 'react';
import { BottomSheet } from './BottomSheet';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';

interface LanguageSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

// Shared language picker. Mounted both from the global top-bar control (App.tsx)
// and from the Profile > Preferences row, so there is a single implementation.
export const LanguageSheet: React.FC<LanguageSheetProps> = ({ isOpen, onClose }) => {
  const { t, language, setLanguage, languages } = useLanguage();

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('language')}>
      <div className="space-y-2">
        {languages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => {
              setLanguage(lang.code);
              onClose();
            }}
            className={`w-full flex items-center p-4 rounded-xl transition-colors ${
              language === lang.code
                ? 'bg-primary/10 border-2 border-primary'
                : 'uv-surface-2 hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]'
            }`}
          >
            <span className="text-2xl mr-4">{lang.flag}</span>
            <div className="flex-1 text-left">
              <p className={`font-bold ${
                language === lang.code ? 'text-primary' : 'uv-text-primary'
              }`}>
                {lang.nativeName}
              </p>
              <p className="text-xs uv-text-muted mt-0.5">{lang.name}</p>
            </div>
            {language === lang.code && (
              <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                <Icons.Check size={14} className="text-white" />
              </div>
            )}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
};
