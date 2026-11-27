import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import es from '@/i18n/languages/es';
import { rellenar } from '@/utils/planes';
import { cifrarRespaldo, descifrarRespaldo } from '@/billetera/respaldo';
import { HojaRespaldo } from '../RespaldoBilletera';
import { CrearBilletera } from '../CrearBilletera';

// El respaldo sale como archivo cifrado (nunca las palabras a la vista) y
// restaurar desde ese archivo pide la contrasena antes de abrir la billetera.
const entregar = vi.hoisted(() => vi.fn());
vi.mock('@/utils/entregarArchivo', () => ({ entregarArchivo: entregar }));

const DOCE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const CLAVE = 'una clave larga de prueba';

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  entregar.mockReset();
});

const montarHoja = () =>
  render(<LanguageProvider><HojaRespaldo semilla={DOCE} onClose={vi.fn()} /></LanguageProvider>);

async function escribirClaves(primera: string, segunda: string) {
  const campo = screen.getByLabelText(es.bp_respaldo_contrasena);
  const repetida = screen.getByLabelText(es.bp_respaldo_repetir);
  await userEvent.clear(campo);
  await userEvent.clear(repetida);
  await userEvent.type(campo, primera);
  await userEvent.type(repetida, segunda);
}

describe('guardar el respaldo en un archivo', () => {
  it('no cifra con una contrasena corta ni si las dos no coinciden', async () => {
    montarHoja();
    await escribirClaves('corta', 'corta');
    await userEvent.click(screen.getByRole('button', { name: es.bp_respaldo_crear }));
    expect(await screen.findByText(rellenar(es.bp_respaldo_corta, { n: 12 }))).toBeInTheDocument();

    await escribirClaves(CLAVE, `${CLAVE}x`);
    await userEvent.click(screen.getByRole('button', { name: es.bp_respaldo_crear }));
    expect(await screen.findByText(es.bp_respaldo_distintas)).toBeInTheDocument();
    expect(entregar).not.toHaveBeenCalled();
  });

  it('entrega un archivo cifrado que solo abre con esa contrasena', async () => {
    entregar.mockResolvedValue('compartido');
    montarHoja();
    await escribirClaves(CLAVE, CLAVE);
    await userEvent.click(screen.getByRole('button', { name: es.bp_respaldo_crear }));
    expect(await screen.findByText(es.bp_respaldo_listo, {}, { timeout: 5000 })).toBeInTheDocument();

    expect(entregar).toHaveBeenCalledTimes(1);
    const [blob, nombre] = entregar.mock.calls[0] as [Blob, string];
    expect(nombre).toMatch(/^kiramopay-respaldo-billetera-\d{4}-\d{2}-\d{2}\.json$/);
    const contenido = await new Promise<string>(resolve => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result));
      lector.readAsText(blob);
    });
    expect(contenido).not.toMatch(/abandon|about/);
    expect(await descifrarRespaldo(contenido, CLAVE)).toBe(DOCE);
    // La contrasena no queda escrita en la hoja.
    expect(screen.getByLabelText(es.bp_respaldo_contrasena)).toHaveValue('');
  });

  it('si el archivo no se pudo entregar, lo dice', async () => {
    entregar.mockResolvedValue('error');
    montarHoja();
    await escribirClaves(CLAVE, CLAVE);
    await userEvent.click(screen.getByRole('button', { name: es.bp_respaldo_crear }));
    expect(await screen.findByText(es.bp_respaldo_error, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('restaurar desde el archivo de respaldo', () => {
  const montarRestaurar = () => {
    const onListo = vi.fn().mockResolvedValue(undefined);
    render(<LanguageProvider><CrearBilletera modo="restaurar" onListo={onListo} onCancelar={vi.fn()} /></LanguageProvider>);
    return onListo;
  };

  it('rechaza un archivo que no es un respaldo', async () => {
    const onListo = montarRestaurar();
    await userEvent.upload(screen.getByTestId('respaldo-archivo'), new File(['hola'], 'notas.txt', { type: 'text/plain' }));
    expect(await screen.findByText(es.bp_restaurar_archivo_invalido)).toBeInTheDocument();
    expect(onListo).not.toHaveBeenCalled();
  });

  it('pide la contrasena y con la correcta abre la billetera', async () => {
    const onListo = montarRestaurar();
    const contenido = await cifrarRespaldo(DOCE, CLAVE, { vueltas: 100_000 });
    await userEvent.upload(
      screen.getByTestId('respaldo-archivo'),
      new File([contenido], 'kiramopay-respaldo-billetera-2026-11-27.json', { type: 'application/json' }),
    );
    expect(await screen.findByText('kiramopay-respaldo-billetera-2026-11-27.json')).toBeInTheDocument();

    const campo = screen.getByLabelText(es.bp_respaldo_contrasena);
    await userEvent.type(campo, 'otra clave larga cualquiera');
    await userEvent.click(screen.getByRole('button', { name: es.bp_restaurar_archivo_abrir }));
    expect(await screen.findByText(es.bp_restaurar_archivo_contrasena, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(onListo).not.toHaveBeenCalled();

    await userEvent.clear(campo);
    await userEvent.type(campo, CLAVE);
    await userEvent.click(screen.getByRole('button', { name: es.bp_restaurar_archivo_abrir }));
    await waitFor(() => expect(onListo).toHaveBeenCalledWith(DOCE), { timeout: 5000 });
  });
});

describe('mientras se exporta', () => {
  it('avisa que empieza y termina, y un doble toque no exporta dos veces', async () => {
    let soltar: (v: string) => void = () => undefined;
    entregar.mockImplementation(() => new Promise(r => { soltar = r; }));
    const onExportando = vi.fn();
    render(<LanguageProvider><HojaRespaldo semilla={DOCE} onClose={vi.fn()} onExportando={onExportando} /></LanguageProvider>);
    await escribirClaves(CLAVE, CLAVE);
    const boton = screen.getByRole('button', { name: es.bp_respaldo_crear });
    await userEvent.dblClick(boton);
    await waitFor(() => expect(entregar).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(onExportando).toHaveBeenCalledWith(true);
    expect(onExportando).not.toHaveBeenCalledWith(false);

    soltar('compartido');
    await waitFor(() => expect(onExportando).toHaveBeenLastCalledWith(false));
    expect(entregar).toHaveBeenCalledTimes(1);
    expect(onExportando).toHaveBeenCalledTimes(2);
  });
});
