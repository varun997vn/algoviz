import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-types/**', '**/coverage/**', '**/playwright-report/**', '**/test-results/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Trace snapshots are structurally typed and often need narrowing casts at the boundary
      // between the discriminated union and a generic renderer; blanket-banning assertions there
      // buys nothing but noise.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['packages/viz/**/*.tsx', 'apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    // The sandbox intentionally uses `new Function` — that is the isolation mechanism, chosen
    // over eval and blob: URLs so no CSP relaxation is needed.
    files: ['packages/runner/src/sandbox.ts'],
    rules: {
      '@typescript-eslint/no-implied-eval': 'off',
      'no-new-func': 'off',
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.dom.test.tsx', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['**/*.cjs', '*.js'],
    languageOptions: { globals: globals.node },
  },
)
