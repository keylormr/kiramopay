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
  reintentar: vi.fn(),
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
  hook.reintentar.mockReset();
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
    hook.actualizacion = {
      via: 'externa',
      version: '2.8.0',
      instalada: '2.7.0',
      url: 'https://ejemplo/kiramopay.apk',
      notas: NOTAS,
    };
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
    hook.actualizacion = {
      via: 'externa',
      version: '2.8.0',
      instalada: '2.7.0',
      url: 'https://ejemplo/kiramopay.apk',
      notas: [],
    };
    app();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    expect(hook.actualizar).toHaveBeenCalledOnce();
  });
});

// ── Por dentro ───────────────────────────────────────────────────────────────
// Cuando alcanza con la capa web, la barrera baja la version nueva ella misma y
// muestra el avance: no hay boton que descargar ni APK que instalar.

describe('ActualizacionObligatoria por dentro', () => {
  it('muestra el avance y no ofrece botones mientras baja', () => {
    montar({ interna: { fase: 'descargando', recibidos: 250_000, total: 1_000_000 } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/No tienes que instalar nada/)).toBeInTheDocument();
    const barra = screen.getByRole('progressbar');
    expect(barra).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('25 %')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('dice cuanto lleva bajado', () => {
    montar({ interna: { fase: 'descargando', recibidos: 500_000, total: 2_000_000 } });
    expect(screen.getByText(/0,5 MB de 2 MB/)).toBeInTheDocument();
  });

  it('antes del primer avance no inventa un porcentaje', () => {
    montar({ interna: { fase: 'preparando', recibidos: 0, total: null } });
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('al aplicar avisa que se reinicia sola', () => {
    montar({ interna: { fase: 'aplicando', recibidos: 1_000_000, total: 1_000_000 } });
    expect(screen.getByText(/Aplicando la actualización/)).toBeInTheDocument();
  });

  it('sin conexion dice que sigue sola cuando vuelva la red', () => {
    montar({ interna: { fase: 'sin_red', recibidos: 0, total: null } });
    expect(screen.getByText(/Sin conexión/)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('si no se pudo, ofrece reintentar y sigue sin dejar pasar', async () => {
    const onReintentar = vi.fn();
    montar({ interna: { fase: 'error', recibidos: 0, total: null }, onReintentar });
    expect(screen.getByText(/No se pudo descargar la actualización/)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onReintentar).toHaveBeenCalledOnce();
  });

  it('dice que trae la version y cual esta instalada', () => {
    montar({ interna: { fase: 'descargando', recibidos: 1, total: 10 } });
    expect(screen.getByText('Qué trae la versión 2.8.0')).toBeInTheDocument();
    expect(screen.getByText('Tienes la versión 2.7.0.')).toBeInTheDocument();
  });

  it('en la barrera, la descarga interna tapa la app', () => {
    hook.actualizacion = {
      via: 'interna',
      version: '2.8.0',
      instalada: '2.7.0',
      notas: NOTAS,
      fase: 'descargando',
      recibidos: 10,
      total: 100,
    };
    render(
      <LanguageProvider>
        <BarreraDeActualizacion>
          <p>pantalla de ingreso</p>
        </BarreraDeActualizacion>
      </LanguageProvider>,
    );
    expect(screen.queryByText('pantalla de ingreso')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
  });
});
