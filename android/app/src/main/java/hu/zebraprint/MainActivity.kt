package hu.zebraprint

import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import java.net.InetSocketAddress
import java.net.Socket

class MainActivity : AppCompatActivity() {

    private val ZQ_WIDTH = 576
    private val DPMM = 8
    private val IP_PREFIX = "192.168.102."
    private val DEFAULT_SERVER = "https://zkpzebra.duckdns.org"

    private lateinit var prefs: android.content.SharedPreferences

    // Képernyők
    private lateinit var screenMain: View
    private lateinit var screenInvoice: View
    private lateinit var screenQr: View
    private lateinit var screenText: View
    private lateinit var screenTest: View
    private lateinit var screenSettings: View

    // Főoldal
    private lateinit var editTopInput: EditText
    private lateinit var tvTopStatus: TextView

    // Számlacímke
    private lateinit var checkTestMode: android.widget.CheckBox
    private lateinit var editIpZqInvoice: EditText
    private lateinit var editInvoiceNum: EditText
    private lateinit var statusInvoice: TextView
    private lateinit var tvRecentLabel: android.widget.TextView
    private lateinit var layoutRecentInvoices: android.widget.LinearLayout

    // QR
    private lateinit var editIpZqQr: EditText
    private lateinit var editQrData: EditText
    private lateinit var radioPlacement: RadioGroup
    private lateinit var statusQr: TextView

    // Egyedi szöveg
    private lateinit var editIpZqText: EditText
    private lateinit var editFreeText: EditText
    private lateinit var statusFreeText: TextView

    // Beállítások
    private lateinit var editServerUrl: EditText
    private lateinit var radioZqLang: RadioGroup
    private lateinit var statusSettings: android.widget.TextView

    // Tesztoldal
    private lateinit var editIpZd: EditText
    private lateinit var widthGroup: RadioGroup
    private lateinit var editTestHeight: EditText
    private lateinit var directionGroup: RadioGroup
    private lateinit var editLeftMargin: EditText
    private lateinit var statusTest: TextView

    private enum class TextPlacement { NONE, BELOW, LEFT, RIGHT }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences("zebra", Context.MODE_PRIVATE)

