import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { QrScannerPanel } from '../QrScannerPanel';
import { imagenDePrueba, instalarRasterDePrueba, type RegistroDeRaster } from '@/test/rasterDePrueba';

// Elegir una imagen en el escaner: el QR que llega por chat se paga desde el
// mismo telefono. El panel solo lee y entrega; juzgar el contenido es de quien
// lo recibe, igual que con la camara y con el codigo escrito a mano.

// Leer una foto de 12 MP en un runner lento tarda segundos, no milisegundos: el
// tope por defecto (5 s) haria fallar por tiempo lo que no esta roto.
vi.setConfig({ testTimeout: 30_000 });
// Lo mismo para las esperas de findBy/waitFor (1 s por defecto).
configure({ asyncUtilTimeout: 15_000 });

const KP = 'KP:merchant_dynamic:abcd1234:550000:CRC:i0123456789abcdef01234567';

let raster: RegistroDeRaster;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  raster = instalarRasterDePrueba();
});
afterEach(() => {
  raster.restaurar();
});

function pintar(onDecode: (raw: string) => boolean | void = vi.fn(), error?: string) {
  return render(
    <LanguageProvider>
      <QrScannerPanel active onDecode={onDecode} error={error} />
    </LanguageProvider>,
  );
}

const entrada = () => screen.getByTestId('qr-image-input') as HTMLInputElement;

