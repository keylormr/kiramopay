import { render } from '@testing-library/react';
import { Bandera, banderaConocida } from '../Bandera';
import { LANGUAGES } from '@/i18n/translations';

// Windows no dibuja los emojis de bandera: el selector de idioma, las cuentas y
// las monedas del cobro mostraban las letras "CR" y "US" en vez de la bandera.
// Las banderas son SVG en linea (sin pedir nada a un CDN), y el componente
// acepta lo que ya traen los datos: el emoji de la bandera o el codigo del pais.

// Cada pais que la app dibuja hoy: los siete idiomas, las dos monedas de las
// cuentas y los tres paises con operacion (backend/internal/country).
const PAISES = ['CR', 'US', 'FR', 'BR', 'CN', 'JP', 'IN', 'PA', 'GT'];

describe('Bandera', () => {
  it.each(PAISES)('%s: dibuja un SVG en linea', (pais) => {
    const { container } = render(<Bandera pais={pais} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('data-pais')).toBe(pais);
    // Sin tipografia de por medio: nada que Windows tenga que sustituir.
    expect(container.textContent).toBe('');
  });

  it('no pide nada afuera: ni imagenes ni enlaces', () => {
    for (const pais of PAISES) {
      const { container, unmount } = render(<Bandera pais={pais} />);
      expect(container.querySelector('image, img, use, foreignObject')).toBeNull();
      expect(container.innerHTML).not.toMatch(/https?:\/\//);
      unmount();
    }
  });

  it('acepta el emoji de la bandera igual que el codigo', () => {
    const conEmoji = render(<Bandera pais={'\u{1F1E8}\u{1F1F7}'} />);
    const conCodigo = render(<Bandera pais="CR" />);
    expect(conEmoji.container.innerHTML).toBe(conCodigo.container.innerHTML);
  });

  it('acepta el codigo en minusculas', () => {
    const a = render(<Bandera pais="us" />);
    const b = render(<Bandera pais="US" />);
    expect(a.container.innerHTML).toBe(b.container.innerHTML);
  });

  it('lo que no es una bandera pasa tal cual (un edificio, una moneda cripto)', () => {
    const { container } = render(<Bandera pais={'\u{1F3E6}'} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('\u{1F3E6}');
  });

  it('un pais que no sabe dibujar no rompe la pantalla: un recuadro neutro', () => {
    const { container } = render(<Bandera pais="ZZ" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('por defecto es decorativa; con titulo se anuncia', () => {
    const decorativa = render(<Bandera pais="CR" />).container.querySelector('svg');
    expect(decorativa?.getAttribute('aria-hidden')).toBe('true');
    const conTitulo = render(<Bandera pais="CR" titulo="Costa Rica" />).container.querySelector('svg');
    expect(conTitulo?.getAttribute('role')).toBe('img');
    expect(conTitulo?.getAttribute('aria-label')).toBe('Costa Rica');
  });

  it('la clase y el tamano los pone quien la usa', () => {
    const { container } = render(<Bandera pais="CR" className="mr-4" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('mr-4');
  });

  it('sabe dibujar la bandera de cada idioma de la app', () => {
    for (const idioma of LANGUAGES) {
      expect(banderaConocida(idioma.flag), `${idioma.code}: ${idioma.flag}`).toBe(true);
    }
  });

  it('sabe decir cuando no conoce una', () => {
    expect(banderaConocida('ZZ')).toBe(false);
    expect(banderaConocida('\u{1F3E6}')).toBe(false);
  });
});
