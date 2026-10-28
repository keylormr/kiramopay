import { render, screen } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '../LanguageContext';
import { LANGUAGES, loadLanguage, type Language, type TranslationKeys } from '../translations';

// La pantalla de arranque (App.tsx) dice "Conectando..." y, pasados unos
// segundos, "El servidor esta despertando". Salian en un idioma que no era el de
// la persona: el diccionario del espanol esta en el paquete y el de los demas
// idiomas llega despues, asi que el primer pintado era siempre en espanol y, si
// el trozo tardaba o fallaba (justo lo que pasa cuando el servidor esta
// dormido), asi se quedaba.
//
// index.tsx pide el diccionario del idioma de la persona ANTES de pintar
// (loadLanguage); desde ahi, el primer render ya tiene que usarlo.

function Sonda() {
  const { t, language } = useLanguage();
  return (
    <div>
      <span data-testid="idioma">{language}</span>
      <p data-testid="conectando">{t('boot_connecting')}</p>
      <p data-testid="despertando">{t('boot_waking')}</p>
      <p data-testid="reintentando">{t('boot_retrying')}</p>
    </div>
  );
}

const codigos = LANGUAGES.map((l) => l.code);
const diccionarios = {} as Record<Language, TranslationKeys>;

beforeAll(async () => {
  for (const codigo of codigos) diccionarios[codigo] = await loadLanguage(codigo);
});

beforeEach(() => {
  localStorage.clear();
});

describe('la pantalla de arranque habla el idioma de la persona desde el primer pintado', () => {
  it.each(codigos)('%s: con el idioma guardado, el primer render ya trae los tres avisos', (codigo) => {
    localStorage.setItem('kiramopay_language', codigo);
    render(
      <LanguageProvider>
        <Sonda />
      </LanguageProvider>,
    );
    // Sin esperar nada: antes del primer efecto, no despues.
    expect(screen.getByTestId('idioma')).toHaveTextContent(codigo);
    expect(screen.getByTestId('conectando')).toHaveTextContent(diccionarios[codigo].boot_connecting);
    expect(screen.getByTestId('despertando')).toHaveTextContent(diccionarios[codigo].boot_waking);
    expect(screen.getByTestId('reintentando')).toHaveTextContent(diccionarios[codigo].boot_retrying);
  });

  it('sin idioma guardado usa el del navegador (en ingles en la prueba), tambien desde el primer pintado', () => {
    render(
      <LanguageProvider>
        <Sonda />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('idioma')).toHaveTextContent('en');
    expect(screen.getByTestId('despertando')).toHaveTextContent(diccionarios.en.boot_waking);
  });
});
