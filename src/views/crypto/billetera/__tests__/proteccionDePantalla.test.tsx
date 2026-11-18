import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import es from '@/i18n/languages/es';
import type { EstadoDeLaProteccion } from '@/billetera/pantalla';

// Las palabras son la billetera: no se muestran ni se piden mientras la pantalla
// no esta protegida contra capturas (un binario viejo sin el plugin, o el plugin
// todavia contestando). Se prueba que no estan en el DOM, no solo que hay un aviso.
const proteccion = vi.hoisted(() => ({ estado: 'protegida' as EstadoDeLaProteccion, activa: [] as boolean[] }));
vi.mock('@/billetera/pantalla', () => ({
  usePantallaSegura: (activa: boolean) => {
    proteccion.activa.push(activa);
    return activa ? proteccion.estado : 'inactiva';
  },
}));

import { CrearBilletera } from '../CrearBilletera';
import { HojaPalabras } from '../HojasBilletera';

const SEMILLA = 'test test test test test test test test test test test junk';

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  proteccion.estado = 'protegida';
  proteccion.activa = [];
});

const montarCrear = (modo: 'crear' | 'restaurar', onCancelar = vi.fn()) => {
  render(<LanguageProvider><CrearBilletera modo={modo} onListo={vi.fn()} onCancelar={onCancelar} /></LanguageProvider>);
  return onCancelar;
};

describe('crear la billetera con la pantalla sin proteger', () => {
  it('protegida: muestra las 12 palabras', () => {
    montarCrear('crear');
    expect(document.querySelectorAll('ol li')).toHaveLength(12);
    expect(proteccion.activa).toContain(true);
  });

  it('mientras comprueba, no hay palabras en la pantalla', () => {
    proteccion.estado = 'comprobando';
    montarCrear('crear');
    expect(document.querySelectorAll('ol li')).toHaveLength(0);
    expect(screen.getByText(es.loading)).toBeInTheDocument();
  });

  it('sin proteccion, no hay palabras: pide actualizar la app y deja cancelar', async () => {
    proteccion.estado = 'sin-proteccion';
    const onCancelar = montarCrear('crear');
    expect(document.querySelectorAll('ol li')).toHaveLength(0);
    expect(screen.queryByLabelText(es.bp_palabras_anotadas)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(es.bp_pantalla_titulo);

    await userEvent.click(screen.getByRole('button', { name: es.cancel }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });

  it('restaurar tampoco pide escribir las palabras sin proteccion', () => {
    proteccion.estado = 'sin-proteccion';
    montarCrear('restaurar');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(es.bp_pantalla_cuerpo);
  });
});

describe('ver las palabras de una billetera abierta', () => {
  const montarHoja = (semilla: string | null, onClose = vi.fn()) => {
    render(<LanguageProvider><HojaPalabras semilla={semilla} onClose={onClose} /></LanguageProvider>);
    return onClose;
  };

  it('protegida: muestra las palabras', () => {
    montarHoja(SEMILLA);
    expect(screen.getByText('junk')).toBeInTheDocument();
  });

  it('sin proteccion, las palabras no estan en el DOM', async () => {
    proteccion.estado = 'sin-proteccion';
    const onClose = montarHoja(SEMILLA);
    expect(screen.queryByText('junk')).toBeNull();
    expect(screen.queryByText('test', { exact: true })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(es.bp_pantalla_titulo);

    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: es.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mientras comprueba, tampoco', () => {
    proteccion.estado = 'comprobando';
    montarHoja(SEMILLA);
    expect(screen.queryByText('junk')).toBeNull();
  });

  it('solo pide la proteccion mientras la hoja tiene palabras que mostrar', () => {
    montarHoja(null);
    expect(proteccion.activa.every(a => a === false)).toBe(true);
    expect(proteccion.activa.length).toBeGreaterThan(0);
  });
});
