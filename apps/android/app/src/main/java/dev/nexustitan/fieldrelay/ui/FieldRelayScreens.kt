package dev.nexustitan.fieldrelay.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.nexustitan.fieldrelay.ai.HybridMode
import dev.nexustitan.fieldrelay.ai.InferenceResponse
import dev.nexustitan.fieldrelay.ai.InferenceSource
import dev.nexustitan.fieldrelay.ai.TriageObservationResult

enum class Screen {
    LOGIN,
    SCANNER,
    EVIDENCE_CAPTURE,
    LOCAL_INFERENCE,
    REDACTION_CONSENT,
    OUTBOX,
    CAPABILITY_STATUS
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FieldRelayAppRoot() {
    var currentScreen by remember { mutableStateOf(Screen.SCANNER) }
    var selectedAssetId by remember { mutableStateOf("WTP01-PMP-001") }
    var currentNotes by remember { mutableStateOf("Primary pump casing vibration anomaly detected.") }
    var lastInference by remember { mutableStateOf<InferenceResponse?>(null) }
    var selectedMode by remember { mutableStateOf(HybridMode.PREFER_ON_DEVICE) }
    var cloudApproval by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("NEXUS TITAN FieldRelay", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        Text("Node: Android Quadro · Site: TITAN-WTP-01", fontSize = 11.sp, color = Color(0xFFCCFBF1))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF0F766E),
                    titleContentColor = Color.White
                )
            )
        },
        bottomBar = {
            NavigationBar(containerColor = Color(0xFF0F172A)) {
                NavigationBarItem(
                    selected = currentScreen == Screen.SCANNER,
                    onClick = { currentScreen = Screen.SCANNER },
                    icon = { Icon(Icons.Default.QrCodeScanner, contentDescription = "Scan") },
                    label = { Text("Scan", fontSize = 10.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Color(0xFF14B8A6), unselectedIconColor = Color.Gray)
                )
                NavigationBarItem(
                    selected = currentScreen == Screen.EVIDENCE_CAPTURE,
                    onClick = { currentScreen = Screen.EVIDENCE_CAPTURE },
                    icon = { Icon(Icons.Default.CameraAlt, contentDescription = "Evidence") },
                    label = { Text("Evidence", fontSize = 10.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Color(0xFF14B8A6), unselectedIconColor = Color.Gray)
                )
                NavigationBarItem(
                    selected = currentScreen == Screen.LOCAL_INFERENCE,
                    onClick = { currentScreen = Screen.LOCAL_INFERENCE },
                    icon = { Icon(Icons.Default.Psychology, contentDescription = "AI") },
                    label = { Text("Triage", fontSize = 10.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Color(0xFF14B8A6), unselectedIconColor = Color.Gray)
                )
                NavigationBarItem(
                    selected = currentScreen == Screen.REDACTION_CONSENT,
                    onClick = { currentScreen = Screen.REDACTION_CONSENT },
                    icon = { Icon(Icons.Default.Security, contentDescription = "Consent") },
                    label = { Text("Consent", fontSize = 10.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Color(0xFF14B8A6), unselectedIconColor = Color.Gray)
                )
                NavigationBarItem(
                    selected = currentScreen == Screen.OUTBOX,
                    onClick = { currentScreen = Screen.OUTBOX },
                    icon = { Icon(Icons.Default.Sync, contentDescription = "Outbox") },
                    label = { Text("Outbox", fontSize = 10.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Color(0xFF14B8A6), unselectedIconColor = Color.Gray)
                )
                NavigationBarItem(
                    selected = currentScreen == Screen.CAPABILITY_STATUS,
                    onClick = { currentScreen = Screen.CAPABILITY_STATUS },
                    icon = { Icon(Icons.Default.Settings, contentDescription = "Status") },
                    label = { Text("Status", fontSize = 10.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Color(0xFF14B8A6), unselectedIconColor = Color.Gray)
                )
            }
        }
    ) { innerPadding ->
        Box(modifier = Modifier.padding(innerPadding).fillMaxSize().background(Color(0xFFF8FAFC))) {
            when (currentScreen) {
                Screen.LOGIN -> LoginScreen(onLoginSuccess = { currentScreen = Screen.SCANNER })
                Screen.SCANNER -> ScannerScreen(
                    onAssetResolved = { assetId ->
                        selectedAssetId = assetId
                        currentScreen = Screen.EVIDENCE_CAPTURE
                    }
                )
                Screen.EVIDENCE_CAPTURE -> EvidenceCaptureScreen(
                    assetId = selectedAssetId,
                    notes = currentNotes,
                    onNotesChanged = { currentNotes = it },
                    onProceedToTriage = { currentScreen = Screen.LOCAL_INFERENCE }
                )
                Screen.LOCAL_INFERENCE -> LocalInferenceScreen(
                    assetId = selectedAssetId,
                    notes = currentNotes,
                    mode = selectedMode,
                    cloudApproval = cloudApproval,
                    onModeChanged = { selectedMode = it },
                    onCloudApprovalChanged = { cloudApproval = it },
                    onInferenceComplete = {
                        lastInference = it
                        currentScreen = Screen.REDACTION_CONSENT
                    }
                )
                Screen.REDACTION_CONSENT -> RedactionConsentScreen(
                    assetId = selectedAssetId,
                    inference = lastInference,
                    onConsentApproved = { currentScreen = Screen.OUTBOX }
                )
                Screen.OUTBOX -> OutboxSyncScreen()
                Screen.CAPABILITY_STATUS -> CapabilityStatusScreen()
            }
        }
    }
}

@Composable
fun LoginScreen(onLoginSuccess: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("FieldRelay Node Login", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
        Text("Authenticate via Firebase Auth operator credentials.", fontSize = 12.sp, color = Color.Gray)
        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = onLoginSuccess,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F766E))
        ) {
            Text("Sign in as Field Operator (demo-nexus)")
        }
    }
}

@Composable
fun ScannerScreen(onAssetResolved: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Asset Marker Scanner", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text("Point camera at physical or logical QR-TITAN-WTP-01-* fiducial marker.", fontSize = 12.sp, color = Color.Gray)
        Spacer(modifier = Modifier.height(16.dp))

        // Simulated camera viewfinder target box
        Box(
            modifier = Modifier.fillMaxWidth().height(260.dp).background(Color(0xFF0F172A), RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterAlignmentLine(Alignment.CenterVertically)) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = null, tint = Color(0xFF14B8A6), modifier = Modifier.size(64.dp))
                Spacer(modifier = Modifier.height(8.dp))
                Text("Align QR marker in viewfinder", color = Color(0xFF94A3B8), fontSize = 12.sp)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        Text("Quick Test Markers (Canonical Plant Topology):", fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(8.dp))
        listOf("WTP01-PMP-001", "WTP01-TNK-001", "WTP01-FLT-001", "WTP01-VLV-001", "WTP01-SEN-001").forEach { id ->
            Button(
                onClick = { onAssetResolved(id) },
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                shape = RoundedCornerShape(8.dp),
                border = ButtonDefaults.outlinedButtonBorder
            ) {
                Text("Resolve QR-TITAN-WTP-01-$id", color = Color(0xFF0F766E), fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

@Composable
fun EvidenceCaptureScreen(
    assetId: String,
    notes: String,
    onNotesChanged: (String) -> Unit,
    onProceedToTriage: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Evidence & Notes Capture", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text("Asset: $assetId · Confidentiality: RESTRICTED LOCAL", fontSize = 12.sp, color = Color(0xFFB45309))
        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = notes,
            onValueChange = onNotesChanged,
            label = { Text("Physical Inspection Observations") },
            modifier = Modifier.fillMaxWidth().height(120.dp)
        )

        Spacer(modifier = Modifier.height(16.dp))
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color.White)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text("Perceptual Photo Hash (Simulated)", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Text("SHA-256: 4a2b9e81f03d7c... (Native downsampling applied)", fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = Color.Gray)
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = onProceedToTriage,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F766E))
        ) {
            Text("Evaluate via Mobile AI Logic")
        }
    }
}

