import React from 'react';
import {
  Language,
  LANGUAGES,
  TranslationKeys,
  defaultTranslations,
  loadLanguage,
} from '../i18n/translations';

function savedLanguage(): Language {
  const saved = localStorage.getItem('kiramopay_language');
  return (saved && LANGUAGES.some((l) => l.code === saved) ? saved : 'es') as Language;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  messages: TranslationKeys;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    // Spanish is bundled; the saved language (if any) is preloaded in
    // componentDidMount so a later crash screen is still localized.
    this.state = { hasError: false, error: null, messages: defaultTranslations };
  }

  componentDidMount() {
    loadLanguage(savedLanguage())
      .then((messages) => this.setState({ messages }))
      .catch(() => {
        /* keep the bundled Spanish fallback */
      });
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Always log — in production the on-screen details are collapsed, so the
    // console is how a crash gets diagnosed. Previously the error was only
    // shown in DEV builds, making production crashes a black box.
    console.error('[KiramoPay] Uncaught render error:', error, errorInfo?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      const t = (key: string): string =>
        (this.state.messages as Record<string, string>)[key] || key;
      return (
        <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-center text-white px-6">
          <div className="w-16 h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">{t('error_title')}</h1>
          <p className="text-gray-400 text-center mb-8 max-w-sm">
            {t('error_desc')}
          </p>

          {this.state.error && (
            <details className="mb-6 w-full max-w-md text-left">
              <summary className="cursor-pointer text-gray-500 text-xs select-none">
                {t('error_details')}
              </summary>
              <pre className="mt-2 p-4 bg-slate-800 rounded-xl text-red-300 text-xs max-w-full overflow-auto max-h-40 w-full whitespace-pre-wrap break-words">
                {this.state.error.message}
                {import.meta.env.DEV && this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
              </pre>
            </details>
          )}

          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={this.handleRetry}
              className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-xl font-bold active:scale-95 transition-all"
            >
              {t('error_retry')}
            </button>
            <button
              onClick={this.handleGoHome}
              className="flex-1 bg-slate-700 text-white py-3 rounded-xl font-bold active:scale-95 transition-all"
            >
              {t('error_home')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
