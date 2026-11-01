import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'server/dist', 'desktop/server', 'desktop/release']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: { projectService: true },
    },
    rules: {
      // Allow intentionally-unused `_`-prefixed names, and props destructured
      // only to strip them from a `...rest` spread (e.g. a no-op API prop).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // React ignores what an event handler returns, so async onClick/onSubmit is fine.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      // res.json() and JSON.parse return `any`, and that flows through the
      // already-validated API and import boundaries; typing every one is its own change.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // The hand-written .d.ts shims for server/ modules sit in no tsconfig.
    files: ['server/**/*.d.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['src/**/*.tsx'],
    extends: [jsxA11y.flatConfigs.recommended],
    rules: {
      // Dialogs and the login form focus their first field on open, on purpose.
      'jsx-a11y/no-autofocus': 'off',
      // Checkbox labels nest their text one level deeper than the default depth of 2.
      'jsx-a11y/label-has-associated-control': ['error', { depth: 3 }],
    },
  },
  // The Node side: the server and the desktop shell are CommonJS, their tests
  // (run by Vitest) are ES modules, and this file is one too.
  {
    files: ['server/**/*.js', 'desktop/**/*.js'],
    ignores: ['**/*.test.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }] },
  },
  {
    // cleanLabel strips control characters on purpose.
    files: ['server/index.js'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['server/**/*.test.js', 'desktop/**/*.test.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
  },
])
