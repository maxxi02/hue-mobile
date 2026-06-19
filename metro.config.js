// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// pnpm relocates the virtual store to C:\.pn (.npmrc: virtual-store-dir) and
// hoists deps into the project root node_modules. Metro resolves modules by their
// real (symlink-target) path, so when a transitive package in the store references
// a hoisted package like `react`, walking up from C:\.pn\<pkg>\... never reaches
// this project's node_modules. Worse, some packages (e.g. standard-navigation@0.0.5,
// pulled in by expo-router) import `react` without declaring it as a dependency or
// peerDependency, so pnpm never places it beside them in the store.
//
// Adding the project root node_modules as a fallback resolution path lets Metro
// find these hoisted packages regardless of where the importing file physically lives.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

// unpdf (on-device PDF text extraction, lib/resume.ts) does not resolve cleanly under Metro
// + pnpm. Two failures:
//   1. The `.` entry resolves through package.json "exports" to a bare `dist/index` (no
//      extension); walking the pnpm store symlink (C:\.pn\unpdf@x\...\dist\index) Metro then
//      can't find a matching file -> "Unable to resolve module .../unpdf/dist/index ... none
//      of these files exist" the moment a resume is picked.
//   2. unpdf's own dist (index.cjs/index.mjs) lazily runs `import('unpdf/pdfjs')`, a subpath
//      declared ONLY under the "exports" `import` condition (-> ./dist/pdfjs.mjs) with no
//      file at node_modules/unpdf/pdfjs, which Metro's default conditions don't match.
//
// Rather than flip the global package-exports resolver (which changes resolution for every
// dependency and made #1 worse in testing), pin both unpdf entry points straight to their
// real files, with explicit extensions. index.cjs is the self-contained CommonJS build;
// pdfjs.mjs is the serverless pdf.js build it lazy-loads. Adding 'mjs' to sourceExts lets
// Metro transform the latter.
const UNPDF_MAIN = path.resolve(projectRoot, 'node_modules/unpdf/dist/index.cjs');
const UNPDF_PDFJS = path.resolve(projectRoot, 'node_modules/unpdf/dist/pdfjs.mjs');
if (!config.resolver.sourceExts.includes('mjs')) {
  config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];
}
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'unpdf') {
    return { type: 'sourceFile', filePath: UNPDF_MAIN };
  }
  if (moduleName === 'unpdf/pdfjs') {
    return { type: 'sourceFile', filePath: UNPDF_PDFJS };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
