import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Reglas de ESLint. Solo lo que detecta errores reales (variables sin usar, código inalcanzable,
 * hooks mal usados…); el formato lo pone Prettier (`npm run format`).
 */
export default [
  { ignores: ['dist/**', 'data/**', 'node_modules/**', 'build/**', 'client/public/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': ['error', { destructuring: 'all' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      // Colores ANSI de la consola de Minecraft (\x1b) y nombres de archivo con caracteres de control (\x00-\x1f): son a propósito.
      'no-control-regex': 'off',
      // Sangría de YAML en las pruebas: dos espacios literales se leen mejor que {2}.
      'no-regex-spaces': 'off',
    },
  },
  // Servidor, pruebas y scripts: Node.
  {
    files: ['server/**/*.js', 'test/**/*.js', 'scripts/**/*.{js,mjs}', 'vite.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
  },
  // Interfaz: navegador + React.
  {
    files: ['client/src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react/jsx-key': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      'react/no-direct-mutation-state': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Pruebas de navegador: el código dentro de page.evaluate() corre en la página.
  {
    files: ['test/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // Service worker.
  {
    files: ['client/public/sw.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: globals.serviceworker },
  },
];
