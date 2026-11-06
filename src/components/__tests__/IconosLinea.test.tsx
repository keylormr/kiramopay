import { render } from '@testing-library/react';
import { IconosLinea } from '../Icons';
import { LogoCripto, tieneLogoCripto } from '../LogoCripto';

// Los iconos propios reemplazan a los emojis que hacian de icono: trazo de 1,75
// con un cuerpo de relleno suave (16 % por defecto, 22 % en la navegacion
// activa), el color del tema y las mismas props que un icono de lucide.

const NOMBRES = Object.keys(IconosLinea) as (keyof typeof IconosLinea)[];

describe('IconosLinea', () => {
  it('hay iconos que revisar', () => {
    expect(NOMBRES.length).toBeGreaterThan(20);
  });

  it.each(NOMBRES)('%s: trazo 1,75 en una reticula de 24, con cuerpo de relleno suave', (nombre) => {
    const Icono = IconosLinea[nombre];
    const { container } = render(<Icono />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('stroke-width')).toBe('1.75');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('data-icono')).toBe(nombre);
    const cuerpo = svg?.querySelector('path');
    expect(cuerpo?.getAttribute('fill')).toBe('currentColor');
    expect(cuerpo?.getAttribute('style')).toContain('var(--kp-icono-relleno, 0.16)');
    // Decorativo por defecto: el texto de al lado ya dice que es.
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('acepta las props de lucide: tamano, trazo y clase', () => {
    const { container } = render(<IconosLinea.Inicio size={30} strokeWidth={2} className="text-red-500" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('30');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
    expect(svg?.getAttribute('class')).toContain('text-red-500');
    expect(svg?.getAttribute('class')).toContain('kp-icono');
  });

  it('con nombre accesible se anuncia y deja de ser decorativo', () => {
    const { container } = render(<IconosLinea.Banco aria-label="Banco" role="img" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('Banco');
  });
});

describe('LogoCripto', () => {
  it('Bitcoin: la moneda naranja oficial con el simbolo blanco', () => {
    const { container } = render(<LogoCripto simbolo="BTC" size={40} />);
    const logo = container.querySelector('[data-cripto="BTC"]');
    expect(logo).not.toBeNull();
    expect(logo?.innerHTML).toContain('#F7931A');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
  });

  it('Ethereum: el diamante oficial de ethereum.org con sus tres tonos', () => {
    const { container } = render(<LogoCripto simbolo="ETH" titulo="Ethereum" />);
    const logo = container.querySelector('[data-cripto="ETH"]');
    for (const tono of ['#8A92B2', '#62688F', '#454A75']) expect(logo?.innerHTML).toContain(tono);
    expect(logo?.getAttribute('role')).toBe('img');
    expect(logo?.getAttribute('aria-label')).toBe('Ethereum');
  });

  it('una moneda sin logo no inventa uno: devuelve nada', () => {
    const { container } = render(<LogoCripto simbolo="DOGE" />);
    expect(container.innerHTML).toBe('');
    expect(tieneLogoCripto('DOGE')).toBe(false);
    expect(tieneLogoCripto('BTC')).toBe(true);
  });

  it('no pide nada afuera', () => {
    for (const simbolo of ['BTC', 'ETH']) {
      const { container, unmount } = render(<LogoCripto simbolo={simbolo} />);
      expect(container.querySelector('image, img, use')).toBeNull();
      expect(container.innerHTML).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
      unmount();
    }
  });
});
