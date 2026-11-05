import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
    rules: {
      // CLAUDE.md §12: no `any`.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // §12: the graph engine has zero imports from browser, Dexie, or adapters.
    files: ['src/graph/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['dexie', '**/db/**', '**/adapters/**', 'wxt*', '#imports'] },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'chrome', 'browser', 'indexedDB'],
    },
  },
  {
    // Typed-array indexing in the CSR hot loops is bounds-safe by construction; tests index fixtures.
    files: ['src/graph/**/*.ts', 'tests/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
