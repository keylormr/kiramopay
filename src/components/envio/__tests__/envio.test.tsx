import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { SinpeTransaction } from '@/types';
import { HojaRevisarEnvio } from '../HojaRevisarEnvio';
import { ComprobanteDeEnvio } from '../ComprobanteDeEnvio';
import { Icono3D, Ilustracion3D } from '@/components/arte3d/Arte3D';

// Revisar y enviar, y el comprobante (tablero "Enviar" del concepto).

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('HojaRevisarEnvio', () => {
  const pintar = (procesando = false, onConfirm = vi.fn()) =>
    render(
      <LanguageProvider>
        <HojaRevisarEnvio
          isOpen
          onClose={vi.fn()}
          onConfirm={onConfirm}
          procesando={procesando}
          nombre="Diego Rojas"
          telefono="8812-4471"
          monto={25000}
          saldo={572078.95}
          referencia="Almuerzo"
        />
      </LanguageProvider>,
    );

  it('dice que va a pasar antes de enviar', () => {
    pintar();
    expect(screen.getByText('Revisa antes de enviar')).toBeInTheDocument();
    expect(screen.getByText('Diego recibe')).toBeInTheDocument();
    expect(screen.getByText('₡0.00')).toBeInTheDocument();
    expect(screen.getByText('Entre cuentas KiramoPay no se cobra')).toBeInTheDocument();
    expect(screen.getByText('₡572,078.95 → ₡547,078.95')).toBeInTheDocument();
    expect(screen.getByText('Al instante')).toBeInTheDocument();
    expect(screen.getByText('Almuerzo')).toBeInTheDocument();
    expect(screen.getByText('DR')).toBeInTheDocument();
  });

  it('el boton dice cuanto se envia y confirma', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    pintar(false, onConfirm);
    await user.click(screen.getByRole('button', { name: 'Enviar ₡25,000.00' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('a un numero tecleado: icono de telefono y "Recibe", sin repetir el numero', () => {
    const { baseElement } = render(
      <LanguageProvider>
        <HojaRevisarEnvio
          isOpen
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          procesando={false}
          nombre="8812-4471"
          telefono="8812-4471"
          monto={25000}
          saldo={572078.95}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText('Recibe')).toBeInTheDocument();
    expect(screen.queryByText('#')).not.toBeInTheDocument();
    expect(screen.getAllByText('8812-4471')).toHaveLength(1);
    // El avatar lleva el icono de telefono en vez de iniciales.
    const avatar = screen.getByText('Recibe').closest('[role="dialog"]') ?? baseElement;
    expect(avatar.querySelector('div.h-16 svg')).not.toBeNull();
  });

  it('enviando: el boton lo dice y no se puede tocar otra vez', () => {
    pintar(true);
    const boton = screen.getByRole('button', { name: /Enviando/ });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ComprobanteDeEnvio', () => {
  const envio: SinpeTransaction = {
    id: 'tx-7f3a21c9',
    type: 'sent',
    amount: 25000,
    phone: '+50688124471',
    name: 'Diego Rojas',
    date: 'Ahora',
    dateISO: '2026-11-06T20:32:00Z',
    status: 'completed',
    reference: 'Almuerzo',
    internal: true,
  };

  const pintar = (extra: Partial<SinpeTransaction> = {}, yaEstabaHecho = false, onListo = vi.fn(), onCompartir = vi.fn()) =>
    render(
      <LanguageProvider>
        <ComprobanteDeEnvio envio={{ ...envio, ...extra }} yaEstabaHecho={yaEstabaHecho} onListo={onListo} onCompartir={onCompartir} />
      </LanguageProvider>,
    );

  it('llego: la ilustracion, a quien y el numero de la transaccion', () => {
    const { container } = pintar();
    expect(screen.getByText('Le llegó a Diego')).toBeInTheDocument();
    expect(container.querySelector('img[data-arte3d="envioListo"]')).not.toBeNull();
    expect(screen.getByText('tx-7f3a21c9')).toBeInTheDocument();
    expect(screen.getByText('Almuerzo')).toBeInTheDocument();
  });

  it('sin nombre (llega el telefono en su lugar): el titulo con el numero formateado y sin fila repetida', () => {
    pintar({ name: '+50688124471' });
    expect(screen.getByText('Le llegó a +506 8812-4471')).toBeInTheDocument();
    expect(screen.queryByText('Enviado a')).not.toBeInTheDocument();
    expect(screen.getByText('Teléfono')).toBeInTheDocument();
  });

  it('pendiente (otro banco): sin celebrar ni decir que llego', () => {
    const { container } = pintar({ internal: false });
    expect(screen.queryByText(/Le llegó/)).not.toBeInTheDocument();
    expect(container.querySelector('img[data-arte3d="envioListo"]')).toBeNull();
  });

  it('ya estaba hecho: lo dice y no lo celebra', () => {
    const { container } = pintar({}, true);
    expect(screen.getByText(/Ese envío ya se había hecho/)).toBeInTheDocument();
    expect(container.querySelector('img[data-arte3d="envioListo"]')).toBeNull();
  });

  it('ya estaba hecho: sin la fecha de ahora, que no es la del envio', () => {
    pintar({}, true);
    expect(screen.queryByText('Fecha')).not.toBeInTheDocument();
    expect(screen.getByText('tx-7f3a21c9')).toBeInTheDocument();
  });

  it('Compartir y Listo', async () => {
    const user = userEvent.setup();
    const onListo = vi.fn();
    const onCompartir = vi.fn();
    pintar({}, false, onListo, onCompartir);
    await user.click(screen.getByRole('button', { name: 'Compartir' }));
    await user.click(screen.getByRole('button', { name: 'Listo' }));
    expect(onCompartir).toHaveBeenCalledTimes(1);
    expect(onListo).toHaveBeenCalledTimes(1);
  });
});

describe('Arte3D', () => {
  it('sirve el tamano justo con srcset y queda decorativo por defecto', () => {
    const { container } = render(<Icono3D nombre="comida" tamano={34} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('srcset')).toMatch(/ 64w, .* 128w$/);
    expect(img.getAttribute('sizes')).toBe('34px');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden', 'true');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('con texto alternativo se anuncia; la prioritaria no espera al desplazamiento', () => {
    const { container } = render(<Ilustracion3D nombre="envioListo" tamano={148} alt="Envio listo" prioritaria />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('alt', 'Envio listo');
    expect(img).not.toHaveAttribute('aria-hidden');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img.getAttribute('srcset')).toMatch(/ 480w, .* 960w$/);
  });
});
