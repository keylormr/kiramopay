import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  prettier,
  {
    ignores: [
      'dist/',
      'android/',
      'node_modules/',
      '*.config.*',
      // Copia sin cambios de la fuente unica de la intro de Ergane: JavaScript
      // plano de navegador, sin la configuracion de globales de este repo. Se
      // actualiza copiandola de nuevo, no editandola aca.
      'src/ergane/ergane-intro.js',
    ],
  },
);
