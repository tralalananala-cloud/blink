// Config plugin: android:largeHeap="true" — mai mult heap pentru media (anti-OOM).
const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$["android:largeHeap"] = "true";
    return cfg;
  });
};
