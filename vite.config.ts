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
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules/react-dom')) return 'vendor-react';
              if (id.includes('node_modules/react/')) return 'vendor-react';
              if (id.includes('node_modules/zustand')) return 'vendor-zustand';
              if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
              if (id.includes('node_modules/qrcode.react')) return 'vendor-qr';
              if (id.includes('/i18n/translations')) return 'i18n';
              if (id.includes('/adapters/mock/')) return 'mock-adapters';
              if (id.includes('/stores/') && !id.includes('__tests__')) return 'app-stores';
            },
          },
        },
      },
    };
});
