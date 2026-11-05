import { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BotonCompartirQr } from '../BotonCompartirQr';

// El boton "Compartir como imagen" de los QR propios. Dibuja la tarjeta con el
// QR que esta en pantalla y la entrega; aqui se vigila lo que la persona ve:
// que el boton espere, que cada final diga lo que paso y que no se quede un
// aviso viejo.

const mocks = vi.hoisted(() => ({
  dibujar: vi.fn(),
  compartir: vi.fn(),
}));

vi.mock('@/utils/qrComoImagen', () => ({
  dibujarTarjetaQr: mocks.dibujar,
  compartirImagenDeQr: mocks.compartir,
}));

const PNG = new Blob(['png'], { type: 'image/png' });

function Caja({ conQr = true }: { conQr?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref}>{conQr ? <svg data-testid="qr" /> : <p>sin codigo</p>}</div>
      <BotonCompartirQr
        contenedor={ref}
        titulo="Keilor Martinez"
        subtitulo="+506 8888-0000"
        pie="Escanéalo con KiramoPay para pagar"
        nombreArchivo="kiramopay-cobro.png"
      />
    </div>
  );
}

function pintar(props: { conQr?: boolean } = {}) {
  return render(
    <LanguageProvider>
      <Caja {...props} />
    </LanguageProvider>,
  );
}

const boton = () => screen.getByRole('button', { name: 'Compartir como imagen' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.dibujar.mockResolvedValue(PNG);
  mocks.compartir.mockResolvedValue('compartido');
});

describe('BotonCompartirQr', () => {
  it('dibuja la tarjeta con el QR que esta en pantalla y la entrega con su nombre', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(boton());

    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(1));
    expect(mocks.dibujar).toHaveBeenCalledWith({
      svg: screen.getByTestId('qr'),
      marca: 'KiramoPay',
      titulo: 'Keilor Martinez',
      subtitulo: '+506 8888-0000',
      pie: 'Escanéalo con KiramoPay para pagar',
    });
    expect(mocks.compartir).toHaveBeenCalledWith(PNG, 'kiramopay-cobro.png', 'Keilor Martinez');
  });

  it('si se compartio o se cerro el menu no queda ningun aviso', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(boton());
    await waitFor(() => expect(boton()).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    mocks.compartir.mockResolvedValue('quieto');
    await user.click(boton());
    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(boton()).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('la region de avisos no se oculta cuando esta vacia: asi el lector de pantalla la anuncia al llenarse', () => {
    pintar();
    // display:none la sacaria del arbol de accesibilidad hasta que tenga texto.
    expect(screen.getByRole('status').className).not.toContain('empty:hidden');
  });

  it('si la imagen se descargo, lo dice', async () => {
    mocks.compartir.mockResolvedValue('listo');
    const user = userEvent.setup();
    pintar();

    await user.click(boton());

    expect(await screen.findByText('Imagen descargada. Ya puedes mandarla por chat.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Imagen descargada');
  });

  it('en una version del telefono sin los plugins lo dice, no un exito falso', async () => {
    mocks.compartir.mockResolvedValue('solo_web');
    const user = userEvent.setup();
    pintar();

    await user.click(boton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta versión de la app todavía no puede compartir imágenes.',
    );
  });

  it('si la entrega falla lo dice', async () => {
    mocks.compartir.mockResolvedValue('error');
    const user = userEvent.setup();
    pintar();

    await user.click(boton());

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos preparar la imagen. Intenta de nuevo.');
  });

  it('si no se pudo dibujar la tarjeta lo dice y no entrega nada', async () => {
    mocks.dibujar.mockRejectedValue(new Error('canvas'));
    const user = userEvent.setup();
    pintar();

    await user.click(boton());

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos preparar la imagen. Intenta de nuevo.');
    expect(mocks.compartir).not.toHaveBeenCalled();
    expect(boton()).toBeEnabled();
  });

  it('si el codigo todavia no esta en pantalla lo dice y no dibuja', async () => {
    const user = userEvent.setup();
    pintar({ conQr: false });

    await user.click(boton());

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos preparar la imagen.');
    expect(mocks.dibujar).not.toHaveBeenCalled();
  });

  it('mientras prepara la imagen el boton espera y un segundo toque no empieza otra', async () => {
    let terminar: (b: Blob) => void = () => {};
    mocks.dibujar.mockReturnValue(new Promise<Blob>((r) => { terminar = r; }));
    const user = userEvent.setup();
    pintar();

    await user.click(boton());
    const ocupado = screen.getByRole('button', { name: /Cargando/ });
    expect(ocupado).toBeDisabled();
    expect(ocupado).toHaveAttribute('aria-busy', 'true');
    await user.click(ocupado);
    expect(mocks.dibujar).toHaveBeenCalledTimes(1);

    terminar(PNG);
    await waitFor(() => expect(boton()).toBeEnabled());
    expect(mocks.compartir).toHaveBeenCalledTimes(1);
  });

  it('el aviso de un intento anterior se va en cuanto se intenta de nuevo, sin esperar el resultado', async () => {
    mocks.compartir.mockResolvedValueOnce('error');
    const user = userEvent.setup();
    pintar();

    await user.click(boton());
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // El segundo intento queda en curso: el aviso viejo ya no debe verse.
    let terminar: (b: Blob) => void = () => {};
    mocks.dibujar.mockReturnValue(new Promise<Blob>((r) => { terminar = r; }));
    await user.click(boton());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    terminar(PNG);
    await waitFor(() => expect(boton()).toBeEnabled());
  });
});
