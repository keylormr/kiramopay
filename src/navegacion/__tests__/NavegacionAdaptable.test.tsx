import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import {
  BarraInferior,
  NavegacionLateral,
  useClaseDeVentana,
  type ElementoDeNavegacion,
} from '../NavegacionAdaptable';
import { IconosLinea } from '@/components/Icons';

// La navegacion sigue las clases de tamano de Material 3: barra inferior bajo
// 600 px, riel de 600 a 839 y menu lateral fijo desde 840. En tablet y
// escritorio la app era el telefono estirado.

type Oyente = () => void;

/** matchMedia de mentira con un ancho de ventana que la prueba puede cambiar. */
function simularVentana(anchoInicial: number) {
  let ancho = anchoInicial;
  const oyentes = new Set<Oyente>();
  const original = window.matchMedia;
  window.matchMedia = ((consulta: string) => {
    const minimo = Number(/min-width:\s*(\d+)px/.exec(consulta)?.[1] ?? 0);
    return {
      get matches() {
        return ancho >= minimo;
      },
      media: consulta,
      addEventListener: (_: string, fn: Oyente) => oyentes.add(fn),
      removeEventListener: (_: string, fn: Oyente) => oyentes.delete(fn),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    cambiarA(nuevo: number) {
      ancho = nuevo;
      oyentes.forEach((fn) => fn());
    },
    oyentes,
    restaurar() {
      window.matchMedia = original;
    },
  };
}

const ELEMENTOS: ElementoDeNavegacion[] = [
  { id: 'home', Icono: IconosLinea.Inicio, etiqueta: 'Inicio' },
  { id: 'sinpe', Icono: IconosLinea.Sinpe, etiqueta: 'SINPE' },
  { id: 'profile', Icono: IconosLinea.Perfil, etiqueta: 'Perfil' },
];
const ATAJOS: ElementoDeNavegacion[] = [{ id: 'cards', Icono: IconosLinea.Tarjeta, etiqueta: 'Tarjetas' }];

describe('useClaseDeVentana', () => {
  it.each([
    [390, 'compacta'],
    [599, 'compacta'],
    [600, 'mediana'],
    [690, 'mediana'],
    [839, 'mediana'],
    [840, 'expandida'],
    [1280, 'expandida'],
  ])('a %i px es %s', (ancho, esperada) => {
    const ventana = simularVentana(ancho);
    const { result } = renderHook(() => useClaseDeVentana());
    expect(result.current).toBe(esperada);
    ventana.restaurar();
  });

  it('cambia al girar o desplegar, y deja de escuchar al desmontar', () => {
    const ventana = simularVentana(344);
    const { result, unmount } = renderHook(() => useClaseDeVentana());
    expect(result.current).toBe('compacta');
    act(() => ventana.cambiarA(690));
    expect(result.current).toBe('mediana');
    act(() => ventana.cambiarA(1180));
    expect(result.current).toBe('expandida');
    unmount();
    expect(ventana.oyentes.size).toBe(0);
    ventana.restaurar();
  });

  it('sin matchMedia (WebView raro, jsdom) cae en telefono', () => {
    const original = window.matchMedia;
    // @ts-expect-error se quita a proposito
    delete window.matchMedia;
    const { result } = renderHook(() => useClaseDeVentana());
    expect(result.current).toBe('compacta');
    window.matchMedia = original;
  });
});

describe('BarraInferior', () => {
  it('marca la pestana activa y avisa la que se elige', () => {
    const onElegir = vi.fn();
    render(<BarraInferior elementos={ELEMENTOS} actual="sinpe" onElegir={onElegir} ariaLabel="Navegación principal" />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(nav.getAttribute('data-navegacion')).toBe('barra');
    expect(screen.getByRole('button', { name: 'SINPE' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Inicio' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Perfil' }));
    expect(onElegir).toHaveBeenCalledWith('profile');
  });

  it('los iconos son de linea, no emojis ni texto', () => {
    const { container } = render(<BarraInferior elementos={ELEMENTOS} actual="home" onElegir={() => {}} ariaLabel="n" />);
    expect(container.querySelectorAll('svg[data-icono]')).toHaveLength(ELEMENTOS.length);
    expect(container.textContent).toBe('InicioSINPEPerfil');
  });
});

describe('NavegacionLateral', () => {
  it('en ventana mediana es un riel: sin atajos ni nombre de la app', () => {
    render(
      <NavegacionLateral
        clase="mediana"
        elementos={ELEMENTOS}
        atajos={ATAJOS}
        actual="home"
        onElegir={() => {}}
        ariaLabel="Navegación principal"
        nombreDeLaApp="KiramoPay"
      />,
    );
    const nav = screen.getByRole('navigation');
    expect(nav.getAttribute('data-navegacion')).toBe('riel');
    expect(screen.queryByRole('button', { name: 'Tarjetas' })).toBeNull();
    expect(screen.queryByText('KiramoPay')).toBeNull();
    expect(screen.getByRole('button', { name: 'Inicio' }).getAttribute('aria-current')).toBe('page');
  });

  it('en ventana expandida es el menu fijo, con los atajos y el pie', () => {
    const onElegir = vi.fn();
    render(
      <NavegacionLateral
        clase="expandida"
        elementos={ELEMENTOS}
        atajos={ATAJOS}
        actual="cards"
        onElegir={onElegir}
        ariaLabel="Navegación principal"
        nombreDeLaApp="KiramoPay"
        pie={<span>Keilor</span>}
      />,
    );
    expect(screen.getByRole('navigation').getAttribute('data-navegacion')).toBe('menu');
    expect(screen.getByText('KiramoPay')).toBeTruthy();
    expect(screen.getByText('Keilor')).toBeTruthy();
    const tarjetas = screen.getByRole('button', { name: 'Tarjetas' });
    expect(tarjetas.getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'SINPE' }));
    expect(onElegir).toHaveBeenCalledWith('sinpe');
  });
});
