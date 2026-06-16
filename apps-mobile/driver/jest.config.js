// jest-expo preset (SDK 56). Its transform chain (babel-preset-expo) handles
// TypeScript, so a pure .ts unit runs with no extra config. Component/render
// tests arrive with the real screens (D1+).
module.exports = {
  preset: 'jest-expo',
};
