import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import es from '@/i18n/languages/es';
import { rellenar } from '@/utils/planes';
import { CrearBilletera } from '../CrearBilletera';

// Crear no deja seguir sin demostrar que se anotaron las palabras; restaurar
// rechaza lo que no es una semilla antes de abrir una billetera vacia.
const VECTOR_CERO = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const montar = (modo: 'crear' | 'restaurar', onListo = vi.fn().mockResolvedValue(undefined)) => {
  render(<LanguageProvider><CrearBilletera modo={modo} onListo={onListo} onCancelar={vi.fn()} /></LanguageProvider>);
  return onListo;
};

beforeEach(() => localStorage.setItem('kiramopay_language', 'es'));

describe('crear la billetera propia', () => {
  it('pide marcar que las anoto y luego comprobar tres palabras', async () => {
    const onListo = montar('crear');
    const palabras = Array.from(document.querySelectorAll('ol li span:last-child')).map(n => n.textContent ?? '');
    expect(palabras).toHaveLength(12);

    const seguir = screen.getByRole('button', { name: es.continue });
    expect(seguir).toBeDisabled();
    await userEvent.click(screen.getByLabelText(es.bp_palabras_anotadas));
    await userEvent.click(seguir);

    const campos = screen.getAllByRole('textbox');
    expect(campos).toHaveLength(3);
    // Una respuesta mala no guarda.
    for (const c of campos) await userEvent.type(c, 'zzz');
    await userEvent.click(screen.getByRole('button', { name: es.bp_guardar }));
    expect(await screen.findByText(es.bp_verificar_error)).toBeInTheDocument();
    expect(onListo).not.toHaveBeenCalled();

    // Las correctas, por su numero de posicion.
    for (const c of campos) {
      const etiqueta = c.closest('label')?.textContent ?? '';
      const n = Number(etiqueta.match(/\d+/)?.[0]);
      expect(etiqueta).toContain(rellenar(es.bp_verificar_palabra, { n }));
      await userEvent.clear(c);
      await userEvent.type(c, palabras[n - 1]);
    }
    await userEvent.click(screen.getByRole('button', { name: es.bp_guardar }));
    expect(onListo).toHaveBeenCalledWith(palabras.join(' '));
  });
});

describe('restaurar la billetera propia', () => {
  it('senala la palabra que no existe', async () => {
    const onListo = montar('restaurar');
    await userEvent.type(screen.getByRole('textbox'), VECTOR_CERO.replace('about', 'abuot'));
    await userEvent.click(screen.getByRole('button', { name: es.bp_guardar }));
    expect(await screen.findByText(rellenar(es.bp_restaurar_desconocidas, { palabras: 'abuot' }))).toBeInTheDocument();
    expect(onListo).not.toHaveBeenCalled();
  });

  it('rechaza palabras validas que no cierran la suma', async () => {
    const onListo = montar('restaurar');
    await userEvent.type(screen.getByRole('textbox'), Array(12).fill('abandon').join(' '));
    await userEvent.click(screen.getByRole('button', { name: es.bp_guardar }));
    expect(await screen.findByText(es.bp_restaurar_invalida)).toBeInTheDocument();
    expect(onListo).not.toHaveBeenCalled();
  });

  it('acepta una semilla valida aunque venga con mayusculas', async () => {
    const onListo = montar('restaurar');
    await userEvent.type(screen.getByRole('textbox'), VECTOR_CERO.toUpperCase());
    await userEvent.click(screen.getByRole('button', { name: es.bp_guardar }));
    expect(onListo).toHaveBeenCalledWith(VECTOR_CERO);
  });
});
