// Config Metro pt Expo. Singurul scop: forțează O SINGURĂ versiune de
// react-native-quick-base64 (cea de top, 2.2.2) peste tot — inclusiv copia nested
// pe care @craftzdog/react-native-buffer o cere (^3.0.0). Versiunea 3.x folosește
// TurboModuleRegistry.getEnforcing('QuickBase64') la încărcare → crash
// "QuickBase64 could not be found" pe old arch. v2.2.2 folosește NativeModules +
// globale JSI, pe care le polyfill-uim în JS pur (quickBase64Polyfill.ts).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const QB64 = path.resolve(__dirname, "node_modules/react-native-quick-base64/lib/module/index.js");

const prevResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native-quick-base64") {
    return { type: "sourceFile", filePath: QB64 };
  }
  return prevResolveRequest
    ? prevResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
