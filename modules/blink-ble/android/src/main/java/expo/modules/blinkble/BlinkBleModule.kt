package expo.modules.blinkble

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Fața expo-modules a motorului BLE — contractul din src/messaging/bleNative.ts:
 * start(myDid8, title, body) / stop() / send(did8, blobB64):bool + events onBlob/onPeerSeen/onPeerLost.
 *
 * Modulul NU mai deține motorul: îl deține BleService (foreground), ca mesh-ul să supraviețuiască
 * închiderii aplicației. Modulul doar pornește/oprește serviciul și se atașează ca ascultător.
 */
class BlinkBleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BlinkBle")
    Events("onBlob", "onPeerSeen", "onPeerLost")

    AsyncFunction("start") { myDid8: String, title: String, body: String, promise: Promise ->
      val ctx = appContext.reactContext
        ?: return@AsyncFunction promise.reject("ERR_BLE_CTX", "context indisponibil", null)
      try {
        BleHolder.sink = { ev, data -> sendEvent(ev, data) }
        BleService.start(ctx, myDid8, title, body)
        promise.resolve(null)
      } catch (e: Exception) {
        // Bluetooth oprit / fără hardware / permisiuni lipsă → JS-ul lasă transportul oprit (fallback releu)
        promise.reject("ERR_BLE_START", e.message ?: "start esuat", e)
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      val ctx = appContext.reactContext
      try {
        BleHolder.sink = null
        if (ctx != null) BleService.stop(ctx) else BleHolder.shutdown()
      } catch (_: Exception) {}
      promise.resolve(null)
    }

    AsyncFunction("send") { did8: String, blobB64: String, promise: Promise ->
      val e = BleHolder.peek() ?: return@AsyncFunction promise.resolve(false)
      e.send(did8, blobB64) { ok -> promise.resolve(ok) }
    }

    OnDestroy {
      // Procesul RN moare (app închis), dar mesh-ul rămâne viu în serviciu — DE ASTA existăm.
      // Desprindem doar ascultătorul, ca să nu trimitem evenimente într-un bridge mort.
      BleHolder.sink = null
    }
  }
}
