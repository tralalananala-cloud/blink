package expo.modules.blinkble

import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Polling-ul inbox-ului Reticulum, mutat în NATIV.
 *
 * De ce nativ: cu app-ul închis, serviciul de foreground ține procesul (deci contextul JS) viu, DAR
 * React Native pune pe pauză timerele JS (setInterval) când nu e nicio Activity în față — deci
 * polling-ul JS pur se oprea și mesajele Reticulum ajungeau abia la redeschidere (dovedit pe device
 * 2026-07-15). Un thread nativ NU e afectat de pauza timerelor RN, așa că întreabă gateway-ul
 * neîntrerupt; fiecare blob primit e împins în JS prin același mecanism de evenimente ca BLE, unde
 * se decriptează/stochează/notifică (procesarea event-driven rulează și cu app-ul închis).
 *
 * Trimiterea și înregistrarea rămân în JS (fetch, event-driven — nu depind de timere).
 */
object ReticulumPoller {
  /** Consumatorul JS al blob-urilor. null = contextul RN e mort → NU golim inbox-ul (vezi loop). */
  @Volatile var sink: ((String) -> Unit)? = null

  @Volatile private var gateway = ""
  @Volatile private var addr = ""
  @Volatile private var token = ""
  @Volatile private var running = false
  private var thread: Thread? = null

  private const val POLL_MS = 4000L

  /**
   * Pornește (sau reconfigurează) polling-ul. Idempotent: dacă rulează deja, doar actualizează
   * gateway/addr/token (ex. re-register cu token nou) — thread-ul citește câmpurile @Volatile la
   * fiecare tură. Un singur thread pe proces.
   */
  @Synchronized fun start(gw: String, a: String, t: String) {
    gateway = gw.trimEnd('/'); addr = a; token = t
    if (running) return
    running = true
    thread = Thread({ loop() }, "reticulum-poll").apply { isDaemon = true; start() }
    Log.i(BleEngine.TAG, "Reticulum: polling nativ PORNIT (addr=${a.take(12)})")
  }

  @Synchronized fun stop() {
    if (!running) return
    running = false
    thread?.interrupt()
    thread = null
    Log.i(BleEngine.TAG, "Reticulum: polling nativ OPRIT")
  }

  private fun loop() {
    while (running) {
      // Fără consumator JS (context RN distrus, proces păstrat de serviciu) NU citim /recv: citirea
      // GOLEȘTE inbox-ul server-side, deci am pierde iremediabil blob-urile. Așteptăm reatașarea JS.
      val s = sink
      if (s != null && gateway.isNotEmpty() && addr.isNotEmpty() && token.isNotEmpty()) {
        try {
          val url = URL("$gateway/recv?addr=${enc(addr)}&token=${enc(token)}")
          val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"; connectTimeout = 8000; readTimeout = 12000
            setRequestProperty("user-agent", "blink-reticulum/1")
          }
          try {
            if (conn.responseCode == 200) {
              val body = conn.inputStream.bufferedReader().use { it.readText() }
              val msgs = JSONObject(body).optJSONArray("msgs")
              val n = msgs?.length() ?: 0
              if (n > 0) {
                Log.i(BleEngine.TAG, "Reticulum: POLL → $n blob-uri")
                for (i in 0 until n) {
                  val blob = msgs!!.optString(i, "")
                  if (blob.isNotEmpty()) s(blob)
                }
              }
            }
          } finally { conn.disconnect() }
        } catch (e: Exception) {
          Log.w(BleEngine.TAG, "Reticulum: poll a eșuat: ${e.message}")
        }
      }
      try { Thread.sleep(POLL_MS) } catch (e: InterruptedException) { break }
    }
  }

  private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")
}
