package expo.modules.blinkble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
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

    try {
      BleHolder.engine(this).start(did8)
      Log.i(BleEngine.TAG, "serviciu de foreground PORNIT — mesh viu și cu app-ul închis (did8=$did8)")
    } catch (e: Exception) {
      // Bluetooth oprit sau permisiuni lipsă: n-are rost să ținem o notificare pentru un mesh mort.
      Log.e(BleEngine.TAG, "motorul BLE nu a pornit în serviciu: ${e.message}")
      stopSelf()
    }
    return START_STICKY
  }

  override fun onDestroy() {
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