describe('QrScannerPanel — elegir una imagen', () => {
  it('ofrece el boton y pide solo imagenes, sin abrir la camara', () => {
    pintar();

    expect(screen.getByRole('button', { name: 'Elegir una imagen' })).toBeInTheDocument();
    expect(entrada()).toHaveAttribute('type', 'file');
    expect(entrada()).toHaveAttribute('accept', 'image/*');
    // `capture` abriria la camara en vez de la galeria: justo lo contrario de lo
    // que se quiere con un QR que llego por chat.
    expect(entrada()).not.toHaveAttribute('capture');
  });

  it('el boton abre el selector de archivos', async () => {
    const user = userEvent.setup();
    pintar();
    const abrir = vi.spyOn(entrada(), 'click');

    await user.click(screen.getByRole('button', { name: 'Elegir una imagen' }));

    expect(abrir).toHaveBeenCalledTimes(1);
  });

  it('una imagen con un QR de KiramoPay se entrega tal cual al mismo onDecode', async () => {
    const user = userEvent.setup();
    const onDecode = vi.fn();
    pintar(onDecode);

    await user.upload(entrada(), imagenDePrueba('captura-chat.png'));

    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(1));
    expect(onDecode).toHaveBeenCalledWith(KP);
  });

  it('una imagen sin QR lo dice y no entrega nada', async () => {
    const user = userEvent.setup();
    const onDecode = vi.fn();
    pintar(onDecode);

    await user.upload(entrada(), imagenDePrueba('sin-qr.png'));

    expect(await screen.findByText(/No encontramos un código QR en esa imagen/)).toBeInTheDocument();
    expect(onDecode).not.toHaveBeenCalled();
  });

  it('un archivo que no se puede leer lo dice con otro mensaje', async () => {
    const user = userEvent.setup();
    const onDecode = vi.fn();
    pintar(onDecode);

    // Llega con nombre y tipo de imagen y no lo es (un archivo dañado, o uno
    // que el WebView entrega con el tipo equivocado).
    const falso = new File(['no soy una imagen'], 'qr.png', { type: 'image/png' });
    await user.upload(entrada(), falso);

    expect(await screen.findByText(/No pudimos abrir ese archivo/)).toBeInTheDocument();
    expect(screen.queryByText(/No encontramos un código QR/)).not.toBeInTheDocument();
    expect(onDecode).not.toHaveBeenCalled();
  });

  it('un QR de otra cosa llega a onDecode: juzgarlo es del flujo, no del lector', async () => {
    const user = userEvent.setup();
    const onDecode = vi.fn();
    pintar(onDecode);

    await user.upload(entrada(), imagenDePrueba('qr-ajeno.png'));

    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('https://example.com/promo?ref=chat-2026'));
  });

  it('el aviso de un error se va al elegir otra imagen', async () => {
    const user = userEvent.setup();
    const onDecode = vi.fn();
    pintar(onDecode);

    await user.upload(entrada(), imagenDePrueba('sin-qr.png'));
    await screen.findByText(/No encontramos un código QR/);

    await user.upload(entrada(), imagenDePrueba('qr-kiramo.png'));

    await waitFor(() => expect(onDecode).toHaveBeenCalledWith(KP));
    expect(screen.queryByText(/No encontramos un código QR/)).not.toBeInTheDocument();
  });

  it('se puede elegir DOS veces la misma imagen: la segunda tambien se lee', async () => {
    // Sin vaciar el input, el navegador no dispara change con el mismo archivo.
    const user = userEvent.setup();
    const onDecode = vi.fn();
    pintar(onDecode);
    const imagen = imagenDePrueba('qr-kiramo.png');

    await user.upload(entrada(), imagen);
    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(1));
    await user.upload(entrada(), imagen);

    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(2));
  });

  it('si el flujo rechaza lo leido (false), el panel no agrega su propio error', async () => {
    const user = userEvent.setup();
    const onDecode = vi.fn(() => false as const);
    pintar(onDecode, 'Ese es tu propio código.');

    await user.upload(entrada(), imagenDePrueba('qr-kiramo.png'));

    await waitFor(() => expect(onDecode).toHaveBeenCalled());
    expect(screen.getByText('Ese es tu propio código.')).toBeInTheDocument();
    expect(screen.queryByText(/No encontramos un código QR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No pudimos abrir ese archivo/)).not.toBeInTheDocument();
  });

  it('un error de lectura reciente tapa al aviso viejo del flujo, no se muestran los dos', async () => {
    const user = userEvent.setup();
    pintar(vi.fn(), 'Ese es tu propio código.');

    await user.upload(entrada(), imagenDePrueba('sin-qr.png'));

    expect(await screen.findByText(/No encontramos un código QR/)).toBeInTheDocument();
    expect(screen.queryByText('Ese es tu propio código.')).not.toBeInTheDocument();
  });

  // La lectura ya empezo cuando la region de estado dice que se esta leyendo.
  async function esperarQueEmpieceLaLectura() {
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Leyendo la imagen...'));
  }

  // Una lectura tarda y la hoja se puede cerrar mientras tanto. Entregar el
  // resultado despues abriria una hoja de pago que nadie pidio. La lectura se
  // RETIENE con una compuerta hasta que la hoja ya se cerro: sin ella, el
  // orden dependia de cuanto tardara la maquina y la prueba fallaba bajo carga.
  async function esperarQueTermineLaLectura() {
    const margen = { timeout: 15_000 };
    await waitFor(() => expect(raster.lecturas.length).toBeGreaterThan(0), margen);
    await waitFor(() => expect(raster.bitmapsAbiertos()).toBe(0), margen);
    await new Promise((r) => setTimeout(r, 30));
  }

  it('cerrar la hoja mientras se lee no entrega nada despues', async () => {
    const user = userEvent.setup();
    const onDecode = vi.fn();
    const soltar = raster.retener();
    const { unmount } = pintar(onDecode);

    const subida = user.upload(entrada(), imagenDePrueba('qr-kiramo.png'));
    await esperarQueEmpieceLaLectura();
    unmount();
    soltar();
    await subida;
    await esperarQueTermineLaLectura();

    expect(onDecode).not.toHaveBeenCalled();
  });

  it('una hoja que sigue montada pero ya no esta activa tampoco recibe el resultado', async () => {
    const user = userEvent.setup();
    const onDecode = vi.fn();
    const soltar = raster.retener();
    const { rerender } = pintar(onDecode);

    const subida = user.upload(entrada(), imagenDePrueba('qr-kiramo.png'));
    await esperarQueEmpieceLaLectura();
    rerender(
      <LanguageProvider>
        <QrScannerPanel active={false} onDecode={onDecode} />
      </LanguageProvider>,
    );
    soltar();
    await subida;
    await esperarQueTermineLaLectura();

    expect(onDecode).not.toHaveBeenCalled();
    // Y el panel no se queda pegado en "leyendo".
    await waitFor(() => expect(screen.queryByText('Leyendo la imagen...')).not.toBeInTheDocument());
  });

  it('tras una lectura larga entrega al onDecode MAS RECIENTE, no al del momento de elegir', async () => {
    // El flujo que recibe el codigo lee estado de su vista (contactos, el propio
    // numero). Si el panel se quedara con el callback viejo, validaria con datos
    // de hace varios segundos.
    const user = userEvent.setup();
    const viejo = vi.fn();
    const nuevo = vi.fn();
    const soltar = raster.retener();
    const { rerender } = pintar(viejo);

    const subida = user.upload(entrada(), imagenDePrueba('qr-kiramo.png'));
    await esperarQueEmpieceLaLectura();
    rerender(
      <LanguageProvider>
        <QrScannerPanel active onDecode={nuevo} />
      </LanguageProvider>,
    );
    soltar();
    await subida;

    await waitFor(() => expect(nuevo).toHaveBeenCalledWith(KP));
    expect(viejo).not.toHaveBeenCalled();
  });

  // Un lector de pantalla solo anuncia un cambio en una region que YA estaba:
  // una region que nace con el texto adentro suele quedar muda.
  it('el aviso de error y el de lectura viven en regiones que existen desde antes', async () => {
    const user = userEvent.setup();
    const soltar = raster.retener();
    pintar();
    const avisos = screen.getByTestId('qr-aviso');
    const lectura = screen.getByRole('status');
    expect(avisos).toHaveAttribute('aria-live', 'polite');
    expect(lectura).toBeEmptyDOMElement();

    const subida = user.upload(entrada(), imagenDePrueba('sin-qr.png'));
    await waitFor(() => expect(lectura).toHaveTextContent('Leyendo la imagen...'));
    soltar();
    await subida;

    await waitFor(() => expect(within(avisos).getByText(/No encontramos un código QR/)).toBeInTheDocument());
    expect(lectura).toBeEmptyDOMElement();
  });
});
