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
 * Ține mesh-ul BLE viu când aplicația nu e pe ecran.
 *
 * Fără serviciu de foreground, Android (și ColorOS cu vârf de măsură) îngheață procesul la ieșirea
 * din app: serverul GATT nu mai răspunde, advertisingul se oprește, iar telefonul e complet invizibil
 * la scanare. Rezultat practic: mesh-ul mergea doar cu AMBELE telefoane deschise pe ecran.
 *
 * Notificarea permanentă nu e decor — e prețul cerut de sistem ca să nu ne omoare procesul.
 */
class BleService : Service() {
  companion object {
    const val EXTRA_DID8 = "did8"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    private const val CHANNEL = "blink_mesh"
    private const val NOTIF_ID = 4201
    // did8-ul ultimei porniri: la ciclarea Bluetooth-ului (mod avion, toggle manual) motorul moare
    // cu radioul, iar repornirea se face de aici, fără să mai treacă prin JS. @Volatile: scris din
    // firul JS (onStartCommand), citit din receiver-ul de stare BT.
    @Volatile private var lastDid8: String? = null

    fun start(ctx: Context, did8: String, title: String, body: String) {
      val i = Intent(ctx, BleService::class.java)
        .putExtra(EXTRA_DID8, did8)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, BleService::class.java))
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
            // Stiva nu e gata chiar în clipa STATE_ON pe toate device-urile → pornim cu o mică
            // amânare + o reîncercare (btRestart se re-programează singur o dată la eșec).
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
    val did8 = intent?.getStringExtra(EXTRA_DID8)
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Blink"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: "Bluetooth mesh"

    // startForeground TREBUIE chemat în primele ~5s de la startForegroundService, altfel ANR.
    goForeground(title, body)

    // START_STICKY repornește serviciul cu intent null → n-avem DID-ul, deci nu putem face advertising.
    // Rămânem în picioare (notificarea e deja pusă) și așteptăm ca app-ul să reapeleze start().
    if (did8.isNullOrBlank()) {
      Log.w(BleEngine.TAG, "serviciu repornit de sistem fără DID — aștept start() din app")
      return START_STICKY
    }

    lastDid8 = did8
    try {
      BleHolder.engine(this).start(did8)
      Log.i(BleEngine.TAG, "serviciu de foreground PORNIT — mesh viu și cu app-ul închis (did8=$did8)")
    } catch (e: Exception) {
      // Bluetooth oprit chiar acum: rămânem în picioare — receiver-ul de stare BT ne repornește
      // motorul când radioul revine. Alte erori (permisiuni lipsă) n-au leac fără user → oprim.
      Log.e(BleEngine.TAG, "motorul BLE nu a pornit în serviciu: ${e.message}")
      val mgr = getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager
      if (mgr?.adapter?.isEnabled != false) stopSelf()
      else Log.w(BleEngine.TAG, "aștept repornirea Bluetooth-ului ca să pornesc mesh-ul")
    }
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(btRestart)
    try { btReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
    btReceiver = null
    BleHolder.shutdown()
    Log.i(BleEngine.TAG, "serviciu de foreground OPRIT — mesh închis")
    super.onDestroy()
  }

  private fun goForeground(title: String, body: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, buildNotification(title, body), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
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
