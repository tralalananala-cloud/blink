package expo.modules.blinkble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.ArrayDeque
import java.util.UUID

/**
 * Motorul BLE al Blink (lot BLE-2) — livrare directă telefon↔telefon în proximitate.
 * Ambele roluri simultan: ANUNȚĂ did8-ul propriu (advertising + server GATT pe care peer-ii
 * scriu blob-uri) și CAUTĂ peers (scanner + client GATT care scrie blob-uri la ei).
 *
 * Payload-urile sunt plicuri E2E deja criptate (libsignal) — legătura GATT nu are nevoie de
 * bonding/criptare proprie; un blob interceptat radio e la fel de opac ca pe releu.
 *
 * Cadru pe fir: [lungime u32 big-endian][blob] tăiat în bucăți de (MTU-3); receptorul
 * reasamblează per device și emite onBlob la completare.
 */
@SuppressLint("MissingPermission") // permisiunile runtime sunt cerute din JS înainte de start()
class BleEngine(
  private val context: Context,
  private val emit: (event: String, data: Map<String, String>) -> Unit,
) {
  companion object {
    const val TAG = "BlinkBle"
    val SERVICE_UUID: UUID = UUID.fromString("8f3a1c20-6b2d-4e5f-9a71-c4d8e0b15b1e")
    val BLOB_CHAR_UUID: UUID = UUID.fromString("8f3a1c21-6b2d-4e5f-9a71-c4d8e0b15b1e")
    /**
     * BLE-4 etapa 3 — scanarea în ferestre (duty-cycle).
     *
     * Scanarea continuă ține receptorul radio treaz non-stop: pe A38 s-au măsurat 722s de scanare
     * din 722s de funcționare, adică 100%. E cel mai scump lucru din mesh, iar advertisingul
     * celuilalt telefon e oricum PERMANENT — deci nu ratăm pe cineva stând cu urechea ciulită
     * tot timpul, doar îl găsim cu o fereastră întârziere.
     *
     * 6s ascultare / 24s pauză = 20% duty ⇒ de ~5 ori mai puțin timp de radio, la costul unei
     * latențe de descoperire de cel mult ~30s (o singură dată, la apropiere — după aceea peer-ul
     * e deja cunoscut și legătura GATT se reface instant).
     */
    const val SCAN_WINDOW_MS = 6_000L
    const val SCAN_IDLE_MS = 24_000L
    /**
     * Peer-ul trebuie să supraviețuiască pauzelor dintre ferestre, altfel l-am declara „pierdut"
     * la fiecare ciclu. 95s ≈ 3 cicluri ratate. Prețul: până la ~95s după ce cineva pleacă din rază
     * încă îl credem aproape → o trimitere pe BLE eșuează, apoi cade curat pe Reticulum/releu.
     */
    const val PEER_TTL_MS = 95_000L      // peer nevăzut atât → onPeerLost
    const val SWEEP_MS = 5_000L
    const val SEND_TIMEOUT_MS = 15_000L  // conectare+scriere; expirat → false (cade pe releu)
    const val MTU_WAIT_MS = 2_500L       // onMtuChanged se pierde pe unele stive → mergem înainte
    /**
     * Lungimea MAXIMĂ a valorii unei caracteristici GATT (Bluetooth Core Spec) — 512 octeți,
     * INDIFERENT de MTU-ul negociat. Cu MTU 517 „încăpea" o bucată de 514, dar stiva receptorului
     * o taie tăcut la 512 → cadrul [len][blob] nu se mai completează niciodată, iar bucățile
     * mesajului următor se lipesc de resturi = JSON corupt. Bucata NU trece de limita asta.
     */
    const val MAX_ATT_VALUE = 512
    const val RX_STALE_MS = 10_000L      // cadru neterminat mai vechi de atât → aruncat (nu contaminează)
    const val JOB_MAX_TRIES = 2          // reîncercări la eșec de conectare/scriere (stivă sufocată)
    const val JOB_RETRY_MS = 800L        // pauză înainte de reîncercare
    const val JOB_GAP_MS = 250L          // pauză cât recepția e în curs (anti cross-connect)
    const val INBOUND_HOLD_MS = 1_500L   // cât amânăm trimiterile după ultima bucată primită (radio ocupat)
    const val CONN_IDLE_MS = 30_000L     // legătură GATT nefolosită atât → închisă (economie de radio)
    const val CONN_SWEEP_MS = 10_000L    // cât de des verificăm legăturile inactive
    const val PER_CHUNK_MS = 300L        // buget de timp per bucată scrisă (media = sute de bucăți)
    const val WRITE_BUSY_MS = 10L        // stiva are coada plină → reîncearcă bucata peste atât
    const val WRITE_BUSY_MAX = 400       // ~4s de contrapresiune tolerată (plasă, nu regim normal)
    const val WRITE_WINDOW = 4           // scrieri în zbor simultan: umple intervalul fără să sufoce peer-ul
    const val MAX_BLOB = 262_144        // gardă anti-abuz pe recepție (plicurile reale ~1KB)
  }

  private class Peer(var address: String, var lastSeen: Long)
  private class Rx { val buf = ByteArrayOutputStream(); var lastAt = System.currentTimeMillis() }

  /** Cât așteptăm un cadru: media (zeci de KB = sute de scrieri) are nevoie de mult mai mult ca textul. */
  private fun timeoutFor(payloadSize: Int): Long = SEND_TIMEOUT_MS + (payloadSize / MAX_ATT_VALUE) * PER_CHUNK_MS
  private class Job(val did8: String, val payload: ByteArray, val done: (Boolean) -> Unit) { var tries = 0 }

  private val handler = Handler(Looper.getMainLooper())
  private val peers = HashMap<String, Peer>()   // did8 hex → ultimul device văzut
  private val rx = HashMap<String, Rx>()        // adresă device → reasamblare în curs
  private val jobs = ArrayDeque<Job>()          // trimiterile rulează SERIAL (un GATT client odată)
  private var activeJob = false
  // Un peer ne scrie chiar acum → amânăm trimiterile (vezi pump). Termen de expirare, NU comutator:
  // dacă evenimentul de deconectare se pierde, trimiterile s-ar bloca definitiv.
  @Volatile private var inboundUntil = 0L
  private var myDid8 = ByteArray(0)
  private var running = false

  private var advertiser: BluetoothLeAdvertiser? = null
  private var scanner: BluetoothLeScanner? = null
  private var gattServer: BluetoothGattServer? = null
  /** Scanarea e ciclată (fereastră/pauză) — flagul ține evidența, ca să nu dublăm start/stop. */
  private var scanning = false

  // ---------- lifecycle ----------

  fun start(myDid8Hex: String) {
    if (running) return
    val mgr = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = mgr.adapter ?: throw IllegalStateException("fara adaptor Bluetooth")
    if (!adapter.isEnabled) throw IllegalStateException("Bluetooth oprit")
    myDid8 = hexToBytes(myDid8Hex)
    require(myDid8.size == 8) { "did8 invalid" }

    // 1) serverul GATT — pe el scriu peer-ii blob-urile lor
    gattServer = mgr.openGattServer(context, serverCallback)?.also {
      // Igienă: procesul precedent (ucis la update/crash) poate lăsa serviciul înregistrat în stivă.
      // Fără clearServices(), addService pică pe UUID duplicat → peer-ii descoperă serviciul FANTOMĂ
      // și scriu în el „cu succes", dar noi nu primim nimic (mesaje pierdute tăcut).
      try { it.clearServices() } catch (e: Exception) { Log.w(TAG, "clearServices: $e") }
      val svc = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
      svc.addCharacteristic(
        BluetoothGattCharacteristic(
          BLOB_CHAR_UUID,
          // WRITE_NO_RESPONSE = mai multe pachete pe interval de conexiune (media ar dura altfel
          // zeci de secunde: fiecare bucată de 512o aștepta confirmare ATT ≈ un interval întreg).
          // Fiabilitatea rămâne: legătura BLE confirmă la nivel de link, iar cadrul corupt/pierdut
          // e prins de parserul de flux + JSON și retrimis de outbox.
          BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
          BluetoothGattCharacteristic.PERMISSION_WRITE
        )
      )
      if (!it.addService(svc)) Log.e(TAG, "addService a EȘUAT — recepția BLE nu va funcționa")
    } ?: throw IllegalStateException("openGattServer a esuat")

    // 2) advertising: pachetul principal = UUID-ul serviciului (31 octeți e strâmt);
    //    did8-ul merge în SCAN RESPONSE ca service data (scanarea activă îl citește).
    advertiser = adapter.bluetoothLeAdvertiser ?: throw IllegalStateException("fara advertiser BLE")
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .build()
    val adv = AdvertiseData.Builder().addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val scanResp = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceData(ParcelUuid(SERVICE_UUID), myDid8)
      .build()
    advertiser!!.startAdvertising(settings, adv, scanResp, advCallback)
    Log.i(TAG, "start: did8=$myDid8Hex, gattServer+advertising cerute")

    // 3) scanner cu filtru pe serviciul Blink — vedem doar alți useri Blink
    scanner = adapter.bluetoothLeScanner ?: throw IllegalStateException("fara scanner BLE")

    running = true
    handler.post(scanCycle) // scanarea pornește în ferestre, nu continuu (vezi SCAN_WINDOW_MS)
    handler.postDelayed(sweep, SWEEP_MS)
    handler.postDelayed(idleSweep, CONN_SWEEP_MS)
  }

  @SuppressLint("MissingPermission")
  private fun startScanNow() {
    if (scanning || !running) return
    val s = scanner ?: return
    // două filtre (OR): UUID de serviciu (formatul normal) + service data (formatul compact de fallback)
    val filters = listOf(
      ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build(),
      ScanFilter.Builder().setServiceData(ParcelUuid(SERVICE_UUID), ByteArray(0)).build(),
    )
    val scanSettings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build()
    try {
      s.startScan(filters, scanSettings, scanCallback)
      scanning = true
    } catch (e: Exception) {
      Log.w(TAG, "startScan a esuat: ${e.message}")
    }
  }

  @SuppressLint("MissingPermission")
  private fun stopScanNow() {
    if (!scanning) return
    try { scanner?.stopScan(scanCallback) } catch (_: Exception) {}
    scanning = false
  }

  /**
   * Alternează fereastra de ascultare cu pauza. Cât timp există o legătură GATT (transfer în curs),
   * scanarea e OPRITĂ complet: nu ne trebuie — peer-ul e deja găsit — iar scanarea fură din același
   * radio, încetinind exact transferul pe care-l face.
   */
  /** Deschide o fereastră de ascultare imediat (cineva vrea să trimită unui peer încă nevăzut). */
  private fun wakeScan() {
    if (!running || scanning || conns.isNotEmpty()) return
    handler.removeCallbacks(scanCycle)
    startScanNow()
    handler.postDelayed(scanCycle, SCAN_WINDOW_MS)
  }

  private val scanCycle = object : Runnable {
    override fun run() {
      if (!running) return
      if (conns.isNotEmpty()) {
        stopScanNow()
        handler.postDelayed(this, SCAN_IDLE_MS)
        return
      }
      if (scanning) {
        stopScanNow()
        handler.postDelayed(this, SCAN_IDLE_MS)
      } else {
        startScanNow()
        handler.postDelayed(this, SCAN_WINDOW_MS)
      }
    }
  }

  fun stop() {
    running = false
    handler.removeCallbacks(scanCycle)
    stopScanNow()
    try { advertiser?.stopAdvertising(advCallback) } catch (_: Exception) {}
    try { advertiser?.stopAdvertising(advCallbackCompact) } catch (_: Exception) {}
    try { gattServer?.close() } catch (_: Exception) {}
    scanner = null; advertiser = null; gattServer = null
    handler.removeCallbacks(sweep)
    handler.removeCallbacks(idleSweep)
    for (d in conns.keys.toList()) dropConn(d, "motor oprit") // închide legăturile ținute vii
    synchronized(peers) { peers.clear() }
    synchronized(rx) { rx.clear() }
    while (true) { (jobs.pollFirst() ?: break).done(false) } // trimiterile în așteptare = eșec curat
    activeJob = false
  }

  // ---------- descoperire ----------

  private val advCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
      Log.i(TAG, "advertising PORNIT (mode=${settingsInEffect.mode})")
    }
    override fun onStartFailure(errorCode: Int) {
      // 1=DATA_TOO_LARGE 2=TOO_MANY_ADVERTISERS 3=ALREADY_STARTED 4=INTERNAL_ERROR 5=FEATURE_UNSUPPORTED
      Log.e(TAG, "advertising EȘUAT: errorCode=$errorCode — peer-ii NU ne pot vedea")
      // fallback: fără scan response (unele stive resping combinația) — did8 mutat în pachetul principal
      if (errorCode == ADVERTISE_FAILED_DATA_TOO_LARGE || errorCode == ADVERTISE_FAILED_INTERNAL_ERROR) {
        handler.post { retryAdvertisingCompact() }
      }
    }
  }

  /** Reîncearcă advertising cu did8 ca service data în PACHETUL PRINCIPAL (fără scan response). */
  private fun retryAdvertisingCompact() {
    if (!running || advertiser == null) return
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .build()
    val adv = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceData(ParcelUuid(SERVICE_UUID), myDid8)
      .build()
    try {
      advertiser?.startAdvertising(settings, adv, null, advCallbackCompact)
      Log.i(TAG, "advertising retry COMPACT cerut (service data în pachetul principal)")
    } catch (e: Exception) {
      Log.e(TAG, "advertising retry compact a aruncat: $e")
    }
  }

  private val advCallbackCompact = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
      Log.i(TAG, "advertising COMPACT pornit")
    }
    override fun onStartFailure(errorCode: Int) {
      Log.e(TAG, "advertising COMPACT eșuat: errorCode=$errorCode — device-ul nu poate anunța")
    }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val data = result.scanRecord?.getServiceData(ParcelUuid(SERVICE_UUID))
      if (data == null) {
        Log.d(TAG, "scan: ${result.device.address} rssi=${result.rssi} FĂRĂ service data (scan response nesosit?)")
        return
      }
      if (data.size != 8 || data.contentEquals(myDid8)) return
      val hex = bytesToHex(data)
      val isNew = synchronized(peers) {
        val existed = peers.containsKey(hex)
        // MAC-ul e randomizat de Android (~15 min) → ținem mereu ULTIMA adresă văzută
        peers[hex] = Peer(result.device.address, System.currentTimeMillis())
        !existed
      }
      if (isNew) {
        Log.i(TAG, "peer NOU văzut: did8=$hex addr=${result.device.address} rssi=${result.rssi}")
        emit("onPeerSeen", mapOf("did8" to hex))
      }
    }
  }

  private val sweep = object : Runnable {
    override fun run() {
      if (!running) return
      val now = System.currentTimeMillis()
      val lost = ArrayList<String>()
      synchronized(peers) {
        val it = peers.entries.iterator()
        while (it.hasNext()) {
          val e = it.next()
          if (now - e.value.lastSeen > PEER_TTL_MS) { lost.add(e.key); it.remove() }
        }
      }
      for (d in lost) {
        Log.i(TAG, "peer PIERDUT (TTL): did8=$d")
        dropConn(d, "peer ieșit din rază") // nu ține radioul deschis spre cineva care nu mai e acolo
        emit("onPeerLost", mapOf("did8" to d))
      }
      handler.postDelayed(this, SWEEP_MS)
    }
  }

  // ---------- recepție (server GATT) ----------

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService) {
      // status 0 = GATT_SUCCESS. Orice altceva = nu putem primi nimic prin BLE (serviciu neînregistrat).
      if (status == BluetoothGatt.GATT_SUCCESS) Log.i(TAG, "serviciul GATT înregistrat — recepție ARMATĂ")
      else Log.e(TAG, "înregistrare serviciu GATT EȘUATĂ: status=$status (fantomă în stivă?)")
    }

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      // Curăță reasamblarea ȘI la conectare: un transfer întrerupt (peer deconectat la mijloc, apoi
      // revenit) lăsa octeți orfani în buffer → următorul blob se lipea de ei → JSON corupt = mesaj
      // pierdut tăcut (JSON.parse eșuează în JS, plicul nu ajunge niciodată la decriptare).
      synchronized(rx) { rx.remove(device.address) }
      // Cine ne scrie ACUM = conexiune în curs pe radio. Dacă deschidem simultan și noi una spre el
      // (ack-ul care pleacă înapoi), stiva se sufocă → MTU fără răspuns + scriere respinsă.
      inboundUntil =
        if (newState == BluetoothProfile.STATE_CONNECTED) System.currentTimeMillis() + INBOUND_HOLD_MS else 0L
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
    ) {
      if (characteristic.uuid == BLOB_CHAR_UUID && value != null && !preparedWrite) handleRx(device.address, value)
      if (responseNeeded) {
        try { gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null) } catch (_: Exception) {}
      }
    }
  }

  /**
   * Reasamblare ca PARSER DE FLUX, nu „un cadru pe conexiune".
   * Pe legătura ținută vie, cadrele curg unul după altul (o poză = zeci de cadre în rafală), iar
   * ultima bucată a unui cadru poate conține deja începutul următorului. Varianta veche extrăgea
   * un cadru și ARUNCA surplusul → înghițea capul cadrului următor → octeții din mijlocul plicului
   * erau citiți ca lungime („lungime invalidă (879709773)") → tot fluxul se desincroniza.
   * Acum: extragem TOATE cadrele complete din buffer și PĂSTRĂM restul pentru bucata următoare.
   */
  private fun handleRx(addr: String, chunk: ByteArray) {
    val out = ArrayList<ByteArray>()
    synchronized(rx) {
      val r = rx.getOrPut(addr) { Rx() }
      // Flux mort de mult (peer dispărut la mijlocul unui cadru) → resturile ar corupe ce urmează.
      if (r.buf.size() > 0 && System.currentTimeMillis() - r.lastAt > RX_STALE_MS) {
        Log.w(TAG, "RX: flux abandonat (${r.buf.size()}o rămași) de la $addr")
        r.buf.reset()
      }
      r.lastAt = System.currentTimeMillis()
      r.buf.write(chunk)
      // Recepție ÎN CURS (o poză = sute de bucăți) → ține trimiterile pe loc: radioul e ocupat,
      // iar o scriere pornită acum stă la coadă până lovește timeout-ul. Se reia singură după rafală.
      inboundUntil = r.lastAt + INBOUND_HOLD_MS

      var data = r.buf.toByteArray()
      var pos = 0
      while (data.size - pos >= 4) {
        val len = ByteBuffer.wrap(data, pos, 4).int
        if (len <= 0 || len > MAX_BLOB) {
          Log.w(TAG, "RX: lungime invalidă în flux ($len) — flux resetat")
          pos = data.size // flux corupt: aruncă tot, peer-ul va retrimite (outbox)
          break
        }
        if (data.size - pos - 4 < len) break // cadru incomplet → așteptăm restul bucăților
        out.add(data.copyOfRange(pos + 4, pos + 4 + len))
        pos += 4 + len
      }
      // păstrează coada neconsumată = începutul cadrului următor
      r.buf.reset()
      if (pos < data.size) r.buf.write(data, pos, data.size - pos)
      data = ByteArray(0)
    }
    for (blob in out) {
      Log.i(TAG, "recepție BLE completă: ${blob.size}o de la $addr")
      emit("onBlob", mapOf("blobB64" to Base64.encodeToString(blob, Base64.NO_WRAP)))
    }
  }

  // ---------- trimitere (client GATT, serial) ----------

  fun send(did8Hex: String, blobB64: String, done: (Boolean) -> Unit) {
    if (!running) { Log.w(TAG, "send: motor oprit"); return done(false) }
    val known = synchronized(peers) { peers.containsKey(did8Hex) }
    if (!known) {
      // Cu scanarea în ferestre, peer-ul poate fi în rază dar încă nedescoperit (suntem în pauză).
      // Trezim radioul ACUM: mesajul pleacă oricum în outbox, iar când scanarea îl vede, onPeerNear
      // declanșează golirea cozii. Fără asta, prima trimitere ar aștepta degeaba până la 24s.
      Log.w(TAG, "send: peer NEcunoscut did8=$did8Hex — trezesc scanarea")
      handler.post { wakeScan() }
      return done(false)
    }
    val blob = try { Base64.decode(blobB64, Base64.NO_WRAP) } catch (_: Exception) { return done(false) }
    if (blob.isEmpty() || blob.size > MAX_BLOB) return done(false)
    val payload = ByteBuffer.allocate(4 + blob.size).putInt(blob.size).put(blob).array()
    Log.i(TAG, "send: blob ${blob.size}o → cadru ${payload.size}o pt did8=$did8Hex")
    handler.post { jobs.add(Job(did8Hex, payload, done)); pump() }
  }

  private fun pump() { // doar pe handler-ul main
    if (activeJob || !running) return
    if (jobs.isEmpty()) return
    // Recepție în curs → amână trimiterea (altfel conexiuni încrucișate = stivă sufocată).
    if (System.currentTimeMillis() < inboundUntil) { handler.postDelayed({ pump() }, JOB_GAP_MS); return }
    val job = jobs.pollFirst() ?: return
    activeJob = true
    runJob(job) { ok ->
      handler.post {
        activeJob = false
        // Reîncercare: la eșec conexiunea cache-uită e deja aruncată, deci a doua încercare
        // reconectează curat (peer repornit, legătură căzută, stivă capricioasă).
        if (!ok && job.tries < JOB_MAX_TRIES && running) {
          job.tries++
          Log.w(TAG, "job did8=${job.did8}: reîncercare ${job.tries}/$JOB_MAX_TRIES peste ${JOB_RETRY_MS}ms")
          handler.postDelayed({ jobs.addFirst(job); pump() }, JOB_RETRY_MS)
          return@post
        }
        job.done(ok)
        pump() // conexiunea rămâne DESCHISĂ → mesajul următor pleacă imediat, fără pauză
      }
    }
  }

  /**
   * Conexiune GATT ținută VIE per peer. Înainte deschideam una nouă la fiecare mesaj și ack
   * (connect → MTU → discover → write → disconnect): după câteva rafale stiva se sufoca și
   * refuza scrierile (MTU fără răspuns, write respins din start) → mesaje blocate la o bifă.
   * Acum: prima trimitere ridică legătura, restul o refolosesc; se închide după IDLE_MS.
   */
  private class Conn(val addr: String) {
    var gatt: BluetoothGatt? = null
    var ch: BluetoothGattCharacteristic? = null
    var chunkSize = 20            // până la negocierea MTU (23 − 3)
    var ready = false             // servicii descoperite + caracteristica găsită
    var setupDone = false         // MTU/discover pornite o dată
    var lastUse = System.currentTimeMillis()
    // trimiterea în curs pe această conexiune
    var payload: ByteArray? = null
    var offset = 0
    var finish: ((Boolean) -> Unit)? = null
    var doneRef: ((Boolean) -> Unit)? = null // închide trimiterea curentă (succes/eșec), o singură dată
    var writing = false                      // gardă: o singură buclă de scriere odată (callback-urile vin de pe alt fir)
    var inFlight = 0                         // scrieri predate stivei și neconfirmate încă (fereastra)
  }

  private val conns = HashMap<String, Conn>() // did8 → legătură vie

  private fun dropConn(did8: String, reason: String) {
    val c = conns.remove(did8) ?: return
    Log.i(TAG, "conexiune închisă cu did8=$did8 ($reason)")
    try { c.gatt?.disconnect(); c.gatt?.close() } catch (_: Exception) {}
    c.finish?.let { f -> c.finish = null; f(false) } // trimiterea în curs eșuează curat
  }

  private val idleSweep = object : Runnable {
    override fun run() {
      if (!running) return
      val now = System.currentTimeMillis()
      for (did8 in conns.keys.toList()) {
        val c = conns[did8] ?: continue
        if (c.finish == null && now - c.lastUse > CONN_IDLE_MS) dropConn(did8, "inactivă")
      }
      handler.postDelayed(this, CONN_SWEEP_MS)
    }
  }

  @Suppress("DEPRECATION")
  private fun runJob(job: Job, finish: (Boolean) -> Unit) {
    val addr = synchronized(peers) { peers[job.did8]?.address } ?: return finish(false)
    val existing = conns[job.did8]
    // Peer-ul și-a schimbat adresa (MAC rotit de Android) → legătura veche nu mai e a lui.
    if (existing != null && existing.addr != addr) dropConn(job.did8, "adresă nouă")

    val c = conns[job.did8]
    if (c != null && c.ready && c.gatt != null) { // REFOLOSIM legătura deschisă
      startWrite(job, c, finish)
      return
    }

    val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
      ?: return finish(false)
    val conn = Conn(addr)
    conns[job.did8] = conn
    conn.payload = job.payload
    conn.offset = 0
    conn.finish = finish

    val timeout = Runnable {
      Log.w(TAG, "job did8=${job.did8}: timeout la conectare/scriere")
      dropConn(job.did8, "timeout")
    }
    handler.postDelayed(timeout, timeoutFor(job.payload.size))

    fun done(ok: Boolean) {
      handler.removeCallbacks(timeout)
      val f = conn.finish ?: return
      conn.finish = null
      conn.payload = null
      conn.lastUse = System.currentTimeMillis()
      Log.i(TAG, "job did8=${job.did8}: ${if (ok) "LIVRAT prin BLE (${job.payload.size}B)" else "eșuat (offset=${conn.offset}/${job.payload.size})"}")
      f(ok)
    }
    conn.doneRef = ::done

    fun proceed(g: BluetoothGatt) { // discoverServices o dată (MTU sau plasa de timeout)
      if (conn.setupDone) return
      conn.setupDone = true
      refreshGattCache(g) // peer-ul poate să-și fi repornit app-ul → handle-uri noi
      if (!g.discoverServices()) { done(false); dropConn(job.did8, "discover a eșuat") }
    }

    val cb = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS || newState == BluetoothProfile.STATE_DISCONNECTED) {
          conn.doneRef?.invoke(false)
          handler.post { dropConn(job.did8, "deconectat (status=$status)") }
        } else if (newState == BluetoothProfile.STATE_CONNECTED) {
          // Interval de conexiune scurt (11-15ms în loc de ~40): de 3-4x mai multe pachete/secundă.
          try { g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH) } catch (_: Exception) {}
          // PHY 2M (Bluetooth 5): radioul urcă de la 1 la 2 Mbit → ~2x debit, zero schimbări de format.
          // Dacă peer-ul/radioul nu-l suportă, stiva rămâne pe 1M — degradare curată, nu eroare.
          if (Build.VERSION.SDK_INT >= 26) {
            try { g.setPreferredPhy(BluetoothDevice.PHY_LE_2M_MASK, BluetoothDevice.PHY_LE_2M_MASK, BluetoothDevice.PHY_OPTION_NO_PREFERRED) } catch (_: Exception) {}
          }
          // onMtuChanged se PIERDE pe unele stive (ColorOS/MTK) → plasă: după MTU_WAIT_MS
          // mergem înainte cu chunk-ul implicit (20o — mai lent, dar livrează).
          if (!g.requestMtu(517)) proceed(g)
          else handler.postDelayed({ if (!conn.setupDone && conns[job.did8] === conn) proceed(g) }, MTU_WAIT_MS)
        }
      }
      override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
        // plafonat la MAX_ATT_VALUE: peste 512o scrierea e trunchiată de stiva receptorului
        if (!conn.setupDone) conn.chunkSize = minOf((if (status == BluetoothGatt.GATT_SUCCESS) mtu else 23) - 3, MAX_ATT_VALUE)
        Log.i(TAG, "did8=${job.did8}: MTU=$mtu (chunk=${conn.chunkSize})")
        proceed(g)
      }
      override fun onPhyUpdate(g: BluetoothGatt, txPhy: Int, rxPhy: Int, status: Int) {
        // 2 = PHY_LE_2M (BluetoothDevice.PHY_LE_2M); 1 = 1M (peer/radio fără suport)
        Log.i(TAG, "did8=${job.did8}: PHY tx=$txPhy rx=$rxPhy ${if (txPhy == BluetoothDevice.PHY_LE_2M) "(2M ✓)" else "(1M)"}")
      }
      override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
        val ch = g.getService(SERVICE_UUID)?.getCharacteristic(BLOB_CHAR_UUID)
        if (ch == null) {
          Log.w(TAG, "did8=${job.did8}: serviciul Blink LIPSEȘTE (status=$status) — peer repornit?")
          conn.doneRef?.invoke(false)
          handler.post { dropConn(job.did8, "serviciu absent") }
          return
        }
        conn.ch = ch
        conn.ready = true
        writeChunk(job.did8, conn)
      }
      override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
          conn.doneRef?.invoke(false)
          handler.post { dropConn(job.did8, "scriere respinsă (status=$status)") }
        } else handler.post { // un credit s-a eliberat → mai împinge o bucată
          if (conn.inFlight > 0) conn.inFlight--
          writeChunk(job.did8, conn)
        }
      }
    }

    conn.gatt = try { adapter.getRemoteDevice(addr).connectGatt(context, false, cb, BluetoothDevice.TRANSPORT_LE) } catch (_: Exception) { null }
    if (conn.gatt == null) { done(false); dropConn(job.did8, "connectGatt a eșuat") }
  }

  /** Trimite un cadru nou pe o legătură DEJA deschisă (fără connect/discover/MTU). */
  private fun startWrite(job: Job, c: Conn, finish: (Boolean) -> Unit) {
    c.payload = job.payload
    c.offset = 0
    c.inFlight = 0 // fereastra repornește curat la fiecare cadru
    c.finish = finish
    c.lastUse = System.currentTimeMillis()
    val timeout = Runnable { Log.w(TAG, "job did8=${job.did8}: timeout pe legătura deschisă"); dropConn(job.did8, "timeout scriere") }
    handler.postDelayed(timeout, timeoutFor(job.payload.size))
    c.doneRef = { ok ->
      handler.removeCallbacks(timeout)
      val f = c.finish
      if (f != null) {
        c.finish = null
        c.payload = null
        c.lastUse = System.currentTimeMillis()
        Log.i(TAG, "job did8=${job.did8}: ${if (ok) "LIVRAT prin BLE (${job.payload.size}B, legătură reutilizată)" else "eșuat (offset=${c.offset}/${job.payload.size})"}")
        f(ok)
      }
    }
    writeChunk(job.did8, c)
  }

  /**
   * PIPELINING CU FEREASTRĂ (control de flux prin credite).
   * Scrierea „una și așteaptă callback-ul" lăsa radioul gol între intervale (lent). Împinsul până
   * la refuz satura receptorul: coada stivei se umplea și NU se mai elibera deloc (cadrul media
   * murea constant pe la ~80KB). Mijlocul de aur: ținem cel mult WRITE_WINDOW scrieri în zbor —
   * destul cât să umplem fiecare interval de conexiune, nu atât cât să înfundăm peer-ul.
   * Rulează SERIAL pe handler-ul main (garda `writing`), deși callback-urile vin de pe alt fir.
   */
  @Suppress("DEPRECATION")
  private fun writeChunk(did8: String, c: Conn, busyTries: Int = 0) {
    if (c.writing) return
    val payload = c.payload ?: return
    val g = c.gatt ?: return
    val ch = c.ch ?: return
    c.writing = true
    try {
      while (c.offset < payload.size && c.inFlight < WRITE_WINDOW) {
        val n = minOf(c.chunkSize, payload.size - c.offset)
        val part = payload.copyOfRange(c.offset, c.offset + n)
        val ok = if (Build.VERSION.SDK_INT >= 33) {
          g.writeCharacteristic(ch, part, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) == BluetoothStatusCodes.SUCCESS
        } else {
          ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
          ch.value = part
          g.writeCharacteristic(ch)
        }
        if (!ok) { // stivă plină → nu e eroare, e contrapresiune: reluăm când se eliberează
          if (busyTries >= WRITE_BUSY_MAX) {
            c.doneRef?.invoke(false)
            handler.post { dropConn(did8, "stiva refuză scrierile (coadă plină)") }
            return
          }
          handler.postDelayed({ if (c.payload === payload) writeChunk(did8, c, busyTries + 1) }, WRITE_BUSY_MS)
          return
        }
        c.offset += n
        c.inFlight++
      }
    } finally { c.writing = false }
    if (c.offset >= payload.size && c.inFlight == 0) c.doneRef?.invoke(true) // tot cadrul a plecat
  }

  // ---------- util ----------

  /**
   * Invalidează cache-ul GATT al Android-ului pentru device-ul conectat (API ascuns, prin reflexie).
   * OBLIGATORIU aici: serverul GATT al peer-ului se RE-ÎNREGISTREAZĂ la fiecare repornire a app-ului
   * (handle-uri noi), dar Android păstrează baza de servicii descoperită anterior → scrierile pleacă
   * pe handle-uri moarte, raportate ca succes, și nu ajung niciodată în app → mesaje „livrate" pierdute.
   */
  private fun refreshGattCache(gatt: BluetoothGatt): Boolean = try {
    val m = gatt.javaClass.getMethod("refresh")
    (m.invoke(gatt) as? Boolean) ?: false
  } catch (e: Exception) {
    Log.w(TAG, "refresh() indisponibil: $e")
    false
  }

  private fun hexToBytes(hex: String): ByteArray {
    val clean = hex.trim().lowercase()
    require(clean.length % 2 == 0 && clean.matches(Regex("^[0-9a-f]*$"))) { "hex invalid" }
    return ByteArray(clean.length / 2) { i -> clean.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
  }

  private fun bytesToHex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }
}
