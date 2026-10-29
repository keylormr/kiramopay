import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LanguageSheet } from '../LanguageSheet';

// En Windows el selector de idioma mostraba "CR", "US", "FR"... en lugar de las
// banderas: Windows no trae glifos para los emojis de bandera. Cada idioma
// lleva su bandera dibujada como SVG.

const REGIONAL = /[\u{1F1E6}-\u{1F1FF}]/u;

describe('LanguageSheet', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
  });

  it('cada idioma lleva su bandera como SVG, no como emoji', () => {
    render(
      <LanguageProvider>
        <LanguageSheet isOpen onClose={() => {}} />
      </LanguageProvider>,
    );

    // Los siete idiomas estan en la lista.
    expect(screen.getByText('Español')).toBeInTheDocument();
    expect(screen.getByText('日本語')).toBeInTheDocument();

    const banderas = document.querySelectorAll('svg[data-pais]');
    expect(banderas).toHaveLength(7);
    expect([...banderas].map((b) => b.getAttribute('data-pais')).sort()).toEqual(
      ['BR', 'CN', 'CR', 'FR', 'IN', 'JP', 'US'],
    );
    expect(document.body.textContent).not.toMatch(REGIONAL);
  });
});
