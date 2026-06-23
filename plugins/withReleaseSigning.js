// Config plugin: semnează build-ul release cu keystore-ul PROPRIU (nu cheia debug).
// Credențialele vin din ~/.gradle/gradle.properties (BLINK_UPLOAD_*), niciodată în git.
// prebuild --clean regenerează android/, deci injectăm la fiecare build.
// ⚠️ Schimbă semnătura APK → update peste o instalare debug-semnată cere uninstall (flag-day).
const { withAppBuildGradle } = require("@expo/config-plugins");

const RELEASE_SIGNING = `
        release {
            if (project.hasProperty('BLINK_UPLOAD_STORE_FILE')) {
                storeFile file(BLINK_UPLOAD_STORE_FILE)
                storePassword BLINK_UPLOAD_STORE_PASSWORD
                keyAlias BLINK_UPLOAD_KEY_ALIAS
                keyPassword BLINK_UPLOAD_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;

    // 1) adaugă signingConfigs.release (lângă debug) dacă lipsește
    if (!src.includes("// BLINK_RELEASE_SIGNING")) {
      src = src.replace(
        /signingConfigs\s*\{/,
        `signingConfigs {\n        // BLINK_RELEASE_SIGNING${RELEASE_SIGNING}`,
      );
    }

    // 2) buildType-ul release să folosească release în loc de debug.
    //    Ancoră unică: comentariul "Caution!" din blocul release Expo.
    src = src.replace(
      /(\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\s*\n\s*signingConfig )signingConfigs\.debug/,
      "$1project.hasProperty('BLINK_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );

    cfg.modResults.contents = src;
    return cfg;
  });
};
