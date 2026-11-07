import { render } from '@testing-library/react';
import { bloquearDesplazamiento } from '../bloqueoDeDesplazamiento';
import { BottomSheet } from '@/components/BottomSheet';
import { LanguageProvider } from '@/i18n/LanguageContext';

// Cada hoja vaciaba body.style.overflow al cerrarse o al montarse cerrada, y
// asi soltaba el bloqueo de otra hoja que seguia abierta: con la de Webhooks
// abierta, la pagina de abajo volvia a desplazarse.

afterEach(() => {
  document.body.style.overflow = '';
});

describe('bloquearDesplazamiento', () => {
  it('se suelta cuando lo suelta el ultimo que lo pidio', () => {
    const a = bloquearDesplazamiento();
    const b = bloquearDesplazamiento();
    expect(document.body.style.overflow).toBe('hidden');
    a();
    expect(document.body.style.overflow).toBe('hidden');
    b();
    expect(document.body.style.overflow).toBe('');
  });

  it('soltar dos veces cuenta una sola', () => {
    const a = bloquearDesplazamiento();
    const b = bloquearDesplazamiento();
    a();
    a();
    expect(document.body.style.overflow).toBe('hidden');
    b();
    expect(document.body.style.overflow).toBe('');
  });

  it('devuelve el valor que habia antes', () => {
    document.body.style.overflow = 'clip';
    const a = bloquearDesplazamiento();
    expect(document.body.style.overflow).toBe('hidden');
    a();
    expect(document.body.style.overflow).toBe('clip');
  });
});

describe('BottomSheet con otra hoja', () => {
  const Dos = ({ primera, segunda }: { primera: boolean; segunda: boolean }) => (
    <LanguageProvider>
      <BottomSheet isOpen={primera} onClose={() => {}} title="Webhooks">
        <p>uno</p>
      </BottomSheet>
      <BottomSheet isOpen={segunda} onClose={() => {}} title="Nuevo webhook">
        <p>dos</p>
      </BottomSheet>
    </LanguageProvider>
  );

  it('una hoja que se monta cerrada no suelta el bloqueo de la abierta', () => {
    render(<Dos primera segunda={false} />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('cerrar la de arriba deja bloqueada la pagina mientras la de abajo sigue abierta', () => {
    const { rerender } = render(<Dos primera segunda />);
    rerender(<Dos primera segunda={false} />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Dos primera={false} segunda={false} />);
    expect(document.body.style.overflow).toBe('');
  });
});
