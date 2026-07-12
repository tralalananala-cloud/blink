package expo.modules.blinkble

import android.content.Context
import android.util.Log

/**
 * Motorul BLE trebuie să trăiască mai mult decât modulul JS.
 *
 * BlinkBleModule moare odată cu procesul React Native (pe ColorOS: în clipa în care ieși din app).
 * Dacă motorul ar sta în modul, ar muri cu el — serverul GATT tace, advertisingul se oprește și
 * telefonul devine invizibil pentru peers. De aceea instanța stă aici, deținută de serviciul de
 * foreground, iar modulul doar se atașează la ea cât timp UI-ul e viu.
 */
object BleHolder {
  private var engine: BleEngine? = null

  /**
   * Ascultătorul din JS. null = aplicația nu e vie (mesh-ul merge, dar n-are cui livra evenimentul).
   * Livrarea propriu-zisă cu app-ul închis vine în Etapa 2 — aici doar nu crăpăm.
   */
  @Volatile
  var sink: ((String, Map<String, String>) -> Unit)? = null

  @Synchronized
  fun engine(ctx: Context): BleEngine =
    engine ?: BleEngine(ctx.applicationContext) { ev, data ->
      val s = sink
      if (s == null) Log.w(BleEngine.TAG, "eveniment $ev fără ascultător JS (app închis) — ignorat")
      else s(ev, data)
    }.also { engine = it }

  @Synchronized
  fun peek(): BleEngine? = engine

  @Synchronized
  fun shutdown() {
    try {
      engine?.stop()
    } catch (e: Exception) {
      Log.w(BleEngine.TAG, "oprirea motorului a eșuat: ${e.message}")
    }
    engine = null
  }
}
