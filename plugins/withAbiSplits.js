// Config plugin: activează ABI splits în android/app/build.gradle.
// În loc de un APK universal (224M, libs native pt TOATE arhitecturile), produce
// câte un APK per arhitectură → fiecare conține doar libs-urile lui (~99M pt arm64).
// prebuild --clean regenerează android/, deci injectăm la fiecare build.
const { withAppBuildGradle } = require("@expo/config-plugins");

// Arhitecturi build-uite: arm64-v8a (telefoane moderne) + armeabi-v7a (telefoane vechi 32-bit)
// + x86_64 (emulatorul de test). Sărim x86 (doar emulatoare antice).
const ABIS = `"armeabi-v7a", "arm64-v8a", "x86_64"`;

const SPLITS_BLOCK = `
    splits {
        abi {
            enable true
            reset()
            include ${ABIS}
            universalApk false
        }
    }`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes("// BLINK_ABI_SPLITS")) {
      // inserează blocul splits imediat după primul `android {`
      src = src.replace(/android\s*\{/, `android {\n    // BLINK_ABI_SPLITS${SPLITS_BLOCK}`);
      cfg.modResults.contents = src;
    }
    return cfg;
  });
};
