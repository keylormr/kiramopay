import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HistorialDeVersiones } from '../HistorialDeVersiones';
import notasTraducidas from '@/config/notasTraducidas.json';
import { APP_VERSION, getAllVersions } from '@/config/version';

// Perfil > Acerca de lista lo que trajo cada version. El changelog estaba solo en
// espanol, y la etiqueta de la version vigente tambien ("Actual", escrita a
// mano). Se lee en el idioma de la persona.

const traducidas = notasTraducidas as Record<string, Record<string, string[]>>;
const actual = APP_VERSION.current;

function pintar() {
  return render(
    <LanguageProvider>
      <HistorialDeVersiones />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('HistorialDeVersiones', () => {
  it('en espanol lee los cambios del changelog y la vigente dice "Actual"', () => {
    localStorage.setItem('kiramopay_language', 'es');
    pintar();
    expect(screen.getByText(actual.changes[0])).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
  });

  it('en ingles lee los cambios en ingles y la vigente dice "Current"', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    pintar();
    expect(await screen.findByText('Current')).toBeInTheDocument();
    expect(screen.getByText(traducidas[actual.version].en[0])).toBeInTheDocument();
    expect(screen.queryByText(actual.changes[0])).toBeNull();
    expect(screen.queryByText('Actual')).toBeNull();
  });

  it.each(['fr', 'pt', 'zh-cn', 'ja', 'hi'])('en %s lee los cambios de cada version en ese idioma', async (idioma) => {
    localStorage.setItem('kiramopay_language', idioma);
    pintar();
    expect(await screen.findByText(traducidas[actual.version][idioma][0])).toBeInTheDocument();
    // Ninguna version queda en espanol.
    for (const v of getAllVersions()) {
      expect(screen.queryAllByText(v.changes[0]), `${v.version} quedo en espanol`).toHaveLength(0);
    }
  });

  it('muestra todas las versiones, la vigente primero', () => {
    localStorage.setItem('kiramopay_language', 'es');
    pintar();
    const titulos = screen.getAllByText(/^v\d+\.\d+\.\d+$/).map((el) => el.textContent);
    expect(titulos).toEqual(getAllVersions().map((v) => `v${v.version}`));
  });
});
