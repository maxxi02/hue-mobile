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

module.exports = config;
