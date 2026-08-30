import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', '.vercel/', 'public/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // The vendor boundary (feature 005). `@anthropic-ai/sdk` is importable from
  // server/src/lib/ai/adapters/ and nowhere else — the same discipline that
  // keeps Leaflet inside src/map/engine.leaflet.ts, and the thing that makes
  // changing provider one file rather than a search across the repo.
  //
  // It is a lint rule rather than a comment because a boundary that lives in a
  // comment survives until the first person in a hurry. `npm run lint` is
  // therefore part of this feature's correctness story, not just its tidiness
  // — the same way `npm run typecheck` carries the export's field policy.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['server/src/lib/ai/adapters/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/*'],
              message:
                'The Anthropic SDK belongs in server/src/lib/ai/adapters/ only. Everything else speaks AiMessage/AiEvent (see specs/005-trip-chat/research.md R7, R8).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
  }
)