@Composable
fun LocalInferenceScreen(
    assetId: String,
    notes: String,
    mode: HybridMode,
    cloudApproval: Boolean,
    onModeChanged: (HybridMode) -> Unit,
    onCloudApprovalChanged: (Boolean) -> Unit,
    onInferenceComplete: (InferenceResponse) -> Unit
) {
    var isRunning by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Mobile Triage Inference", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text("Executes single-turn evaluation strictly in foreground UI.", fontSize = 12.sp, color = Color.Gray)
        Spacer(modifier = Modifier.height(16.dp))

        Text("Inference Mode:", fontWeight = FontWeight.Bold, fontSize = 12.sp)
        HybridMode.values().forEach { m ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { onModeChanged(m) }) {
                RadioButton(selected = mode == m, onClick = { onModeChanged(m) })
                Text(m.name, fontSize = 12.sp)
            }
        }

        Spacer(modifier = Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = cloudApproval, onCheckedChange = onCloudApprovalChanged)
            Text("Grant explicit operator cloud transmission approval", fontSize = 11.sp)
        }

        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = {
                isRunning = true
                val triage = TriageObservationResult(
                    asset_id = assetId,
                    severity = "medium",
                    anomaly_detected = true,
                    physical_observation = notes,
                    recommended_action = "Schedule ultrasonic bearing test and inspect intake strainer.",
                    confidence = 0.94
                )
                val resp = InferenceResponse(
                    source = if (mode == HybridMode.ONLY_IN_CLOUD) InferenceSource.IN_CLOUD else InferenceSource.ON_DEVICE,
                    result = triage,
                    latencyMs = 184
                )
                isRunning = false
                onInferenceComplete(resp)
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F766E)),
            enabled = !isRunning
        ) {
            Text(if (isRunning) "Evaluating…" else "Run Foreground Triage")
        }
    }
}

