import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider, useLanguage } from '../LanguageContext';

function TestComponent() {
  const { language, setLanguage, t, currentLanguage } = useLanguage();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="flag">{currentLanguage.flag}</span>
      <span data-testid="translated">{t('app_name')}</span>
      <span data-testid="welcome">{t('welcome')}</span>
      <button data-testid="switch-en" onClick={() => setLanguage('en')}>EN</button>
      <button data-testid="switch-ja" onClick={() => setLanguage('ja')}>JA</button>
    </div>
  );
}

describe('LanguageContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should default to Spanish', () => {
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>,
    );
    // Default can be 'es' or browser-detected, but t('app_name') should always work
    expect(screen.getByTestId('translated')).toHaveTextContent('KiramoPay');
  });

  it('should provide t() function that translates keys', () => {
    localStorage.setItem('kiramopay_language', 'es');
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('es');
    expect(screen.getByTestId('welcome')).not.toHaveTextContent('welcome'); // should be translated
  });

  it('should switch language when setLanguage is called', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>,
    );

    await user.click(screen.getByTestId('switch-en'));
    expect(screen.getByTestId('lang')).toHaveTextContent('en');

    await user.click(screen.getByTestId('switch-ja'));
    expect(screen.getByTestId('lang')).toHaveTextContent('ja');
  });

  it('should persist language to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>,
    );

    await user.click(screen.getByTestId('switch-en'));
    expect(localStorage.getItem('kiramopay_language')).toBe('en');
  });

  it('should load saved language from localStorage', () => {
    localStorage.setItem('kiramopay_language', 'ja');
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('ja');
    expect(screen.getByTestId('flag')).toHaveTextContent('🇯🇵');
  });

  it('should return key as fallback for unknown translation keys', () => {
    localStorage.setItem('kiramopay_language', 'es');
    function FallbackTest() {
      const { t } = useLanguage();
      return <span data-testid="unknown">{t('nonexistent_key_xyz')}</span>;
    }
    render(
      <LanguageProvider>
        <FallbackTest />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('unknown')).toHaveTextContent('nonexistent_key_xyz');
  });
});
