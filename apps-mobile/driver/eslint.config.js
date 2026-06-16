// Flat ESLint config for the standalone driver app (ADR-0033). Uses
// eslint-config-expo — the Expo-maintained ruleset matched to SDK 56. The
// repo-root `eslint .` ignores apps-mobile/ (it can't resolve RN/Expo), so
// this app owns its own lint, run by the mobile CI job.
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
];
