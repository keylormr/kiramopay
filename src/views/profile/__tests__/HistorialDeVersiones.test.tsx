import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HistorialDeVersiones, fechaDeVersion } from '../HistorialDeVersiones';
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

describe('HistorialDeVersiones: vigente completa, anteriores plegadas', () => {
  it('las anteriores empiezan plegadas y cada boton declara aria-expanded', () => {
    localStorage.setItem('kiramopay_language', 'es');
    pintar();
    const anteriores = getAllVersions().slice(1);
    const botones = screen.getAllByRole('button', { expanded: false });
    expect(botones).toHaveLength(anteriores.length);
    for (const b of botones) expect(b).toHaveAttribute('aria-controls');
  });

  it('el boton despliega y vuelve a plegar las notas de su version', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    const user = userEvent.setup();
    pintar();
    const previa = getAllVersions()[1];
    const boton = screen.getByRole('button', { name: new RegExp(`v${previa.version.replace(/\./g, '\\.')},`) });
    const panel = document.getElementById(boton.getAttribute('aria-controls') as string) as HTMLElement;
    expect(panel).toHaveAttribute('inert');
    await user.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('inert');
    await user.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('inert');
  });

  it('la fecha sale legible en el idioma de la persona y sin correrse de dia', () => {
    expect(fechaDeVersion('2026-11-05', 'es')).toMatch(/5.*noviembre.*2026/);
    expect(fechaDeVersion('2026-11-05', 'en')).toMatch(/November.*5.*2026|5.*November.*2026/);
    expect(fechaDeVersion('2026-11-05', 'ja')).toContain('2026');
    expect(fechaDeVersion('sin fecha', 'es')).toBe('sin fecha');
  });
});

describe('changelog del rediseno', () => {
  // La 2.9.0 junta lo anterior al rediseno; de la 2.10.0 en adelante, una por fase.
  const nuevas = ['2.9.0', '2.10.0', '2.11.0', '2.12.0', '2.13.0', '2.14.0', '2.15.0'];
  const fases = nuevas.slice(1);
  const por = (v: string) => getAllVersions().find((x) => x.version === v)!;

  it('una version por fase, con buildNumber consecutivo y la ultima vigente', () => {
    expect(APP_VERSION.current.version).toBe(nuevas[nuevas.length - 1]);
    nuevas.forEach((v, i) => expect(por(v).buildNumber).toBe(19 + i));
  });

  it('entre 3 y 7 cambios por version, sin emojis y con su traduccion', () => {
    for (const v of nuevas) {
      const cambios = por(v).changes;
      expect(cambios.length, v).toBeGreaterThanOrEqual(3);
      expect(cambios.length, v).toBeLessThanOrEqual(7);
      for (const idioma of ['en', 'fr', 'pt', 'zh-cn', 'ja', 'hi']) {
        const textos = traducidas[v][idioma];
        expect(textos, `${v} ${idioma}`).toHaveLength(cambios.length);
        for (const c of [...cambios, ...textos]) expect(c).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it('cada fase se reconoce como tal en su primer cambio', () => {
    fases.forEach((v, i) => expect(por(v).changes[0], v).toMatch(new RegExp(`^Rediseño, fase ${i + 1}:`)));
  });
});
