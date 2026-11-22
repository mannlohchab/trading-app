// Inputs to the "fingerprint" runtimeVersion (see app.json). Builds only accept OTA updates with
// the same fingerprint, so anything that can't affect native code must stay out of it.
/** @type {import('expo/fingerprint').Config} */
const { SourceSkips } = require('expo/fingerprint');

module.exports = {
  // package.json "scripts" are dev tooling (e.g. update:preview); editing them must not cut
  // installed APKs off from updates.
  // Autolinking paths differ between a local pnpm store and the bun install on EAS, which
  // would make the build reject its own runtime version. Versions stay in the fingerprint.
  sourceSkips: SourceSkips.PackageJsonScriptsAll | SourceSkips.AutolinkingConfigPaths,
};
