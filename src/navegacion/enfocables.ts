/**
 * Controles que reciben foco con Tab dentro de un contenedor: lo usan las hojas
 * (BottomSheet) y el menu modal para atrapar el foco mientras estan abiertos.
 */
const ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

export function enfocablesDentro(contenedor: HTMLElement): HTMLElement[] {
  return Array.from(contenedor.querySelectorAll<HTMLElement>(ENFOCABLES)).filter((el) => {
    if (el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    // checkVisibility no existe en todos los motores (jsdom): ahi cuenta como visible.
    const conVisibilidad = el as HTMLElement & { checkVisibility?: () => boolean };
    return typeof conVisibilidad.checkVisibility === 'function' ? conVisibilidad.checkVisibility() : true;
  });
}