        initViews()
        loadSaved()
        setupListeners()
        showScreen("main")
    }

    private fun initViews() {
        screenMain = findViewById(R.id.screenMain)
        screenInvoice = findViewById(R.id.screenInvoice)
        screenQr = findViewById(R.id.screenQr)
        screenText = findViewById(R.id.screenText)
        screenTest = findViewById(R.id.screenTest)
        screenSettings = findViewById(R.id.screenSettings)

        editServerUrl = findViewById(R.id.editServerUrl)
        radioZqLang = findViewById(R.id.radioZqLang)
        statusSettings = findViewById(R.id.statusSettings)

        editTopInput = findViewById(R.id.editTopInput)
        tvTopStatus = findViewById(R.id.tvTopStatus)

        checkTestMode = findViewById(R.id.checkTestMode)
        editIpZqInvoice = findViewById(R.id.editIpZqInvoice)
        editInvoiceNum = findViewById(R.id.editInvoiceNum)
        statusInvoice = findViewById(R.id.statusInvoice)
        tvRecentLabel = findViewById(R.id.tvRecentLabel)
        layoutRecentInvoices = findViewById(R.id.layoutRecentInvoices)

        editIpZqQr = findViewById(R.id.editIpZqQr)
        editQrData = findViewById(R.id.editQrData)
        radioPlacement = findViewById(R.id.radioPlacement)
        statusQr = findViewById(R.id.statusQr)

        editIpZqText = findViewById(R.id.editIpZqText)
        editFreeText = findViewById(R.id.editFreeText)
        statusFreeText = findViewById(R.id.statusFreeText)

        editIpZd = findViewById(R.id.editIpZd)
        widthGroup = findViewById(R.id.widthGroup)
        editTestHeight = findViewById(R.id.editTestHeight)
        directionGroup = findViewById(R.id.directionGroup)
        editLeftMargin = findViewById(R.id.editLeftMargin)
        statusTest = findViewById(R.id.statusTest)
    }

    private fun loadSaved() {
        val ipZq = prefs.getString("ip_zq", "") ?: ""
        editIpZqInvoice.setText(ipZq)
        editIpZqQr.setText(ipZq)
        editIpZqText.setText(ipZq)
        editIpZd.setText(prefs.getString("ip_zd", "") ?: "")
        editLeftMargin.setText(prefs.getInt("left_margin", 0).toString())
        if (prefs.getString("zq_lang", "ZPL") == "CPCL") radioZqLang.check(R.id.langCpcl)
        checkTestMode.isChecked = prefs.getBoolean("test_mode", false)
    }

    private fun applyTestMode() {
        val test = checkTestMode.isChecked
        editIpZqInvoice.isEnabled = !test
        editIpZqInvoice.alpha = if (test) 0.4f else 1.0f
    }

    private fun saveZqIp(from: EditText) {
        prefs.edit().putString("ip_zq", from.text.toString().trim()).apply()
        // Szinkronizálás a többi mezőbe
        val v = from.text.toString()
        if (from !== editIpZqInvoice) editIpZqInvoice.setText(v)
        if (from !== editIpZqQr) editIpZqQr.setText(v)
        if (from !== editIpZqText) editIpZqText.setText(v)
    }

    private fun setupListeners() {
        editTopInput.setOnEditorActionListener { _, actionId, event ->
            val isDone = actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            val isEnter = event?.keyCode == android.view.KeyEvent.KEYCODE_ENTER &&
                          event.action == android.view.KeyEvent.ACTION_DOWN
            if (isDone || isEnter) {
                val invoice = editTopInput.text.toString().trim()
                if (invoice.isNotEmpty()) checkInvoiceStatus(invoice)
                true
            } else false
        }

        // Beállítások
        findViewById<Button>(R.id.btnSettings).setOnClickListener {
            val raw = prefs.getString("server_url", "") ?: ""
            editServerUrl.setText(if (raw.isBlank()) DEFAULT_SERVER else raw)
            statusSettings.text = ""
            showScreen("settings")
        }
        findViewById<Button>(R.id.btnBackSettings).setOnClickListener { showScreen("main") }
        findViewById<Button>(R.id.btnSaveSettings).setOnClickListener {
            val url = editServerUrl.text.toString().trim()
            val lang = if (radioZqLang.checkedRadioButtonId == R.id.langCpcl) "CPCL" else "ZPL"
            val testMode = checkTestMode.isChecked
            if (url.isBlank()) {
                prefs.edit().putString("server_url", DEFAULT_SERVER).putString("zq_lang", lang).putBoolean("test_mode", testMode).apply()
                editServerUrl.setText(DEFAULT_SERVER)
                statusSettings.text = "✓ Visszaállítva az alapértelmezettre"
            } else {
                prefs.edit().putString("server_url", url).putString("zq_lang", lang).putBoolean("test_mode", testMode).apply()
                statusSettings.text = "✓ Mentve"
            }
        }
        findViewById<Button>(R.id.btnCheckServer).setOnClickListener {
            checkServerHealth(editServerUrl.text.toString())
        }

        // Tile csempék
        findViewById<Button>(R.id.tileInvoice).setOnClickListener {
            val top = editTopInput.text.toString().trim()
            if (top.isNotEmpty()) editInvoiceNum.setText(top)
            applyTestMode()
            renderRecentInvoices()
            showScreen("invoice")
        }
        findViewById<Button>(R.id.tileQr).setOnClickListener {
            val top = editTopInput.text.toString().trim()
            if (top.isNotEmpty()) editQrData.setText(top)
            showScreen("qr")
        }
        findViewById<Button>(R.id.tileText).setOnClickListener {
            val top = editTopInput.text.toString().trim()
            if (top.isNotEmpty()) editFreeText.setText(top)
            showScreen("text")
        }
        findViewById<Button>(R.id.tileTest).setOnClickListener { showScreen("test") }

        // Vissza gombok
        findViewById<Button>(R.id.btnBackInvoice).setOnClickListener { showScreen("main") }
        findViewById<Button>(R.id.btnBackQr).setOnClickListener { showScreen("main") }
        findViewById<Button>(R.id.btnBackText).setOnClickListener { showScreen("main") }
        findViewById<Button>(R.id.btnBackTest).setOnClickListener { showScreen("main") }

        // Nyomtatás gombok
        findViewById<Button>(R.id.btnPrintInvoice).setOnClickListener { printInvoice() }
        findViewById<Button>(R.id.btnPrintQr).setOnClickListener { printQr() }
        findViewById<Button>(R.id.btnPrintText).setOnClickListener { printFreeText() }
        findViewById<Button>(R.id.btnPrintTest).setOnClickListener { printTestPage() }
        findViewById<Button>(R.id.btnSaveMargin).setOnClickListener { saveMarginToPrinter() }
    }

    private fun showScreen(name: String) {
        screenMain.visibility = if (name == "main") View.VISIBLE else View.GONE
        screenInvoice.visibility = if (name == "invoice") View.VISIBLE else View.GONE
        screenQr.visibility = if (name == "qr") View.VISIBLE else View.GONE
        screenText.visibility = if (name == "text") View.VISIBLE else View.GONE
        screenTest.visibility = if (name == "test") View.VISIBLE else View.GONE
        screenSettings.visibility = if (name == "settings") View.VISIBLE else View.GONE
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val inSub = listOf(screenInvoice, screenQr, screenText, screenTest, screenSettings)
            .any { it.visibility == View.VISIBLE }
        if (inSub) showScreen("main") else super.onBackPressed()
    }

    // ──────────────── Számlacímke ────────────────

    private fun printInvoice() {
        val invoice = editInvoiceNum.text.toString().trim()
        if (invoice.isEmpty()) { toast("Add meg a számlaszámot!"); return }
        if (hasAccents(invoice)) { toast("Ékezetes karakter nem nyomtatható!"); return }
        val testMode = checkTestMode.isChecked

        if (testMode) {
            // Teszt1: csak adatbázisba menti, nem nyomtat
            statusInvoice.text = "Teszt1: mentés folyamatban..."
            registerInvoiceOnServer(invoice, onSuccess = {
                runOnUiThread {
                    statusInvoice.text = "✓ Teszt1: adatbázisba mentve"
                    addToRecent(invoice)
                }
            }, onAlreadyExists = {
                runOnUiThread {
                    statusInvoice.text = "✓ Teszt1: számla már rögzítve volt"
                    addToRecent(invoice)
                }
            })
            editTopInput.text.clear()
            editInvoiceNum.text.clear()
            return
        }

        val ip = buildIp(editIpZqInvoice.text.toString()) ?: run { toast("Add meg a ZQ310 számát!"); return }
        saveZqIp(editIpZqInvoice)

        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setText("1")
            gravity = android.view.Gravity.CENTER
            setPadding(56, 28, 56, 8)
        }
        android.app.AlertDialog.Builder(this)
            .setTitle("Hány példányt nyomtasson?")
            .setMessage("Számlaszám: $invoice")
            .setView(input)
            .setPositiveButton("Nyomtatás") { _, _ ->
                val copies = input.text.toString().toIntOrNull()?.coerceIn(1, 99) ?: 1
                val cmd = if (isZqCpcl()) buildQrCpcl(invoice, TextPlacement.BELOW) else buildQrZpl(invoice, TextPlacement.BELOW)
                statusInvoice.text = "Küldés ($copies db)..."
                repeat(copies) { sendToPrinter(ip, cmd, statusInvoice) }
                registerInvoiceOnServer(invoice)
                addToRecent(invoice)
                editTopInput.text.clear()
                editInvoiceNum.text.clear()
            }
            .setNegativeButton("Mégse", null)
            .show()
        input.requestFocus()
    }

    // ──────────────── QR kód ────────────────

    private fun printQr() {
        val ip = buildIp(editIpZqQr.text.toString()) ?: run { toast("Add meg a ZQ310 számát!"); return }
        val data = editQrData.text.toString().trim()
        if (data.isEmpty()) { toast("Add meg a QR kód tartalmát!"); return }
        if (hasAccents(data)) { toast("Ékezetes karakter nem nyomtatható!"); return }
        saveZqIp(editIpZqQr)

        val placement = when (radioPlacement.checkedRadioButtonId) {
            R.id.placeNone  -> TextPlacement.NONE
            R.id.placeLeft  -> TextPlacement.LEFT
            R.id.placeRight -> TextPlacement.RIGHT
            else            -> TextPlacement.BELOW
        }
        val cmd = if (isZqCpcl()) buildQrCpcl(data, placement) else buildQrZpl(data, placement)
        sendToPrinter(ip, cmd, statusQr)
    }

    // ──────────────── Egyedi szöveg ────────────────

    private fun printFreeText() {
        val ip = buildIp(editIpZqText.text.toString()) ?: run { toast("Add meg a ZQ310 számát!"); return }
        val text = editFreeText.text.toString().trim()
        if (text.isEmpty()) { toast("Add meg a szöveget!"); return }
        if (hasAccents(text)) { toast("Ékezetes karakter nem nyomtatható!"); return }
        saveZqIp(editIpZqText)

        val cmd = if (isZqCpcl()) {
            buildFreeTextCpcl(text)
        } else {
            val lines = (text.length / 30) + text.count { it == '\n' } + 1
            val labelLen = 80 + lines * 40
            "^XA^PW$ZQ_WIDTH^LL$labelLen^LH0,0" +
            "^FO10,40^FB${ZQ_WIDTH - 20},$lines,8,C,0" +
            "^A0N,34,34^FD${text.replace("\n", "\\&")}^FS^XZ"
        }
        sendToPrinter(ip, cmd, statusFreeText)
    }

    // ──────────────── Tesztoldal ────────────────

    private fun selectedWidthMm(): Int = when (widthGroup.checkedRadioButtonId) {
        R.id.width76 -> 76
        R.id.width57 -> 57
        else         -> 102
    }

    private fun shiftDots(): Int = (editLeftMargin.text.toString().toIntOrNull() ?: 0) * DPMM
    private fun isRightShift(): Boolean = directionGroup.checkedRadioButtonId == R.id.dirRight

    private fun printTestPage() {
        val ipStr = editIpZd.text.toString()
        val ip = buildIp(ipStr) ?: run { toast("Add meg a ZD230d számát!"); return }
        prefs.edit().putString("ip_zd", ipStr.trim()).apply()

        val widthMm = selectedWidthMm()
        val heightMm = editTestHeight.text.toString().toIntOrNull() ?: 50
        val pageW = widthMm * DPMM
        val boxH = heightMm * DPMM
        val shift = shiftDots()
        val rightShift = isRightShift()
        val marginLabel = editLeftMargin.text.toString()
        val dirLabel = if (rightShift) "jobbra" else "balra"

        val top = 40

        val sb = StringBuilder()
        sb.append("^XA^PW$pageW^LL${top + boxH + 16}^LH0,0")

        if (rightShift) {
            val boxX = shift.coerceAtMost(pageW)
            val boxW = (pageW - shift).coerceAtLeast(10)
            val midX = boxX + boxW / 2
            sb.append("^FO$boxX,$top^GB$boxW,$boxH,3^FS")
            sb.append("^FO$midX,$top^GB2,$boxH,2^FS")
            sb.append("^FO$boxX,${top + boxH / 2}^GB$boxW,2,2^FS")
            sb.append("^FO$boxX,${top + boxH / 2 - 50}^FB$boxW,1,0,C,0")
            sb.append("^A0N,28,28^FD${widthMm}mm  $marginLabel mm $dirLabel^FS")
            var mm = 0
            while (mm <= widthMm) {
                val tickX = boxX + mm * DPMM
                if (tickX < pageW) sb.append("^FO$tickX,$top^GB2,24,2^FS")
                mm += 10
            }
        } else {
            val boxW = (pageW - shift).coerceAtLeast(10)
            val midX = (pageW / 2 - shift).coerceAtLeast(0)
            sb.append("^FO0,$top^GB$boxW,$boxH,3^FS")
            sb.append("^FO$midX,$top^GB2,$boxH,2^FS")
            sb.append("^FO0,${top + boxH / 2}^GB$boxW,2,2^FS")
            sb.append("^FO0,${top + boxH / 2 - 50}^FB$boxW,1,0,C,0")
            sb.append("^A0N,28,28^FD${widthMm}mm  $marginLabel mm $dirLabel^FS")
            var mm = 0
            while (mm <= widthMm) {
                val tickX = (mm * DPMM - shift).coerceAtLeast(0)
                if (tickX < pageW) sb.append("^FO$tickX,$top^GB2,24,2^FS")
                mm += 10
            }
        }
        sb.append("^XZ")
        sendToPrinter(ip, sb.toString(), statusTest)
    }

    private fun saveMarginToPrinter() {
        val ipStr = editIpZd.text.toString()
        val ip = buildIp(ipStr) ?: run { toast("Add meg a ZD230d számát!"); return }
        prefs.edit()
            .putString("ip_zd", ipStr.trim())
            .putInt("left_margin", editLeftMargin.text.toString().toIntOrNull() ?: 0)
            .apply()

        val widthMm = selectedWidthMm()
        val pageW = widthMm * DPMM
        val shift = shiftDots()

        val sb = StringBuilder()
        sb.append("^XA^PW$pageW")
        if (isRightShift()) {
            sb.append("^LH$shift,0")  // Jobbra: Label Home eltolás
        } else {
            sb.append("^LS$shift")    // Balra: Label Shift
        }
        sb.append("^JUS^XZ")
        sendToPrinter(ip, sb.toString(), statusTest)
        toast("Beigazítás elmentve a nyomtatóba")
    }

    // ──────────────── ZPL builder ────────────────

    private fun buildQrZpl(data: String, placement: TextPlacement): String {
        val mag = 8
        val modules = 21 + 4 * (data.length / 14)
        val qrSize = modules * mag

        return when (placement) {
            TextPlacement.NONE -> {
                val x = ((ZQ_WIDTH - qrSize) / 2).coerceAtLeast(0)
                "^XA^PW$ZQ_WIDTH^LL${qrSize + 80}^LH0,0^FO$x,40^BQN,2,$mag^FDQA,$data^FS^XZ"
            }
            TextPlacement.BELOW -> {
                val x = ((ZQ_WIDTH - qrSize) / 2).coerceAtLeast(0)
                "^XA^PW$ZQ_WIDTH^LL${qrSize + 160}^LH0,0" +
                "^FO$x,40^BQN,2,$mag^FDQA,$data^FS" +
                "^FO0,${qrSize + 60}^FB$ZQ_WIDTH,2,0,C,0^A0N,30,30^FD$data^FS^XZ"
            }
            TextPlacement.LEFT -> {
                val textW = 170
                val qrX = textW + 12
                val textY = (40 + qrSize / 2 - 30).coerceAtLeast(40)
                "^XA^PW$ZQ_WIDTH^LL${qrSize + 80}^LH0,0" +
                "^FO$qrX,40^BQN,2,$mag^FDQA,$data^FS" +
                "^FO8,$textY^FB$textW,4,0,C,0^A0N,24,24^FD$data^FS^XZ"
            }
            TextPlacement.RIGHT -> {
                val textX = qrSize + 20
                val textW = (ZQ_WIDTH - textX - 8).coerceAtLeast(60)
                val textY = (40 + qrSize / 2 - 30).coerceAtLeast(40)
                "^XA^PW$ZQ_WIDTH^LL${qrSize + 80}^LH0,0" +
                "^FO10,40^BQN,2,$mag^FDQA,$data^FS" +
                "^FO$textX,$textY^FB$textW,4,0,C,0^A0N,24,24^FD$data^FS^XZ"
            }
        }
    }

    private fun isZqCpcl() = prefs.getString("zq_lang", "ZPL") == "CPCL"

    private fun buildQrCpcl(data: String, placement: TextPlacement): String {
        val mag = 7
        val modules = 21 + 4 * (data.length / 14)
        val qrSize = modules * mag
        val qrX = ((ZQ_WIDTH - qrSize) / 2).coerceAtLeast(0)

        return when (placement) {
            TextPlacement.NONE -> {
                "! 0 200 200 ${qrSize + 60} 1\r\n" +
                "BARCODE QR $qrX 10 M 2 U $mag\r\n$data\r\nENDQR\r\n" +
                "FORM\r\nPRINT\r\n"
            }
            TextPlacement.BELOW -> {
                val textY = qrSize + 20
                "! 0 200 200 ${qrSize + 100} 1\r\n" +
                "BARCODE QR $qrX 10 M 2 U $mag\r\n$data\r\nENDQR\r\n" +
                "TEXT 4 0 10 $textY $data\r\n" +
                "FORM\r\nPRINT\r\n"
            }
            TextPlacement.LEFT -> {
                val qrXLeft = 180
                val textY = (10 + qrSize / 2 - 16).coerceAtLeast(10)
                "! 0 200 200 ${qrSize + 60} 1\r\n" +
                "BARCODE QR $qrXLeft 10 M 2 U $mag\r\n$data\r\nENDQR\r\n" +
                "TEXT 4 0 8 $textY $data\r\n" +
                "FORM\r\nPRINT\r\n"
            }
            TextPlacement.RIGHT -> {
                val textX = qrSize + 20
                val textY = (10 + qrSize / 2 - 16).coerceAtLeast(10)
                "! 0 200 200 ${qrSize + 60} 1\r\n" +
                "BARCODE QR 10 10 M 2 U $mag\r\n$data\r\nENDQR\r\n" +
                "TEXT 4 0 $textX $textY $data\r\n" +
                "FORM\r\nPRINT\r\n"
            }
        }
    }

    private fun buildFreeTextCpcl(text: String): String {
        val lines = text.split("\n")
        val lineH = 40
        val labelH = 60 + lines.size * lineH
        val sb = StringBuilder("! 0 200 200 $labelH 1\r\n")
        lines.forEachIndexed { i, line ->
            if (line.isNotEmpty()) sb.append("TEXT 4 0 10 ${20 + i * lineH} $line\r\n")
        }
        sb.append("FORM\r\nPRINT\r\n")
        return sb.toString()
    }

    // ──────────────── Szerver ────────────────

    private fun checkServerHealth(urlInput: String) {
        val raw = urlInput.trim()
        val url = (if (raw.isBlank()) DEFAULT_SERVER else raw).trimEnd('/')
        statusSettings.text = "Ellenőrzés folyamatban..."
        statusSettings.setTextColor(0xFF888888.toInt())
        Thread {
            try {
                val conn = java.net.URL("$url/api/health").openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "GET"
                conn.connectTimeout = 6000
                conn.readTimeout = 6000
                val code = conn.responseCode
                val body = conn.inputStream.bufferedReader().readText()
                conn.disconnect()
                runOnUiThread {
                    if (code == 200) {
                        val invoices = Regex(""""invoices"\s*:\s*(\d+)""").find(body)?.groupValues?.get(1) ?: "?"
                        val version = Regex(""""version"\s*:\s*"([^"]+)"""").find(body)?.groupValues?.get(1) ?: "?"
                        statusSettings.setTextColor(0xFF16A34A.toInt())
                        statusSettings.text = "✓ Szerver elérhető\n✓ Adatbázis OK ($invoices db számla)\n✓ API v$version"
                    } else {
                        statusSettings.setTextColor(0xFFDC2626.toInt())
                        statusSettings.text = "✗ Szerver hibát adott vissza (HTTP $code)"
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    statusSettings.setTextColor(0xFFDC2626.toInt())
                    statusSettings.text = "✗ Nem elérhető:\n${e.message}"
                }
            }
        }.start()
    }

    private fun registerInvoiceOnServer(
        invoice: String,
        onSuccess: (() -> Unit)? = null,
        onAlreadyExists: (() -> Unit)? = null
    ) {
        val raw = prefs.getString("server_url", "") ?: ""
        val url = (if (raw.isBlank()) DEFAULT_SERVER else raw).trimEnd('/')
        Thread {
            try {
                val conn = java.net.URL("$url/api/invoices").openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                conn.doOutput = true
                conn.connectTimeout = 6000
                conn.readTimeout = 6000
                val escaped = invoice.replace("\\", "\\\\").replace("\"", "\\\"")
                conn.outputStream.write("""{"invoice_number":"$escaped"}""".toByteArray(Charsets.UTF_8))
                conn.outputStream.flush()
                val code = conn.responseCode
                conn.disconnect()
                when (code) {
                    200, 201 -> onSuccess?.invoke()
                    409 -> onAlreadyExists?.invoke() // újranyomtatás: nem hiba
                }
            } catch (e: Exception) {
                runOnUiThread { if (onSuccess != null) statusInvoice.text = "✗ Szerver hiba: ${e.message}" }
            }
        }.start()
    }

    // ──────────────── Nyomtató küldés ────────────────

    private fun sendToPrinter(ip: String, data: String, statusView: TextView) {
        statusView.text = "Nyomtatás..."
        Thread {
            try {
                Socket().use { s ->
                    s.connect(InetSocketAddress(ip, 9100), 3000)
                    s.getOutputStream().apply {
                        write(data.toByteArray(Charsets.ISO_8859_1))
                        flush()
                    }
                }
                runOnUiThread { statusView.text = "✓ Elküldve: $ip" }
            } catch (e: Exception) {
                runOnUiThread { statusView.text = "✗ Hiba: ${e.message}" }
            }
        }.start()
    }

    // ──────────────── Nemrég nyomtatott számlák ────────────────

    private fun loadRecentInvoices(): MutableList<String> {
        val raw = prefs.getString("recent_invoices", "") ?: ""
        return if (raw.isEmpty()) mutableListOf() else raw.split("|").filter { it.isNotEmpty() }.toMutableList()
    }

    private fun saveRecentInvoices(list: List<String>) {
        prefs.edit().putString("recent_invoices", list.joinToString("|")).apply()
    }

    private fun addToRecent(invoice: String) {
        val list = loadRecentInvoices()
        list.remove(invoice)
        list.add(0, invoice)
        saveRecentInvoices(list.take(8))
        renderRecentInvoices()
    }

    private fun renderRecentInvoices() {
        val list = loadRecentInvoices()
        layoutRecentInvoices.removeAllViews()
        if (list.isEmpty()) {
            tvRecentLabel.visibility = View.GONE
            return
        }
        tvRecentLabel.visibility = View.VISIBLE

        val dp = resources.displayMetrics.density
        list.forEach { inv ->
            val row = android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                layoutParams = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = (6 * dp).toInt() }
                setBackgroundResource(R.drawable.input_bg)
                setPadding((14 * dp).toInt(), (10 * dp).toInt(), (6 * dp).toInt(), (10 * dp).toInt())
            }

            val tvInv = android.widget.TextView(this).apply {
                text = inv
                textSize = 16f
                setTextColor(0xFF1A1A2E.toInt())
                layoutParams = android.widget.LinearLayout.LayoutParams(
                    0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f
                )
                setOnClickListener {
                    editInvoiceNum.setText(inv)
                    editInvoiceNum.setSelection(inv.length)
                }
            }

            val btnX = android.widget.Button(this).apply {
                text = "✕"
                textSize = 14f
                setTextColor(0xFFEF4444.toInt())
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                layoutParams = android.widget.LinearLayout.LayoutParams(
                    (44 * dp).toInt(), (44 * dp).toInt()
                )
                setPadding(0, 0, 0, 0)
                setOnClickListener {
                    val updated = loadRecentInvoices()
                    updated.remove(inv)
                    saveRecentInvoices(updated)
                    renderRecentInvoices()
                }
            }

            row.addView(tvInv)
            row.addView(btnX)
            layoutRecentInvoices.addView(row)
        }
    }

    private fun checkInvoiceStatus(invoice: String) {
        editTopInput.text.clear()
        tvTopStatus.visibility = View.VISIBLE
        tvTopStatus.text = "Keresés..."
        tvTopStatus.setTextColor(0xFF888888.toInt())

        val raw = prefs.getString("server_url", "") ?: ""
        val url = (if (raw.isBlank()) DEFAULT_SERVER else raw).trimEnd('/')
        val encoded = java.net.URLEncoder.encode(invoice, "UTF-8")

        Thread {
            try {
                val conn = java.net.URL("$url/api/invoices/$encoded/status")
                    .openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "GET"
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                val code = conn.responseCode
                val body = (if (code == 200) conn.inputStream else conn.errorStream)
                    .bufferedReader().readText()
                conn.disconnect()
                runOnUiThread {
                    if (code == 200) {
                        val status = Regex(""""status"\s*:\s*"([^"]+)"""")
                            .find(body)?.groupValues?.get(1) ?: "?"
                        val color = when (status) {
                            "Nyomtatva"          -> 0xFF4361EE.toInt()
                            "Feldolgozás alatt"  -> 0xFFD97706.toInt()
                            "Elpakolható"        -> 0xFFF59E0B.toInt()
                            "Elpakolva"          -> 0xFF16A34A.toInt()
                            "Kiadva"             -> 0xFF15803D.toInt()
                            else                 -> 0xFF888888.toInt()
                        }
                        tvTopStatus.setTextColor(color)
                        tvTopStatus.text = "$invoice\n$status"
                    } else {
                        tvTopStatus.setTextColor(0xFFEF4444.toInt())
                        tvTopStatus.text = "$invoice\nNem található"
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    tvTopStatus.setTextColor(0xFFEF4444.toInt())
                    tvTopStatus.text = "Szerver hiba: ${e.message}"
                }
            }
        }.start()
    }

    private fun hasAccents(text: String): Boolean = text.any { it.code > 127 }

    private fun buildIp(lastOctet: String): String? {
        val n = lastOctet.trim().toIntOrNull() ?: return null
        if (n < 1 || n > 254) return null
        return IP_PREFIX + n
    }

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()
}
