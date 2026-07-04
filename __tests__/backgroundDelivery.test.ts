/**
 * T5 — helper best-effort pentru livrarea în fundal pe Android OEM (ColorOS).
 * Nu putem forța nimic; verificăm doar că deschidem ecranul corect de sistem și că degradăm
 * grațios (fallback pe detaliile aplicației, apoi false) fără să aruncăm. Pe iOS: no-op.
 */
const mockStart = jest.fn();
jest.mock("expo-intent-launcher", () => ({
  startActivityAsync: (...a: any[]) => mockStart(...a),
  ActivityAction: {
    IGNORE_BATTERY_OPTIMIZATION_SETTINGS: "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS",
    APPLICATION_DETAILS_SETTINGS: "android.settings.APPLICATION_DETAILS_SETTINGS",
  },
}));

const platform = { OS: "android" };
jest.mock("react-native", () => ({ Platform: platform }));

beforeEach(() => { mockStart.mockReset(); platform.OS = "android"; });

describe("T5 — backgroundDelivery", () => {
  it("android: deschide ecranul de optimizare a bateriei → true", async () => {
    mockStart.mockResolvedValueOnce(undefined);
    const { openBatteryOptimizationSettings } = require("../src/permissions/backgroundDelivery");
    await expect(openBatteryOptimizationSettings()).resolves.toBe(true);
    expect(mockStart).toHaveBeenCalledWith("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
  });

  it("android: dacă ecranul de baterie lipsește → fallback pe detaliile aplicației", async () => {
    mockStart.mockRejectedValueOnce(new Error("no activity")).mockResolvedValueOnce(undefined);
    const { openBatteryOptimizationSettings } = require("../src/permissions/backgroundDelivery");
    await expect(openBatteryOptimizationSettings()).resolves.toBe(true);
    expect(mockStart).toHaveBeenLastCalledWith(
      "android.settings.APPLICATION_DETAILS_SETTINGS",
      { data: "package:io.blink.app" },
    );
  });

  it("android: ambele ecrane eșuează → false, fără să arunce", async () => {
    mockStart.mockRejectedValue(new Error("nimic"));
    const { openBatteryOptimizationSettings } = require("../src/permissions/backgroundDelivery");
    await expect(openBatteryOptimizationSettings()).resolves.toBe(false);
  });

  it("iOS: no-op → false, nu atinge IntentLauncher", async () => {
    platform.OS = "ios";
    const { openBatteryOptimizationSettings } = require("../src/permissions/backgroundDelivery");
    await expect(openBatteryOptimizationSettings()).resolves.toBe(false);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("supportsBackgroundHint = true doar pe Android", () => {
    jest.isolateModules(() => { platform.OS = "android"; expect(require("../src/permissions/backgroundDelivery").supportsBackgroundHint).toBe(true); });
    jest.isolateModules(() => { platform.OS = "ios"; expect(require("../src/permissions/backgroundDelivery").supportsBackgroundHint).toBe(false); });
  });
});
