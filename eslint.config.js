import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: ['coverage/**', 'dist/**', 'node_modules/**', '.vercel/**', '.playwright-mcp/**'],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Destructuring a key away is an intentional omission, not dead code.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/server/**', 'src/test/**', 'src/**/*.test.{js,jsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['api/**/*.js', 'scripts/**/*.js', 'src/server/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
  },
  {
    files: ['src/**/*.jsx'],
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      // This codebase uses plain JavaScript rather than runtime PropTypes.
      'react/prop-types': 'off',
      // Prose punctuation in rendered copy is not a correctness problem.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
]
