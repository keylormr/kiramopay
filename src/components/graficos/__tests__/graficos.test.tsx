import { fireEvent, render, screen, within } from '@testing-library/react';
import { GraficoFlujo, type TramoFlujo } from '../GraficoFlujo';
import { GraficoDonaCategorias } from '../GraficoDonaCategorias';
import { GraficoComparacion } from '../GraficoComparacion';

const formato = (n: number) => `C${n}`;
const rotulos = { ingresos: 'Ingresos', gastos: 'Gastos', neto: 'Neto', tabla: 'Tabla del flujo', ayuda: 'Usa las flechas' };

const tramos: TramoFlujo[] = [
  { clave: 'a', etiqueta: '1', etiquetaLarga: 'Lunes 1', ingresos: 500, gastos: 0 },
  { clave: 'b', etiqueta: '2', etiquetaLarga: 'Martes 2', ingresos: 0, gastos: 120 },
  { clave: 'c', etiqueta: '3', etiquetaLarga: 'Miercoles 3', ingresos: 0, gastos: 0.01 },
];

// jsdom no mide nada: se le da un ancho para que el grafico se dibuje.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 320, height: 220, top: 0, left: 0, right: 320, bottom: 220, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

describe('GraficoFlujo', () => {
  it('dibuja una barra por monto, incluido uno minusculo, y nada para los ceros', () => {
    const { container } = render(<GraficoFlujo tramos={tramos} formatoEje={formato} formatoMonto={formato} rotulos={rotulos} />);
    const barras = container.querySelectorAll('.kp-crecer-barras path');
    expect(barras).toHaveLength(3);
    for (const b of barras) expect(b.getAttribute('d')).toMatch(/^M/);
  });

  // Cada valor se puede leer sin tocar el grafico.
  it('trae la tabla con todos los valores', () => {
    render(<GraficoFlujo tramos={tramos} formatoEje={formato} formatoMonto={formato} rotulos={rotulos} />);
    const tabla = screen.getByRole('table', { name: 'Tabla del flujo' });
    expect(within(tabla).getAllByRole('row')).toHaveLength(4);
    expect(within(tabla).getByRole('rowheader', { name: 'Martes 2' })).toBeInTheDocument();
  });

  it('se recorre con las flechas y Escape cierra la lectura', () => {
    render(<GraficoFlujo tramos={tramos} formatoEje={formato} formatoMonto={formato} rotulos={rotulos} />);
    const grafico = screen.getByRole('group', { name: 'Tabla del flujo' });
    expect(grafico).toHaveAccessibleDescription('Usa las flechas');

    fireEvent.keyDown(grafico, { key: 'ArrowRight' });
    expect(screen.getByText('Lunes 1', { selector: 'p' })).toBeInTheDocument();
    fireEvent.keyDown(grafico, { key: 'ArrowRight' });
    expect(screen.getByText('Martes 2', { selector: 'p' })).toBeInTheDocument();
    // Neto de un dia solo con gastos: negativo.
    expect(screen.getByText('-C120')).toBeInTheDocument();

    fireEvent.keyDown(grafico, { key: 'Escape' });
    expect(screen.queryByText('-C120')).not.toBeInTheDocument();
  });
});

describe('GraficoDonaCategorias', () => {
  const porciones = [
    { categoria: 'shopping', nombre: 'Compras', monto: 300, porcentaje: 75 },
    { categoria: 'services', nombre: 'Servicios', monto: 100, porcentaje: 25 },
  ];

  it('dibuja una porcion por categoria y describe el reparto', () => {
    const { container } = render(
      <GraficoDonaCategorias porciones={porciones} formatoMonto={formato} etiquetaAccesible="Gastos: Compras 75%, Servicios 25%">
        <p>Total</p>
      </GraficoDonaCategorias>,
    );
    expect(screen.getByRole('img', { name: 'Gastos: Compras 75%, Servicios 25%' })).toBeInTheDocument();
    expect(container.querySelectorAll('path')).toHaveLength(2);
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('al tocar una porcion el centro dice cual es', () => {
    const { container } = render(
      <GraficoDonaCategorias porciones={porciones} formatoMonto={formato} etiquetaAccesible="x">
        <p>Total</p>
      </GraficoDonaCategorias>,
    );
    fireEvent.pointerDown(container.querySelectorAll('path')[1], { pointerType: 'touch' });
    expect(screen.getByText('Servicios')).toBeInTheDocument();
    expect(screen.getByText('C100')).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });

  it('una sola categoria es un anillo entero', () => {
    const { container } = render(
      <GraficoDonaCategorias porciones={[porciones[0]]} formatoMonto={formato} etiquetaAccesible="x" />,
    );
    const d = container.querySelector('path')!.getAttribute('d')!;
    // Dos circulos (exterior e interior), no un sector de 360 grados que no se dibuja.
    expect(d.match(/M/g)).toHaveLength(2);
  });
});

describe('GraficoComparacion', () => {
  it('escribe los dos montos junto a sus barras', () => {
    render(
      <GraficoComparacion
        actual={80}
        anterior={0}
        maximo={100}
        color="red"
        rotulos={{ actual: 'Este periodo', anterior: 'Anterior' }}
        formato={formato}
      />,
    );
    expect(screen.getByText('Este periodo')).toBeInTheDocument();
    expect(screen.getByText('C80')).toBeInTheDocument();
    expect(screen.getByText('C0')).toBeInTheDocument();
  });
});
