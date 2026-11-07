import { createRef } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import {
  BarraInferior,
  BotonDelMenu,
  ID_MENU_LATERAL,
  ID_MENU_MODAL,
  MenuModal,
  NavegacionLateral,
  useAtajoDelMenu,
  useClaseDeVentana,
  type ElementoDeNavegacion,
  type PieDeNavegacion,
} from '../NavegacionAdaptable';
import { registrarCapa } from '../pilaDeCapas';
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
const PIE: PieDeNavegacion = {
  avatar: <span>KM</span>,
  titulo: 'Keilor Martinez',
  subtitulo: 'Cambiar de perfil',
  ariaLabel: 'Cambiar de perfil',
  onElegir: () => {},
};
/** El cursor del raton entra al elemento. */
const entra = (el: Element) => fireEvent.pointerEnter(el, { pointerType: 'mouse' });
const ETIQUETAS = { plegar: 'Contraer el menú', desplegar: 'Expandir el menú', abrir: 'Abrir el menú' };

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
        pie={PIE}
      />,
    );
    const nav = screen.getByRole('navigation');
    expect(nav.getAttribute('data-navegacion')).toBe('menu');
    expect(nav.getAttribute('data-plegado')).toBe('no');
    expect(nav.id).toBe(ID_MENU_LATERAL);
    expect(screen.getByText('KiramoPay')).toBeTruthy();
    expect(screen.getByText('Keilor Martinez')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cambiar de perfil' })).toBeTruthy();
    const tarjetas = screen.getByRole('button', { name: 'Tarjetas' });
    expect(tarjetas.getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'SINPE' }));
    expect(onElegir).toHaveBeenCalledWith('sinpe');
  });
});

describe('menu plegado (expandida)', () => {
  const renderPlegado = (onElegir = vi.fn()) =>
    render(
      <NavegacionLateral
        clase="expandida"
        plegado
        elementos={ELEMENTOS}
        atajos={ATAJOS}
        actual="home"
        onElegir={onElegir}
        ariaLabel="Navegación principal"
        nombreDeLaApp="KiramoPay"
        pie={PIE}
      />,
    );

  it('queda como riel de iconos: los mismos destinos, con su nombre accesible', () => {
    const onElegir = vi.fn();
    renderPlegado(onElegir);
    expect(screen.getByRole('navigation').getAttribute('data-plegado')).toBe('si');
    // Los atajos y la cuenta siguen ahi, solo sin etiqueta visible.
    for (const nombre of ['Inicio', 'SINPE', 'Perfil', 'Tarjetas', 'Cambiar de perfil']) {
      expect(screen.getByRole('button', { name: nombre })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Inicio' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Tarjetas' }));
    expect(onElegir).toHaveBeenCalledWith('cards');
  });

  it('al pasar el cursor muestra una pista con el nombre, y se va al salir', () => {
    renderPlegado();
    const sinpe = screen.getByRole('button', { name: 'SINPE' });
    entra(sinpe);
    const pista = document.querySelector('[data-pista]');
    expect(pista?.textContent).toBe('SINPE');
    // En <body>, fuera del menu: ni su overflow ni su z-index la tapan.
    expect(screen.getByRole('navigation').contains(pista)).toBe(false);
    // Solo visual: el nombre ya esta en el aria-label del boton.
    expect(pista?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.pointerLeave(sinpe);
    expect(document.querySelector('[data-pista]')).toBeNull();
  });

  it('la pista de la cuenta lleva el nombre y la accion', () => {
    renderPlegado();
    entra(screen.getByRole('button', { name: 'Cambiar de perfil' }));
    expect(document.querySelector('[data-pista]')?.textContent).toBe('Keilor MartinezCambiar de perfil');
  });

  it('Escape cierra la pista sin cerrar la pantalla de abajo (WCAG 1.4.13)', async () => {
    // Una pantalla completa abierta de verdad en la pila de capas.
    const cerrarPantalla = vi.fn();
    const pantalla = registrarCapa('pantalla', cerrarPantalla);
    renderPlegado();
    entra(screen.getByRole('button', { name: 'Perfil' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('[data-pista]')).toBeNull();
    expect(cerrarPantalla).not.toHaveBeenCalled();
    // Sin pista, el siguiente Escape si es de la pantalla.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cerrarPantalla).toHaveBeenCalledTimes(1);
    pantalla.quitar();
    await act(() => new Promise((r) => setTimeout(r, 60)));
  });

  it('con el dedo no hay pista: quedaria pegada sobre la pantalla que se abre', () => {
    renderPlegado();
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'SINPE' }), { pointerType: 'touch' });
    expect(document.querySelector('[data-pista]')).toBeNull();
  });

  it('elegir un destino quita la pista', () => {
    renderPlegado();
    const tarjetas = screen.getByRole('button', { name: 'Tarjetas' });
    entra(tarjetas);
    expect(document.querySelector('[data-pista]')).not.toBeNull();
    fireEvent.click(tarjetas);
    expect(document.querySelector('[data-pista]')).toBeNull();
  });

  it('desplegar y volver a plegar no revive la ultima pista', () => {
    const props = { clase: 'expandida' as const, elementos: ELEMENTOS, actual: 'home', onElegir: () => {}, ariaLabel: 'n', nombreDeLaApp: 'KiramoPay' };
    const { rerender } = render(<NavegacionLateral {...props} plegado />);
    entra(screen.getByRole('button', { name: 'SINPE' }));
    expect(document.querySelector('[data-pista]')).not.toBeNull();
    rerender(<NavegacionLateral {...props} plegado={false} />);
    rerender(<NavegacionLateral {...props} plegado />);
    expect(document.querySelector('[data-pista]')).toBeNull();
  });

  it('abierto no muestra pistas: la etiqueta ya se ve', () => {
    render(
      <NavegacionLateral clase="expandida" elementos={ELEMENTOS} actual="home" onElegir={() => {}} ariaLabel="n" nombreDeLaApp="KiramoPay" />,
    );
    entra(screen.getByRole('button', { name: 'SINPE' }));
    expect(document.querySelector('[data-pista]')).toBeNull();
  });

  it('en ventana mediana plegado no aplica: sigue siendo el riel con etiquetas', () => {
    render(<NavegacionLateral clase="mediana" plegado elementos={ELEMENTOS} actual="home" onElegir={() => {}} ariaLabel="n" nombreDeLaApp="KiramoPay" />);
    expect(screen.getByRole('navigation').getAttribute('data-navegacion')).toBe('riel');
  });
});

