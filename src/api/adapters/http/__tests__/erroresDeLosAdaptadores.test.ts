import type { HttpClient } from '../client';
import es from '@/i18n/languages/es';
import fr from '@/i18n/languages/fr';
import { fijarDiccionarioActivo } from '@/i18n/mensajesDeError';

// Los adaptadores armaban su error a mano y perdian algo de dos maneras:
//  - con un codigo fijo ('FETCH_FAILED', 'TOTP_CONFIRM_FAILED'...) que pisaba el
//    que trajo el cliente: un 429 o la falta de red llegaban a la pantalla como
//    un fallo cualquiera, y la pantalla no podia decir si esperar sirve o si
//    hay que revisar la conexion;
//  - con un texto fijo en ingles ('Failed to fetch cards', 'Could not load
//    payouts') que se pintaba tal cual con la app en frances o en espanol.
//
// Arreglarlo metodo por metodo dejaba siempre alguno afuera (eran 176 sitios en
// 26 archivos), asi que esta prueba recorre TODOS los metodos de TODOS los
// adaptadores, sin escribir a mano los argumentos de cada uno.

const modulos = import.meta.glob('../*.http.ts', { eager: true }) as Record<string, Record<string, unknown>>;

type Repo = Record<string, (...args: unknown[]) => unknown>;
type Respuesta = { success?: boolean; error?: { code?: string; message?: string; details?: unknown } } | undefined;

// Un argumento que sirve para cualquier firma: cualquier propiedad, llamada o
// conversion a numero o a texto devuelve algo usable.
function comodin(): unknown {
  const destino = function () {};
  const p: unknown = new Proxy(destino, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return (pista: string) => (pista === 'number' ? 1 : 'x');
      if (prop === 'then') return undefined;
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'length') return 0;
      return p;
    },
    apply() {
      return p;
    },
  });
  return p;
}

// Un cliente HTTP falso: cualquier metodo (get, post, del, la descarga...)
// devuelve la misma respuesta y anota que lo llamaron.
function clienteQueResponde(respuesta: unknown): { cliente: HttpClient; llamadas: () => number } {
  let n = 0;
  const cliente = new Proxy(
    {},
    {
      get() {
        return async () => {
          n++;
          return respuesta;
        };
      },
    },
  ) as unknown as HttpClient;
  return { cliente, llamadas: () => n };
}

interface Caso {
  nombre: string;
  llamar: (cliente: HttpClient) => Promise<Respuesta>;
}

const casos: Caso[] = [];
for (const [ruta, exportados] of Object.entries(modulos)) {
  for (const [clase, valor] of Object.entries(exportados)) {
    if (!clase.startsWith('Http') || typeof valor !== 'function') continue;
    const Clase = valor as new (c: HttpClient) => Repo;
    const proto = Clase.prototype as Record<string, unknown>;
    for (const metodo of Object.getOwnPropertyNames(proto)) {
      if (metodo === 'constructor' || typeof proto[metodo] !== 'function') continue;
      casos.push({
        nombre: `${ruta.replace('../', '')} ${clase}.${metodo}`,
        llamar: async (cliente) => {
          const repo = new Clase(cliente);
          return (await repo[metodo](comodin(), comodin(), comodin(), comodin())) as Respuesta;
        },
      });
    }
  }
}

// Lo que no se pudo recorrer y lo que si llego a fallar: sin esto, un comodin
// que dejara de servir haria pasar la prueba sin mirar nada.
const lanzaron: string[] = [];
let fallasVistas = 0;

const textosDelDiccionario = new Set(Object.values(fr as unknown as Record<string, string>));

describe('el error de cada adaptador', () => {
  beforeAll(() => fijarDiccionarioActivo(fr));
  afterAll(() => fijarDiccionarioActivo(es));

  it('la prueba encuentra los adaptadores (si no, no probaria nada)', () => {
    expect(Object.keys(modulos).length).toBeGreaterThanOrEqual(26);
    expect(casos.length).toBeGreaterThan(200);
  });

  it.each(casos.map((c) => [c.nombre, c] as const))(
    '%s deja pasar el codigo, el texto y el detalle que trajo el cliente',
    async (_nombre, caso) => {
      const detalle = { tope: 3 };
      const { cliente, llamadas } = clienteQueResponde({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'texto que trajo el cliente', details: detalle },
      });
      let res: Respuesta;
      try {
        res = await caso.llamar(cliente);
      } catch {
        lanzaron.push(caso.nombre);
        return;
      }
      if (!res || res.success !== false) return;
      fallasVistas++;
      if (llamadas() > 0) {
        expect(res.error?.code).toBe('RATE_LIMITED');
        expect(res.error?.message).toBe('texto que trajo el cliente');
        expect(res.error?.details).toEqual(detalle);
      } else {
        // No hubo llamada: el error nace en el adaptador y su texto sale del
        // diccionario del idioma activo, nunca escrito a mano.
        expect(textosDelDiccionario.has(res.error?.message ?? '')).toBe(true);
      }
    },
  );

  it.each(casos.map((c) => [c.nombre, c] as const))(
    '%s, ante una respuesta vacia, habla en el idioma de la app',
    async (_nombre, caso) => {
      const { cliente } = clienteQueResponde({ success: true, data: undefined });
      let res: Respuesta;
      try {
        res = await caso.llamar(cliente);
      } catch {
        return;
      }
      if (!res || res.success !== false) return;
      expect(res.error?.code).toBeTruthy();
      expect(textosDelDiccionario.has(res.error?.message ?? '')).toBe(true);
    },
  );

  it('el recorrido miro de verdad', () => {
    expect(lanzaron).toEqual([]);
    expect(fallasVistas).toBeGreaterThan(150);
  });
});
