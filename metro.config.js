const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web implementation ships a wa-sqlite WebAssembly binary that Metro needs to treat
// as a bundled asset (not source) in order to resolve `import wasmModule from '...wa-sqlite.wasm'`.
config.resolver.assetExts.push('wasm');

module.exports = config;