describe('BotonDelMenu', () => {
  it('en expandida pliega el menu fijo y dice que controla', () => {
    const onAlternar = vi.fn();
    const { rerender } = render(<BotonDelMenu clase="expandida" plegado={false} modalAbierto={false} onAlternar={onAlternar} etiquetas={ETIQUETAS} />);
    const boton = screen.getByRole('button', { name: 'Contraer el menú' });
    expect(boton.getAttribute('aria-expanded')).toBe('true');
    expect(boton.getAttribute('aria-controls')).toBe(ID_MENU_LATERAL);
    expect(boton.getAttribute('aria-keyshortcuts')).toBe('Control+B Meta+B');
    expect(boton.querySelector('svg')?.getAttribute('data-icono')).toBe('MenuPlegar');
    fireEvent.click(boton);
    expect(onAlternar).toHaveBeenCalledTimes(1);

    rerender(<BotonDelMenu clase="expandida" plegado modalAbierto={false} onAlternar={onAlternar} etiquetas={ETIQUETAS} />);
    const plegado = screen.getByRole('button', { name: 'Expandir el menú' });
    expect(plegado.getAttribute('aria-expanded')).toBe('false');
    expect(plegado.querySelector('svg')?.getAttribute('data-icono')).toBe('MenuDesplegar');
  });

  it('en mediana abre el cajon modal', () => {
    render(<BotonDelMenu clase="mediana" plegado={false} modalAbierto={false} onAlternar={() => {}} etiquetas={ETIQUETAS} />);
    const boton = screen.getByRole('button', { name: 'Abrir el menú' });
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    expect(boton.getAttribute('aria-controls')).toBe(ID_MENU_MODAL);
    expect(boton.getAttribute('aria-haspopup')).toBe('dialog');
  });
});