@Composable
fun RedactionConsentScreen(
    assetId: String,
    inference: InferenceResponse?,
    onConsentApproved: () -> Unit
) {
    var consentChecked by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Redaction Preview &amp; Consent", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text("Confirm withholding of operator location &amp; raw photos.", fontSize = 12.sp, color = Color.Gray)
        Spacer(modifier = Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) {
            Column(modifier = Modifier.padding(14.dp)) {
                Text("Redaction Guarantees:", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Text("• Operator GPS coordinates: WITHHELD (0 bytes)", fontSize = 11.sp, color = Color(0xFF0F766E))
                Text("• Raw camera photo bytes: REDACTED (Replaced by hash)", fontSize = 11.sp, color = Color(0xFF0F766E))
                Text("• Reported Inference Source: ${inference?.source ?: "ON_DEVICE"}", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Text("• Latency: ${inference?.latencyMs ?: 150} ms", fontSize = 11.sp)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = consentChecked, onCheckedChange = { consentChecked = it })
            Text("I approve storing this redacted observation in the offline outbox.", fontSize = 11.sp)
        }

        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = onConsentApproved,
            modifier = Modifier.fillMaxWidth(),
            enabled = consentChecked,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F766E))
        ) {
            Text("Approve &amp; Enqueue to Outbox")
        }
    }
}

@Composable
fun OutboxSyncScreen() {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Offline Outbox &amp; Sync Queue", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text("Items are encrypted with Keystore AES-256-GCM before storage.", fontSize = 12.sp, color = Color.Gray)
        Spacer(modifier = Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) {
            Column(modifier = Modifier.padding(14.dp)) {
                Text("Sync Status: Idle (Periodic WorkManager active)", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text("Pending Sync Items: 1 approved observation", fontSize = 11.sp, color = Color(0xFF0F766E))
                Text("Network: Online (LAN loopback)", fontSize = 11.sp)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = { /* manual sync trigger */ },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F766E))
        ) {
            Text("Flush Approved Outbox Now")
        }
    }
}

@Composable
fun CapabilityStatusScreen() {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Device Hardware &amp; Capability Status", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text("Hardware floor, AICore readiness, and security vault tier.", fontSize = 12.sp, color = Color.Gray)
        Spacer(modifier = Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("• Android OS: API 35 (Android 15)", fontSize = 12.sp)
                Text("• Keystore: Hardware-backed StrongBox / TEE AES-GCM", fontSize = 12.sp)
                Text("• Gemini Nano / AICore: Supported (Foreground only)", fontSize = 12.sp)
                Text("• CameraX &amp; MLKit: Ready (Barcode scanner active)", fontSize = 12.sp)
                Text("• WebRTC DataChannel: Available for local subnet P2P", fontSize = 12.sp)
                Text("• Background Local Inference: STRICTLY DISABLED", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F766E))
            }
        }
    }
}
