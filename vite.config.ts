import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// La versión que muestra "Acerca de" sale de package.json, no de una constante
// escrita a mano que envejece en silencio.
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
) as { version: string };

// El commit lo aporta la plataforma que compila. En local se lee de git; si no
// hay git —el build de Dockerfile.frontend excluye .git— queda 'local'.
function resolveBuildSha(env: Record<string, string>): string {
  const fromCi = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
}

// Deja en dist/version.json la version y el commit del build. La aplicacion
// corriendo lo consulta para saber si sigue siendo la desplegada: es el unico
// dato que distingue "esta al dia" de "quedo vieja en una pestana abierta o en
// una cache intermedia". No va en public/ porque tiene que reflejar EL build,
// no un archivo escrito a mano.
function emitirVersion(version: string, sha: string) {
  return {
    name: 'kiramopay-version-json',
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version, sha, builtAt: new Date().toISOString() }),
      });
    },
  };
}

// viem no cabe en un bloque: pesa unos 245 KB minificado y el tope del CI es
// 200 KB. Se parte en dos, y el corte tiene que dejar las importaciones en un
// solo sentido. Si cada mitad importa algo de la otra, el navegador ejecuta una
// antes de que la otra termine, y una clase o constante que la primera usa al
// cargar todavia no existe. Paso con el corte anterior por la carpeta
// viem/_esm/actions: las acciones usan utils/ y errors/ del otro bloque, y ese
// otro bloque (el indice, los clientes, utils/ccip, el avatar de ENS) usa
// acciones. Mi billetera caia con "Cannot access 'mt' before initialization"
// en el build de produccion; en modo dev no hay bloques y no pasa.
//
// Por eso el corte no sale de una carpeta sino del grafo: `billetera-evm` lleva
// las acciones, los clientes y todo modulo de viem que llegue a ellos por
// imports estaticos; `billetera-evm-base` lleva el resto (utils, errors,
// constants, accounts, chains), que por construccion nunca importa de
// `billetera-evm`, aunque una version nueva de viem cambie sus imports. Los
// import() dinamicos no cuentan: corren cuando todo ya cargo.
interface GrafoDeModulos {
  getModuleIds: () => IterableIterator<string>;
  getModuleInfo: (id: string) => { importedIds: readonly string[] } | null;
}

const VIEM = /node_modules\/viem\//;
const VIEM_DE_ARRIBA = /node_modules\/viem\/_esm\/(actions|clients)\//;
// Rollup pasa el mismo grafo a cada llamada de un build: se calcula una vez.
const viemDeArribaPorBuild = new WeakMap<GrafoDeModulos, Set<string>>();

function viemDeArriba(grafo: GrafoDeModulos): Set<string> {
  const quienLoImporta = new Map<string, string[]>();
  const arriba = new Set<string>();
  for (const id of grafo.getModuleIds()) {
    if (!VIEM.test(id)) continue;
    if (VIEM_DE_ARRIBA.test(id)) arriba.add(id);
    for (const dep of grafo.getModuleInfo(id)?.importedIds ?? []) {
      const lista = quienLoImporta.get(dep) ?? [];
      lista.push(id);
      quienLoImporta.set(dep, lista);
    }
  }
  const pendientes = [...arriba];
  while (pendientes.length > 0) {
    for (const quien of quienLoImporta.get(pendientes.pop()!) ?? []) {
      if (!arriba.has(quien)) {
        arriba.add(quien);
        pendientes.push(quien);
      }
    }
  }
  return arriba;
}

function bloqueDeViem(id: string, grafo: GrafoDeModulos): string {
  let arriba = viemDeArribaPorBuild.get(grafo);
  if (!arriba) {
    arriba = viemDeArriba(grafo);
    viemDeArribaPorBuild.set(grafo, arriba);
  }
  return arriba.has(id) ? 'billetera-evm' : 'billetera-evm-base';
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 9999,
        host: '0.0.0.0',
      },
      preview: {
        port: 9999,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss(), emitirVersion(pkg.version, resolveBuildSha(env))],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        __APP_VERSION__: JSON.stringify(pkg.version),
        __BUILD_SHA__: JSON.stringify(resolveBuildSha(env)),
        __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        }
      },
      build: {
        chunkSizeWarningLimit: 200,
        // Las fuentes salen siempre como archivo, nunca incrustadas en el CSS:
        // el CSP de nginx.conf permite `font-src 'self'` y no `data:`, y la del
        // colon (1,6 KB) quedaba bajo el limite de 4 KB de Vite. El resto de
        // los archivos sigue la regla de siempre (undefined = la de Vite).
        // El arte 3D (.webp) tampoco: la version de 64 px pesa 2-3 KB y Vite la
        // metia en base64 dentro del JavaScript del Inicio, que la bajaba
        // aunque la pantalla pidiera la de 128.
        // (La Trama de Ergane, src/ergane/trama.svg, tampoco se incrusta: lo
        // pide el propio import con `?url&no-inline`, que vale tambien en las
        // pruebas, donde esta regla no corre.)
        assetsInlineLimit: (archivo: string) =>
          archivo.endsWith('.woff2') || archivo.endsWith('.webp') ? false : undefined,
        rollupOptions: {
          output: {
            manualChunks(id, grafo) {
              if (id.includes('node_modules/react-dom')) return 'vendor-react';
              if (id.includes('node_modules/react/')) return 'vendor-react';
              if (id.includes('node_modules/zustand')) return 'vendor-zustand';
              if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
              if (id.includes('node_modules/qrcode.react')) return 'vendor-qr';
              if (id.includes('/i18n/translations')) return 'i18n';
              if (id.includes('/adapters/mock/')) return 'mock-adapters';
              if (id.includes('/stores/') && !id.includes('__tests__')) return 'app-stores';
              // La billetera propia firma en el telefono: viem y las curvas
              // pesan. En bloques aparte (el tope por bloque es 200 KB) que solo
              // se bajan al abrir Mi billetera; nada mas de la app los importa.
              if (/node_modules\/(ox|abitype)\//.test(id)) return 'billetera-ox';
              if (/node_modules\/viem\//.test(id)) return bloqueDeViem(id, grafo);
              // La boveda de herencia firma bitcoin con btc-signer, que trae su
              // propia copia de las curvas (2.x; viem usa la 1.9): va en su
              // propio bloque, antes de la regla general de @noble/@scure.
              if (/node_modules\/(@scure\/btc-signer|micro-packed)\//.test(id)) return 'billetera-herencia';
              if (/node_modules\/@(noble|scure)\//.test(id)) return 'billetera-llaves';
              // three (la intro de Ergane de la web) es UN solo archivo de 688 KB
              // minificado: no se puede partir en bloques bajo el tope de 200 KB
              // como viem. Queda en un bloque propio, fijo en la 0.170.0, que solo
              // baja la web en el primer arranque de un navegador (import() del
              // modulo de la intro; nunca en la carga inicial ni en Android e iOS).
              // El CI le da su propio tope: ver ci.yml.
              if (/node_modules\/three\//.test(id)) return 'three';
            },
          },
        },
      },
    };
});
