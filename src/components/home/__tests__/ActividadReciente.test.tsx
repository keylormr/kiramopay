import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { Transaction } from '@/types';
import { ActividadReciente } from '../ActividadReciente';

// La actividad del Inicio: agrupada por dia, con la cara de la persona o el
// icono 3D de la categoria, y el monto y la hora a la derecha, sin puntos medios.

const hace = (dias: number, hora = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  d.setHours(hora, 15, 0, 0);
  return d.toISOString();
};

const movimiento = (extra: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2), title: '', amount: -1000, ccy: 'CRC', date: '', type: 'debit', status: 'completed', ...extra,
});

function pintar(movimientos: Transaction[], onAbrir = vi.fn(), oculto = false) {
  render(
    <LanguageProvider>
      <ActividadReciente
        movimientos={movimientos}
        onAbrir={onAbrir}
        formatearMonto={(m) => `₡${Math.abs(m)}`}
        oculto={oculto}
      />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('ActividadReciente', () => {
  it('pone el dia una sola vez sobre sus movimientos', () => {
    pintar([
      movimiento({ title: 'Café Alma', category: 'Comida', dateISO: hace(0, 12) }),
      movimiento({ title: 'Uber', category: 'Transporte', dateISO: hace(0, 9) }),
      movimiento({ title: 'ICE', category: 'Servicios', dateISO: hace(1) }),
    ]);
    expect(screen.getAllByText('Hoy')).toHaveLength(1);
    expect(screen.getAllByText('Ayer')).toHaveLength(1);
  });

  it('una fila sin fecha en medio no repite el encabezado del dia', () => {
    pintar([
      movimiento({ title: 'Café Alma', dateISO: hace(0, 12) }),
      movimiento({ title: 'Sin fecha', date: 'Hace un rato' }),
      movimiento({ title: 'Uber', dateISO: hace(0, 9) }),
    ]);
    expect(screen.getAllByText('Hoy')).toHaveLength(1);
  });

  it('con el saldo oculto no se ven los montos ni su color', () => {
    pintar([movimiento({ title: 'Salario', amount: 250000, dateISO: hace(0) })], vi.fn(), true);
    expect(screen.queryByText(/250000/)).not.toBeInTheDocument();
    const monto = screen.getByText('Monto oculto').parentElement as HTMLElement;
    expect(monto.className).not.toMatch(/success/);
  });

  it('la cara es la persona o el icono de la categoria', () => {
    const { container } = render(
      <LanguageProvider>
        <ActividadReciente
          movimientos={[
            movimiento({ title: 'Diego Rojas', kind: 'sinpe_receive', counterparty: 'Diego Rojas', amount: 25000, dateISO: hace(0) }),
            movimiento({ title: 'Café Alma', category: 'Comida', dateISO: hace(0) }),
          ]}
          onAbrir={vi.fn()}
          formatearMonto={(m) => `₡${Math.abs(m)}`}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText('DR')).toBeInTheDocument();
    expect(container.querySelector('img[data-arte3d="comida"]')).not.toBeNull();
    // El tipo del movimiento va debajo del nombre de la persona.
    expect(screen.getByText('Transferencia SINPE recibida')).toBeInTheDocument();
  });

  it('sin puntos medios en las filas', () => {
    pintar([movimiento({ title: 'Café Alma', category: 'Comida', dateISO: hace(0) })]);
    const fila = screen.getByRole('button', { name: /Café Alma/ });
    expect(fila.textContent).not.toContain('·');
  });

  it('sin fecha de maquina, queda el texto que traia la fila', () => {
    pintar([movimiento({ title: 'Viejo', date: 'Hace 6 días' })]);
    expect(screen.getByText('Hace 6 días')).toBeInTheDocument();
  });

  it('cada fila es un boton que abre el detalle', async () => {
    const user = userEvent.setup();
    const onAbrir = vi.fn();
    const tx = movimiento({ title: 'Café Alma', dateISO: hace(0) });
    pintar([tx], onAbrir);
    await user.click(screen.getByRole('button', { name: /Café Alma/ }));
    expect(onAbrir).toHaveBeenCalledWith(tx);
  });

  it('sin movimientos, la ilustracion y que va a aparecer ahi', () => {
    const { container } = render(
      <LanguageProvider>
        <ActividadReciente movimientos={[]} onAbrir={vi.fn()} formatearMonto={String} />
      </LanguageProvider>,
    );
    expect(screen.getByText('No hay transacciones aún')).toBeInTheDocument();
    expect(container.querySelector('img[data-arte3d="sinMovimientos"]')).not.toBeNull();
  });
});
