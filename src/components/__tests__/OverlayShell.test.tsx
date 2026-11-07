import { render } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { OverlayShell } from '../OverlayShell';

// Tarjetas y Mercado usan este marco. Su contenedor con desplazamiento medía
// max-w-2xl: en escritorio la barra quedaba en medio de la pantalla, debajo
// de la que seguia teniendo la pestana de abajo.
describe('OverlayShell', () => {
  it('lo que se desplaza ocupa todo el ancho de la capa; la columna la pone index.css', () => {
    const { container } = render(
      <LanguageProvider>
        <OverlayShell title="Tarjetas" onClose={() => {}}>
          <p>contenido</p>
        </OverlayShell>
      </LanguageProvider>,
    );
    const capa = container.querySelector('.kp-capa');
    const desplazable = capa?.querySelector(':scope > .overflow-y-auto');
    expect(desplazable).not.toBeNull();
    expect(desplazable?.className).not.toMatch(/max-w-|mx-auto/);
  });
});
