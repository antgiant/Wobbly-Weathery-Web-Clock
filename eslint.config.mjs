// Lint: real mistakes only (undefined names, unused variables). The code style is left alone.
import globals from 'globals';

const common = { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }], 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-redeclare': 'error', 'no-const-assign': 'error', 'no-self-assign': 'error', 'no-unsafe-negation': 'error', 'use-isnan': 'error', 'valid-typeof': 'error' };

export default [
  { ignores: ['node_modules/**', 'js/vendor/**', 'test-results/**', 'tests/visual/**', 'icons/**', 'data/**'] },
  { files: ['js/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, Astronomy: 'readonly' } }, rules: common },
  { files: ['js/easing.js'], rules: { 'no-redeclare': 'off' } },                                            // Robert Penner's easing functions, kept as published
  { files: ['sw.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.serviceworker } }, rules: common },
  { files: ['tests/**/*.mjs', 'tools/**/*.mjs', 'eslint.config.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser, Astronomy: 'writable' } }, rules: common },
];
