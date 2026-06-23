// Config plugin: activează core library desugaring în android/app/build.gradle.
// Necesar pentru org.signal:libsignal-android (cerut de react-native-libsignal-client).
// prebuild --clean regenerează android/, deci injectăm la fiecare build.
const { withAppBuildGradle } = require("@expo/config-plugins");

const DESUGAR_DEP = `com.android.tools:desugar_jdk_libs:2.1.4`;

module.exports = function withDesugaring(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;

    // 1) coreLibraryDesugaringEnabled true. Build.gradle-ul Expo NU are bloc
    //    compileOptions → îl inserăm pe primul `android {`.
    if (!src.includes("coreLibraryDesugaringEnabled")) {
      if (/compileOptions\s*\{/.test(src)) {
        src = src.replace(/compileOptions\s*\{/, "compileOptions {\n        coreLibraryDesugaringEnabled true");
      } else {
        src = src.replace(/android\s*\{/, "android {\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }");
      }
    }

    // 2) dependența de desugaring
    if (!src.includes("desugar_jdk_libs")) {
      src = src.replace(
        /dependencies\s*\{/,
        `dependencies {\n    coreLibraryDesugaring("${DESUGAR_DEP}")`,
      );
    }

    cfg.modResults.contents = src;
    return cfg;
  });
};