describe('useAtajoDelMenu', () => {
  it('Ctrl + B y Cmd + B alternan el menu', () => {
    const accion = vi.fn();
    renderHook(() => useAtajoDelMenu(true, accion));
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'B', metaKey: true });
    expect(accion).toHaveBeenCalledTimes(2);
  });

  it('no responde a otras combinaciones, a la tecla sostenida ni dentro de un campo', () => {
    const accion = vi.fn();
    renderHook(() => useAtajoDelMenu(true, accion));
    fireEvent.keyDown(window, { key: 'b' });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, repeat: true });
    const campo = document.createElement('input');
    document.body.appendChild(campo);
    fireEvent.keyDown(campo, { key: 'b', ctrlKey: true });
    campo.remove();
    expect(accion).not.toHaveBeenCalled();
  });

  it('con una hoja abierta no hace nada: no abre el menu detras de ella', () => {
    const accion = vi.fn();
    renderHook(() => useAtajoDelMenu(true, accion));
    const hoja = document.createElement('div');
    hoja.setAttribute('role', 'dialog');
    hoja.setAttribute('aria-modal', 'true');
    document.body.appendChild(hoja);
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(accion).not.toHaveBeenCalled();
    // El propio menu modal abierto si deja cerrarlo con el atajo.
    hoja.id = ID_MENU_MODAL;
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(accion).toHaveBeenCalledTimes(1);
    hoja.remove();
  });

  it('en telefono (sin menu lateral) no hace nada', () => {
    const accion = vi.fn();
    renderHook(() => useAtajoDelMenu(false, accion));
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(accion).not.toHaveBeenCalled();
  });
});

describe('MenuModal (mediana)', () => {
  const esperar = (ms = 10) => act(() => new Promise((r) => setTimeout(r, ms)));
  const props = (cambios: Partial<React.ComponentProps<typeof MenuModal>> = {}): React.ComponentProps<typeof MenuModal> => ({
    abierto: true,
    onCerrar: () => {},
    elementos: ELEMENTOS,
    atajos: ATAJOS,
    actual: 'sinpe',
    onElegir: () => {},
    ariaLabel: 'Navegación principal',
    nombreDeLaApp: 'KiramoPay',
    pie: PIE,
    etiquetaCerrar: 'Cerrar el menú',
    ...cambios,
  });

  it('cerrado queda montado pero inerte: aria-controls siempre apunta a algo', () => {
    const { container } = render(<MenuModal {...props({ abierto: false })} />);
    const panel = container.querySelector(`#${ID_MENU_MODAL}`)!;
    expect(panel).toBeTruthy();
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('[data-menu-modal]')?.getAttribute('data-menu-modal')).toBe('cerrado');
  });

  it('abierto es un dialogo modal con todo el menu, y el foco entra al destino actual', async () => {
    render(<MenuModal {...props()} />);
    const dialogo = screen.getByRole('dialog', { name: 'Navegación principal' });
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
    expect(dialogo.hasAttribute('inert')).toBe(false);
    for (const nombre of ['Inicio', 'SINPE', 'Perfil', 'Tarjetas', 'Cambiar de perfil', 'Cerrar el menú']) {
      expect(screen.getByRole('button', { name: nombre })).toBeTruthy();
    }
    await esperar();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'SINPE' }));
  });

  it('elegir un destino navega y cierra', () => {
    const onElegir = vi.fn();
    const onCerrar = vi.fn();
    render(<MenuModal {...props({ onElegir, onCerrar })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tarjetas' }));
    expect(onElegir).toHaveBeenCalledWith('cards');
    expect(onCerrar).toHaveBeenCalled();
  });

  it('la X, el fondo y Escape lo cierran', async () => {
    const onCerrar = vi.fn();
    const { container } = render(<MenuModal {...props({ onCerrar })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar el menú' }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('[data-menu-modal] > [aria-hidden="true"]')!);
    expect(onCerrar).toHaveBeenCalledTimes(2);
    await esperar();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(3);
  });

  it('Tab no sale del menu y al cerrar el foco vuelve al boton', async () => {
    const boton = document.createElement('button');
    document.body.appendChild(boton);
    const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
    ref.current = boton;
    const { rerender } = render(<MenuModal {...props({ devolverFocoA: ref })} />);
    await esperar();
    const cerrar = screen.getByRole('button', { name: 'Cerrar el menú' });
    const cuenta = screen.getByRole('button', { name: 'Cambiar de perfil' });
    cuenta.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cerrar);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cuenta);

    rerender(<MenuModal {...props({ abierto: false, devolverFocoA: ref })} />);
    expect(document.activeElement).toBe(boton);
    boton.remove();
  });

  it('si el destino abre una pantalla completa, el foco entra a ella y no al boton tapado', async () => {
    const boton = document.createElement('button');
    document.body.appendChild(boton);
    const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
    ref.current = boton;
    const { rerender } = render(<MenuModal {...props({ devolverFocoA: ref })} />);
    await esperar();
    const capa = document.createElement('div');
    capa.className = 'kp-capa';
    const volver = document.createElement('button');
    volver.textContent = 'Volver';
    capa.appendChild(volver);
    document.body.appendChild(capa);
    rerender(<MenuModal {...props({ abierto: false, devolverFocoA: ref })} />);
    expect(document.activeElement).toBe(volver);
    capa.remove();
    boton.remove();
  });
});
