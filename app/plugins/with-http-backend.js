const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

// Explicit opt-in for the internal APK's local HTTP API and WebSocket server.
// HTTPS builds leave Android's default network policy unchanged.
module.exports = function withHttpBackend(config) {
  if (process.env.ANDROID_ALLOW_HTTP_BACKEND !== 'true') return config;

  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
};
