import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Fetch-on-mount (call an async loader from useEffect, then setState) is the standard pattern
      // in this app; this newer, stricter rule flags every page that does it.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // shadcn/ui files export variant helpers next to components by design
    files: ['src/components/ui/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Node-side config files
    files: ['vite.config.js'],
    languageOptions: { globals: globals.node },
  },
])
