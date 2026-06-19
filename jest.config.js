// Jest covers the pure, RN-free logic only (see lib/utterance.ts, lib/resume-text.ts,
// lib/prompts.ts). We deliberately do NOT use jest-expo or the React Native preset: those
// pull in the whole native module graph just to exercise a handful of string functions.
//
// The transform is an inline Babel config with `configFile: false` + `babelrc: false`, so
// Jest never picks up an Expo/Metro babel config (there is no project babel.config.js, and
// this keeps it that way even if one returns). @babel/preset-typescript strips the types;
// @babel/preset-env targets the running Node so ESM import/export run under Jest's CJS.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'babel-jest',
      {
        configFile: false,
        babelrc: false,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
}
