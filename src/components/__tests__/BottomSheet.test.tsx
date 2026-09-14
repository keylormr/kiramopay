import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BottomSheet } from '../BottomSheet';

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LanguageProvider>{children}</LanguageProvider>
);

describe('BottomSheet', () => {
  beforeEach(() => {
    localStorage.setItem('kiramopay_language', 'es');
  });

  it('should not render when closed', () => {
    render(
      <BottomSheet isOpen={false} onClose={() => {}}>
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('should render children when open', () => {
    render(
      <BottomSheet isOpen={true} onClose={() => {}}>
        <p>Sheet Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('Sheet Content')).toBeInTheDocument();
  });

  it('should render title when provided', () => {
    render(
      <BottomSheet isOpen={true} onClose={() => {}} title="My Title">
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <BottomSheet isOpen={true} onClose={onClose} title="Test">
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    await user.click(screen.getByLabelText(/cerrar/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <BottomSheet isOpen={true} onClose={onClose}>
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    // The backdrop is rendered as a portal at document.body level
    // Click the backdrop (the first positioned div in the portal)
    const backdrop = document.querySelector('[style*="backdrop-filter"]');
    expect(backdrop).toBeTruthy();
    await user.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should set body overflow to hidden when open', () => {
    render(
      <BottomSheet isOpen={true} onClose={() => {}}>
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('should restore body overflow when closed', async () => {
    const { rerender } = render(
      <BottomSheet isOpen={true} onClose={() => {}}>
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <LanguageProvider>
        <BottomSheet isOpen={false} onClose={() => {}}>
          <p>Content</p>
        </BottomSheet>
      </LanguageProvider>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  // La hoja declara aria-modal pero el foco se quedaba detras: Tab recorria la
  // pantalla tapada y activaba controles que la persona no veia.
  it('al abrirse lleva el foco adentro y al cerrarse lo devuelve a quien la abrio', async () => {
    const Prueba = () => {
      const [abierta, setAbierta] = useState(false);
      return (
        <>
          <button onClick={() => setAbierta(true)}>Abrir</button>
          <BottomSheet isOpen={abierta} onClose={() => setAbierta(false)} title="Hoja">
            <button>Dentro</button>
          </BottomSheet>
        </>
      );
    };
    const user = userEvent.setup();
    render(<Prueba />, { wrapper: Wrapper });
    const abrir = screen.getByText('Abrir');
    await user.click(abrir);
    const dialogo = await screen.findByRole('dialog');
    await waitFor(() => expect(dialogo.contains(document.activeElement)).toBe(true));

    await user.click(screen.getByLabelText(/cerrar/i));
    await waitFor(() => expect(document.activeElement).toBe(abrir));
  });

  it('Tab y Shift+Tab ciclan dentro de la hoja', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Fondo</button>
        <BottomSheet isOpen onClose={() => {}} title="Hoja">
          <button>Primero adentro</button>
          <button>Ultimo</button>
        </BottomSheet>
      </>,
      { wrapper: Wrapper },
    );
    const dialogo = screen.getByRole('dialog');
    await waitFor(() => expect(dialogo.contains(document.activeElement)).toBe(true));

    screen.getByText('Ultimo').focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText(/cerrar/i));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText('Ultimo'));
    expect(screen.getByText('Fondo')).not.toBe(document.activeElement);
  });

  it('Escape cierra solo la hoja de arriba', async () => {
    const cerrarAbajo = vi.fn();
    const cerrarArriba = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <BottomSheet isOpen onClose={cerrarAbajo} title="Abajo">
          <p>a</p>
        </BottomSheet>
        <BottomSheet isOpen onClose={cerrarArriba} title="Arriba">
          <p>b</p>
        </BottomSheet>
      </>,
      { wrapper: Wrapper },
    );
    await user.keyboard('{Escape}');
    expect(cerrarArriba).toHaveBeenCalledTimes(1);
    expect(cerrarAbajo).not.toHaveBeenCalled();
  });

  it('con una operacion en vuelo, Escape no la cierra', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <BottomSheet isOpen onClose={onClose} title="Enviando" dismissable={false}>
        <p>c</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
