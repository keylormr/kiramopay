import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
      plugins: [react(), tailwindcss()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
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
