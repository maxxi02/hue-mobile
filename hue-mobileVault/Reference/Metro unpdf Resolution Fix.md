# Metro unpdf Resolution Fix

Found on-device 2026-06-18 while doing the [[Phase 3 Build Notes|Phase 3]] "Upload resume"
hardware pass that was flagged as unverified. The resume PDF path (`unpdf`) would not bundle
under **Metro + pnpm**, so picking a resume threw an "Unable to resolve module" red error in
the Settings screen. Fixed in `metro.config.js` with two explicit resolver aliases.

## Symptom
Tapping **Upload resume** (any file — the import is eager enough to fail on pick) showed:

```
Unable to resolve module ./.pn/unpdf@1.6.2/node_modules/unpdf/dist/index
from C:\dev-proj\hue-extension-claude\hue-mobile/.:
None of these files exist:
  * .pn\unpdf@1.6.2\node_modules\unpdf\dist\index(.android.ts|.native.ts|.ts|…|.cjs|…|.css)
  * .pn\unpdf@1.6.2\node_modules\unpdf\dist\index
```

The failing module is **`unpdf`'s main entry** (`dist/index`) — *not* a missing package and
*not* the `.npmrc`/`node-linker` issue from [[Setup Guide (pnpm)]].

## Root cause (Metro package-exports + pnpm)
1. Metro resolves unpdf's `package.json` `"exports"` `.` field down to a bare **`dist/index`
   with no extension**, then walks the pnpm store symlink (`node_modules/unpdf` →
   `C:\.pn\unpdf@1.6.2\…`, the relocated virtual store from [[Phase 1 Build Notes]]). At that
   real path it appends source extensions and finds nothing it accepts → resolution fails.
2. Separately, unpdf's own `dist/index.cjs`/`index.mjs` lazy-loads its pdf.js build via
   `import('unpdf/pdfjs')` — a subpath declared **only** under the `"exports"` `import`
   condition (`./dist/pdfjs.mjs`), with no real file at `node_modules/unpdf/pdfjs`. Metro's
   default resolver conditions don't match it, so that would fail next even after #1.

## ⚠️ Dead ends (don't repeat these)
- **`config.resolver.unstable_enablePackageExports = true`** — leans *harder* on the exports
  path that is itself broken under pnpm. Made #1 worse / unchanged, not better.
- Adding the `import` condition / chasing `unpdf/pdfjs` first — that subpath is the *second*
  failure; the main `unpdf` entry fails first. The screenshot of the real error (module name
  `unpdf/dist/index`) is what redirected the fix. **Lesson: get the exact module string from
  the red box / logcat before aliasing — don't infer it from the import graph.**

## The fix (`metro.config.js`)
Pin **both** unpdf entry points straight to their real files, with explicit extensions, so
resolution never touches the exports map or pnpm extension-guessing. `index.cjs` is the
self-contained CommonJS build; `pdfjs.mjs` is the serverless pdf.js build it lazy-loads
(needs `mjs` in `sourceExts`).

```js
const UNPDF_MAIN  = path.resolve(projectRoot, 'node_modules/unpdf/dist/index.cjs');
const UNPDF_PDFJS = path.resolve(projectRoot, 'node_modules/unpdf/dist/pdfjs.mjs');
if (!config.resolver.sourceExts.includes('mjs')) {
  config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];
}
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'unpdf')       return { type: 'sourceFile', filePath: UNPDF_MAIN };
  if (moduleName === 'unpdf/pdfjs') return { type: 'sourceFile', filePath: UNPDF_PDFJS };
  return context.resolveRequest(context, moduleName, platform);
};
```

This is deterministic and surgical — it doesn't change resolution for any other dependency.
Pairs with the Hermes plumbing already in [[Phase 3 Build Notes]] (`lib/pdfPolyfills.ts`,
`babel.config.js` `import.meta` neutralization).

## Apply / verify
- `metro.config.js` is read **once at startup** — a reload won't pick it up. Fully stop Metro
  (Ctrl+C) and restart: `pnpm expo start --clear`. No native rebuild (JS-only change).
- Quick bundler-level check without the device: with Metro running, drop a temp
  `_probe.js` containing `require('unpdf'); require('unpdf/pdfjs')` at the project root and
  hit `http://localhost:8081/_probe.bundle?platform=android&dev=true`. **HTTP 200** = both
  resolve; an error JSON names the next unresolved module. Delete the probe after.
- If a *new* module name appears, alias it the same way. None expected: `index.cjs` is
  self-contained and its only dynamic dep (`unpdf/pdfjs`) is already aliased.

## Debugging note (logcat)
This is a **Metro bundler** error; it surfaces in the app red box and the Metro terminal, but
did **not** reliably appear in `adb logcat` (the JS error tag was filtered out, and the app
itself loaded fine then paused into the file picker). The decisive artifact was a screenshot
of the in-app red error. For bundler resolution issues, trust the Metro terminal / red box
over logcat.
