package expo.modules.blinkble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.util.Log

/**
 * Ține transporturile descentralizate vii când aplicația nu e pe ecran.
 *
 * Fără serviciu de foreground, Android (și ColorOS cu vârf de măsură) îngheață procesul la ieșirea
 * din app: contextul JS moare → mesh-ul BLE tace ȘI polling-ul Reticulum se oprește ȘI notificările
 * nu mai pornesc. Serviciul ține procesul (deci contextul JS) viu, așa că AMBELE transporturi
 * descentralizate continuă cu app-ul închis.
 *
 * Două motive independente de a rula, cu ref-counting (ca oprirea unuia să nu-l omoare pe altul):
 *  - BLE (mod `connectedDevice`): advertising + scanner + GATT.
 *  - HOLD (mod `dataSync`): doar ține procesul viu pentru polling-ul Reticulum, fără BLE.
 *
 * Notificarea permanentă nu e decor — e prețul cerut de sistem ca să nu ne omoare procesul.
 */
class BleService : Service() {
  companion object {
    const val EXTRA_DID8 = "did8"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val EXTRA_HOLD = "hold"
    private const val CHANNEL = "blink_mesh"
    private const val NOTIF_ID = 4201
    // did8-ul ultimei porniri: la ciclarea Bluetooth-ului (mod avion, toggle manual) motorul moare
    // cu radioul, iar repornirea se face de aici, fără să mai treacă prin JS. @Volatile: scris din
    // firul JS (onStartCommand), citit din receiver-ul de stare BT.
    @Volatile private var lastDid8: String? = null

    // Cele două motive de a rula. Volatile: citite/scrise din firul JS și din serviciu.
    @Volatile private var bleActive = false
    @Volatile private var holdActive = false
    // Ultimul text de notificare știut — reutilizat la tranziția BLE→hold, unde apelantul (stop) nu-l dă.
    @Volatile private var lastTitle = "Blink"
    @Volatile private var lastBody = "activ în fundal"

    private fun launch(ctx: Context, hold: Boolean, did8: String, title: String, body: String) {
      lastTitle = title; lastBody = body
      val i = Intent(ctx, BleService::class.java)
        .putExtra(EXTRA_HOLD, hold)
        .putExtra(EXTRA_DID8, did8)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
    }

    /** BLE pornit: advertising + scanner + GATT în foreground (mod connectedDevice). */
    fun start(ctx: Context, did8: String, title: String, body: String) {
      bleActive = true
      launch(ctx, false, did8, title, body)
    }

    /** BLE oprit (contractul modulului). Dacă HOLD e cerut → tranziție la hold, altfel oprește tot. */
    fun stop(ctx: Context) {
      bleActive = false
      if (holdActive) launch(ctx, true, "", lastTitle, lastBody)
      else ctx.stopService(Intent(ctx, BleService::class.java))
    }

    /** HOLD pornit: ține procesul/JS viu pentru Reticulum (mod dataSync). Dacă BLE deja rulează,
     *  procesul e oricum viu → nu pornim nimic în plus. */
    fun startHold(ctx: Context, title: String, body: String) {
      holdActive = true
      if (!bleActive) launch(ctx, true, "", title, body)
    }

    /** HOLD oprit. Dacă BLE încă rulează, serviciul rămâne (pt BLE); altfel oprește tot. */
    fun stopHold(ctx: Context) {
      holdActive = false
      if (!bleActive) ctx.stopService(Intent(ctx, BleService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private val handler = Handler(android.os.Looper.getMainLooper())
  private var btReceiver: BroadcastReceiver? = null

  /**
   * Motorul BLE moare odată cu radioul Bluetooth (mod avion, toggle manual) și NU învie singur —
   * serviciul rămânea în picioare cu notificarea afișată, dar telefonul era invizibil și orb
   * (văzut pe teren 2026-07-13: advertising + scanner dispărute din stivă până la restart de app).
   * Receiver-ul repornește motorul când radioul revine, cu did8-ul deja știut.
   */
  override fun onCreate() {
    super.onCreate()
    btReceiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context?, intent: Intent?) {
        when (intent?.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
          BluetoothAdapter.STATE_OFF -> {
            // Oprire curată: altfel motorul ține obiecte GATT moarte și `running=true` blochează
            // orice start viitor. Trimiterile în așteptare pică curat (rămân în outbox-ul din JS).
            Log.w(BleEngine.TAG, "Bluetooth OPRIT — motorul BLE se închide (repornesc când revine)")
            handler.removeCallbacks(btRestart)
            BleHolder.shutdown()
          }
          BluetoothAdapter.STATE_ON -> {
            // Doar dacă BLE e chiar cerut: în modul HOLD (doar Reticulum, fără BLE) nu pornim radio
            // pe care userul nu l-a cerut. Stiva nu e gata chiar în clipa STATE_ON pe toate
            // device-urile → pornim cu o mică amânare + o reîncercare (btRestart se re-programează).
            if (!bleActive) return
            Log.i(BleEngine.TAG, "Bluetooth REPORNIT — reînviez motorul BLE")
            btRestartTriesLeft = 2
            handler.removeCallbacks(btRestart)
            handler.postDelayed(btRestart, 1_000)
          }
        }
      }
    }
    registerReceiver(btReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
  }

  private var btRestartTriesLeft = 0
  private val btRestart = object : Runnable {
    override fun run() {
      if (!bleActive) return // BLE oprit între timp (ex. trecut pe HOLD) — nu-l reînvia
      val did8 = lastDid8 ?: return // serviciu repornit de sistem fără DID — n-avem cu ce porni
      btRestartTriesLeft--
      try {
        BleHolder.engine(this@BleService).start(did8)
        Log.i(BleEngine.TAG, "motor BLE REPORNIT după ciclarea Bluetooth-ului (did8=$did8)")
      } catch (e: Exception) {
        Log.e(BleEngine.TAG, "repornirea motorului BLE a eșuat: ${e.message}" +
          if (btRestartTriesLeft > 0) " — reîncerc în 3s" else " — renunț (repornește app-ul)")
        if (btRestartTriesLeft > 0) handler.postDelayed(this, 3_000)
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val hold = intent?.getBooleanExtra(EXTRA_HOLD, false) ?: false
    val did8 = intent?.getStringExtra(EXTRA_DID8)
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: lastTitle
    val body = intent?.getStringExtra(EXTRA_BODY) ?: lastBody

    // startForeground TREBUIE chemat în primele ~5s de la startForegroundService, altfel ANR.
    goForeground(title, body, hold)

    if (hold) {
      // Mod HOLD: doar ținem procesul (deci contextul JS + polling-ul Reticulum) viu. Fără BLE.
      // Dacă venim dintr-o tranziție BLE→hold, oprim motorul BLE care mai rula.
      BleHolder.shutdown()
      Log.i(BleEngine.TAG, "serviciu de foreground HOLD — proces viu pt Reticulum (fără BLE)")
      return START_STICKY
    }

    // START_STICKY repornește serviciul cu intent null → n-avem DID-ul, deci nu putem face advertising.
    // Rămânem în picioare (notificarea e deja pusă) și așteptăm ca app-ul să reapeleze start().
    if (did8.isNullOrBlank()) {
      Log.w(BleEngine.TAG, "serviciu repornit de sistem fără DID — aștept start() din app")
      return START_STICKY
    }

    lastDid8 = did8
    try {
      BleHolder.engine(this).start(did8)
      Log.i(BleEngine.TAG, "serviciu de foreground BLE — mesh viu și cu app-ul închis (did8=$did8)")
    } catch (e: Exception) {
      // Nu oprim serviciul dacă avem alt motiv să-l ținem viu:
      //  - Bluetooth oprit chiar acum → receiver-ul de stare BT repornește motorul când radioul revine.
      //  - HOLD cerut → procesul trebuie să rămână viu pentru polling-ul Reticulum.
      // Doar dacă niciuna nu e cazul (ex. permisiuni lipsă cu BT pornit, fără HOLD) închidem.
      Log.e(BleEngine.TAG, "motorul BLE nu a pornit în serviciu: ${e.message}")
      val mgr = getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager
      val btEnabled = mgr?.adapter?.isEnabled != false
      if (btEnabled && !holdActive) stopSelf()
      else if (!btEnabled) Log.w(BleEngine.TAG, "aștept repornirea Bluetooth-ului ca să pornesc mesh-ul")
    }
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(btRestart)
    try { btReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
    btReceiver = null
    BleHolder.shutdown()
    Log.i(BleEngine.TAG, "serviciu de foreground OPRIT")
    super.onDestroy()
  }

  private fun goForeground(title: String, body: String, hold: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // BLE = connectedDevice; HOLD (Reticulum) = dataSync (sincronizare de date pe rețea).
      val type = if (hold) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      startForeground(NOTIF_ID, buildNotification(title, body), type)
    } else {
      startForeground(NOTIF_ID, buildNotification(title, body))
    }
  }

  private fun buildNotification(title: String, body: String): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      // IMPORTANCE_LOW: notificarea trebuie să existe, nu să sune și să vibreze la fiecare pornire.
      val ch = NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_LOW)
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }

    val open = packageManager.getLaunchIntentForPackage(packageName)
    val pi = open?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    @Suppress("DEPRECATION")
    val b =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL)
      else Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)

    b.setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setOngoing(true)
    if (pi != null) b.setContentIntent(pi)
    return b.build()
  }
}
