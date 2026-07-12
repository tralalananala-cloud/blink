package expo.modules.blinkble

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Fața expo-modules a motorului BLE — contractul din src/messaging/bleNative.ts:
 * start(myDid8) / stop() / send(did8, blobB64):bool + events onBlob/onPeerSeen/onPeerLost.
 */
class BlinkBleModule : Module() {
  private var engine: BleEngine? = null

  override fun definition() = ModuleDefinition {
    Name("BlinkBle")
    Events("onBlob", "onPeerSeen", "onPeerLost")

    AsyncFunction("start") { myDid8: String, promise: Promise ->
      val ctx = appContext.reactContext
        ?: return@AsyncFunction promise.reject("ERR_BLE_CTX", "context indisponibil", null)
      try {
        if (engine == null) engine = BleEngine(ctx) { ev, data -> sendEvent(ev, data) }
        engine!!.start(myDid8)
        promise.resolve(null)
      } catch (e: Exception) {
        // Bluetooth oprit / fără hardware / permisiuni lipsă → JS-ul lasă transportul oprit (fallback releu)
        promise.reject("ERR_BLE_START", e.message ?: "start esuat", e)
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      try { engine?.stop() } catch (_: Exception) {}
      promise.resolve(null)
    }

    AsyncFunction("send") { did8: String, blobB64: String, promise: Promise ->
      val e = engine ?: return@AsyncFunction promise.resolve(false)
      e.send(did8, blobB64) { ok -> promise.resolve(ok) }
    }

    OnDestroy {
      try { engine?.stop() } catch (_: Exception) {}
      engine = null
    }
  }
}
