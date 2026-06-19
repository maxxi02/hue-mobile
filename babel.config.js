// Without this file, Expo auto-applies `babel-preset-expo` (which already wires the
// Reanimated/worklets plugin). We add an explicit config for ONE reason: to neutralize
// `import.meta`.
//
// The bundled pdf.js (pulled in via `unpdf` for on-device resume PDF parsing — see
// lib/resume.ts) references `import.meta.url`/`import.meta.resolve` for worker and font
// resolution. Hermes has no `import.meta`, and Metro doesn't transform it by default, so
// the bundle would fail to build. pdf.js falls back to its in-process "FakeWorker" when
// the worker URL is unavailable, and the `import.meta.resolve` path is guarded behind an
// `isNode` check that's false on-device — so replacing every `import.meta` with a
// harmless `{ url: "" }` stub lets text extraction run without the real thing.
//
// Metro runs Babel over node_modules too, so this reaches unpdf's files. The visitor is a
// no-op for the app's own code (which never uses import.meta).
//
// Jest is unaffected: jest.config.js pins `configFile: false` + `babelrc: false`, so
// babel-jest never reads this file.

// Resolve the syntax plugin from this file's node_modules (see note in module.exports).
const syntaxImportMeta = (() => {
  const m = require('@babel/plugin-syntax-import-meta')
  return m.default || m
})()

/** Replace each `import.meta` MetaProperty with `({ url: "" })` so Hermes can run it. */
function neutralizeImportMeta() {
  return {
    name: 'neutralize-import-meta',
    visitor: {
      MetaProperty(path) {
        const node = path.node
        if (node.meta && node.meta.name === 'import' && node.property && node.property.name === 'meta') {
          path.replaceWithSourceString('({ url: "" })')
        }
      },
    },
  }
}

module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // syntax plugin lets the parser accept `import.meta`; our transform then removes it.
    // required at top (rather than referenced by name) so Node resolves it from this
    // file's node_modules — Babel's own plugin-name resolver runs from @babel/core's
    // relocated pnpm store dir (C:\.pn\...) and can't find the hoisted plugin.
    plugins: [syntaxImportMeta, neutralizeImportMeta],
  }
}
