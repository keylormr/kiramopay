import React from 'react';
import translations, { Language, LANGUAGES } from '../i18n/translations';

const getTranslation = (key: string): string => {
  const saved = localStorage.getItem('kiramopay_language');
  const lang: Language = (saved && LANGUAGES.some(l => l.code === saved) ? saved : 'es') as Language;
  return (translations[lang] as Record<string, string>)[key] || key;
};

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-center text-white px-6">
          <div className="w-16 h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">{getTranslation('error_title')}</h1>
          <p className="text-gray-400 text-center mb-8 max-w-sm">
            {getTranslation('error_desc')}
          </p>

          {import.meta.env.DEV && this.state.error && (
            <pre className="mb-6 p-4 bg-slate-800 rounded-xl text-red-300 text-xs max-w-full overflow-auto max-h-40 w-full">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
          )}

          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={this.handleRetry}
              className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-xl font-bold active:scale-95 transition-all"
            >
              {getTranslation('error_retry')}
            </button>
            <button
              onClick={this.handleGoHome}
              className="flex-1 bg-slate-700 text-white py-3 rounded-xl font-bold active:scale-95 transition-all"
            >
              {getTranslation('error_home')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
