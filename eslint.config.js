import js from '@eslint/js'
import globals from 'globals'
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
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Allow intentionally-unused `_`-prefixed names, and props destructured
      // only to strip them from a `...rest` spread (e.g. a no-op API prop).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  // The Node side: the server and the desktop shell are CommonJS, their tests
  // (run by Vitest) are ES modules, and this file is one too.
  {
    files: ['server/**/*.js', 'desktop/**/*.js'],
    ignores: ['**/*.test.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
  },
  {
    // cleanLabel strips control characters on purpose.
    files: ['server/index.js'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['server/**/*.test.js', 'desktop/**/*.test.js', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
  },
])
