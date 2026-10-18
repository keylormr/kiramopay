import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ActualizacionObligatoria, BarreraDeActualizacion } from '../ActualizacionObligatoria';
import type { ActualizacionDisponible } from '../../hooks/useActualizacion';

// Toda version nueva es obligatoria. Antes era una hoja con "Despues" que se
// cerraba y dejaba seguir usando la aplicacion vieja, y aparecia recien dentro
// de la app, despues del login. Ahora es una barrera que tapa todo, el login
// incluido, y dice que trae la version nueva.

const hook = vi.hoisted(() => ({
  actualizacion: null as ActualizacionDisponible | null,
  plataforma: 'android' as 'android' | 'ios' | null,
  actualizar: vi.fn(),
}));
vi.mock('../../hooks/useActualizacion', () => ({ useActualizacion: () => hook }));

const NOTAS = ['Pagar con QR es mas rapido', 'Tus metas de ahorro muestran el avance'];

function montar(props: Partial<React.ComponentProps<typeof ActualizacionObligatoria>> = {}) {
  const onActualizar = vi.fn();
  render(
    <LanguageProvider>
      <ActualizacionObligatoria
        version="2.8.0"
        instalada="2.7.0"
        notas={NOTAS}
        plataforma="android"
        onActualizar={onActualizar}
        {...props}
      />
    </LanguageProvider>,
  );
  return onActualizar;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  hook.actualizacion = null;
  hook.plataforma = 'android';
  hook.actualizar.mockReset();
});

describe('ActualizacionObligatoria', () => {
  it('es una barrera: el unico boton es el de actualizar', () => {
    montar();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText(/después|más tarde/i)).toBeNull();
  });

  it('dice que hay que actualizar para seguir y que trae la version', () => {
    montar();
    expect(screen.getByText(/Para seguir usando KiramoPay/)).toBeInTheDocument();
    expect(screen.getByText('Qué trae la versión 2.8.0')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(NOTAS);
  });

  // Si la instalacion falla, con esto la persona sabe que pedir.
  it('dice que version tiene instalada', () => {
    montar();
    expect(screen.getByText('Tienes la versión 2.7.0.')).toBeInTheDocument();
  });

  it('sin novedades no pinta una lista vacia', () => {
    montar({ notas: [] });
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/Qué trae/)).toBeNull();
    // La version se dice igual, en el texto principal.
    expect(screen.getByText(/2\.8\.0/)).toBeInTheDocument();
  });

  it('en Android el boton descarga la version nueva', async () => {
    const onActualizar = montar();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    expect(onActualizar).toHaveBeenCalledOnce();
  });

  it('en iOS el boton lleva a donde se instala', async () => {
    const onActualizar = montar({ plataforma: 'ios' });
    expect(screen.getByText(/te llevamos/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(onActualizar).toHaveBeenCalledOnce();
  });

  // Los idiomas distintos del espanol se cargan aparte: hay que esperarlos.
  it('habla el idioma de la persona', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    montar();
    expect(await screen.findByText("What's new in version 2.8.0")).toBeInTheDocument();
  });
});

describe('BarreraDeActualizacion', () => {
  function app() {
    render(
      <LanguageProvider>
        <BarreraDeActualizacion>
          <p>pantalla de ingreso</p>
        </BarreraDeActualizacion>
      </LanguageProvider>,
    );
  }

  it('con una version nueva no deja ver la app, ni siquiera el login', () => {
    hook.actualizacion = { version: '2.8.0', instalada: '2.7.0', url: 'https://ejemplo/kiramopay.apk', notas: NOTAS };
    app();
    expect(screen.queryByText('pantalla de ingreso')).toBeNull();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('sin version nueva la app sigue como siempre', () => {
    app();
    expect(screen.getByText('pantalla de ingreso')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('el boton actualiza con la plataforma que corresponde', async () => {
    hook.actualizacion = { version: '2.8.0', instalada: '2.7.0', url: 'https://ejemplo/kiramopay.apk', notas: [] };
    app();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    expect(hook.actualizar).toHaveBeenCalledOnce();
  });
});
