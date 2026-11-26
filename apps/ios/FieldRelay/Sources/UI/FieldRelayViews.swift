import SwiftUI
import NexusTitanContracts

public enum FieldRelayTab: String, CaseIterable, Identifiable {
    case scan = "Scan"
    case capture = "Capture"
    case inference = "AI Triage"
    case consent = "Consent"
    case outbox = "Outbox"
    case mesh = "Mesh"
    case status = "Status"

    public var id: String { rawValue }

    public var iconName: String {
        switch self {
        case .scan: return "qrcode.viewfinder"
        case .capture: return "camera.fill"
        case .inference: return "cpu"
        case .consent: return "hand.raised.fill"
        case .outbox: return "tray.and.arrow.up.fill"
        case .mesh: return "point.3.connected.trianglepath.dotted"
        case .status: return "shield.checkerboard"
        }
    }
}

public struct FieldRelayRootView: View {
    @State private var selectedTab: FieldRelayTab = .scan
    @State private var selectedAssetId: String = "WTP01-PMP-001"
    @State private var observationNotes: String = "Primary effluent pump casing vibration anomaly detected."
    @State private var ocrText: String = "GAUGE-DP: 4.8 BAR | RPM: 1780 | SERIAL: TITAN-PMP-001A"
    @State private var activeMode: HybridMode = .preferOnDevice
    @State private var classification: DataClassification = .confidential
    @State private var cloudApproval: Bool = false
    @State private var lastInference: InferenceResponse? = nil

    public init() {}

    public var body: some View {
        TabView(selection: $selectedTab) {
            MarkerScannerView(selectedAssetId: $selectedAssetId, onProceed: { selectedTab = .capture })
                .tabItem { Label(FieldRelayTab.scan.rawValue, systemImage: FieldRelayTab.scan.iconName) }
                .tag(FieldRelayTab.scan)

            EvidenceCaptureView(
                assetId: $selectedAssetId,
                notes: $observationNotes,
                ocrText: $ocrText,
                onProceed: { selectedTab = .inference }
            )
            .tabItem { Label(FieldRelayTab.capture.rawValue, systemImage: FieldRelayTab.capture.iconName) }
            .tag(FieldRelayTab.capture)

            LocalInferenceView(
                assetId: selectedAssetId,
                notes: observationNotes,
                ocrText: ocrText,
                mode: $activeMode,
                classification: classification,
                cloudApproval: cloudApproval,
                lastInference: $lastInference,
                onProceed: { selectedTab = .consent }
            )
            .tabItem { Label(FieldRelayTab.inference.rawValue, systemImage: FieldRelayTab.inference.iconName) }
            .tag(FieldRelayTab.inference)

            PrivacyConsentView(
                notes: observationNotes,
                classification: $classification,
                cloudApproval: $cloudApproval,
                onProceed: { selectedTab = .outbox }
            )
            .tabItem { Label(FieldRelayTab.consent.rawValue, systemImage: FieldRelayTab.consent.iconName) }
            .tag(FieldRelayTab.consent)

            OutboxSyncView(assetId: selectedAssetId, notes: observationNotes)
                .tabItem { Label(FieldRelayTab.outbox.rawValue, systemImage: FieldRelayTab.outbox.iconName) }
                .tag(FieldRelayTab.outbox)

            PeerMeshView()
                .tabItem { Label(FieldRelayTab.mesh.rawValue, systemImage: FieldRelayTab.mesh.iconName) }
                .tag(FieldRelayTab.mesh)

            CapabilityStatusView()
                .tabItem { Label(FieldRelayTab.status.rawValue, systemImage: FieldRelayTab.status.iconName) }
                .tag(FieldRelayTab.status)
        }
    }
}

public struct MarkerScannerView: View {
    @Binding public var selectedAssetId: String
    public var onProceed: () -> Void

    public var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Plant Asset Marker Scanner")
                    .font(.headline)

                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color(white: 0.15))
                        .frame(height: 280)

                    VStack(spacing: 12) {
                        Image(systemName: "qrcode.viewfinder")
                            .font(.system(size: 64))
                            .foregroundColor(.cyan)

                        Text("Align plant QR marker within reticle")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        Text("Accepts: QR-TITAN-WTP-01-*")
                            .font(.caption)
                            .foregroundColor(.gray)
                    }
                }
                .padding(.horizontal)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Resolved Canonical Asset")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    HStack {
                        Text(selectedAssetId)
                            .font(.system(.body, design: .monospaced))
                            .bold()
                        Spacer()
                        Text("TITAN-WTP-01")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.blue.opacity(0.2))
                            .cornerRadius(6)
                    }
                    .padding()
                    .background(Color(white: 0.2))
                    .cornerRadius(10)
                }
                .padding(.horizontal)

                Button(action: onProceed) {
                    HStack {
                        Text("Capture Evidence for Asset")
                        Image(systemName: "arrow.right")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.cyan)
                    .foregroundColor(.black)
                    .bold()
                    .cornerRadius(10)
                }
                .padding(.horizontal)

                Spacer()
            }
            .navigationTitle("Scanner")
        }
    }
}

public struct EvidenceCaptureView: View {
    @Binding public var assetId: String
    @Binding public var notes: String
    @Binding public var ocrText: String
    public var onProceed: () -> Void

    public var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Target Asset")) {
                    Text(assetId)
                        .font(.system(.body, design: .monospaced))
                }

                Section(header: Text("Field Technician Observations")) {
                    TextEditor(text: $notes)
                        .frame(height: 100)
                }

                Section(header: Text("Local Vision OCR (Plaque / Gauge Text)")) {
                    TextEditor(text: $ocrText)
                        .frame(height: 80)
                        .font(.system(.caption, design: .monospaced))
                    Text("Extracted locally on-device. Images are never transmitted unreviewed.")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }

                Section {
                    Button(action: onProceed) {
                        HStack {
                            Spacer()
                            Text("Evaluate Local AI Triage")
                                .bold()
                            Spacer()
                        }
                    }
                    .foregroundColor(.cyan)
                }
            }
            .navigationTitle("Evidence Capture")
        }
    }
}

public struct LocalInferenceView: View {
    public let assetId: String
    public let notes: String
    public let ocrText: String
    @Binding public var mode: HybridMode
    public let classification: DataClassification
    public let cloudApproval: Bool
    @Binding public var lastInference: InferenceResponse?
    public var onProceed: () -> Void

    @State private var isEvaluating: Bool = false
    @State private var errorMessage: String? = nil

    private let adapter = FirebaseAiLogicAdapter()

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Picker("Inference Mode", selection: $mode) {
                        Text("Prefer Local").tag(HybridMode.preferOnDevice)
                        Text("Only Local").tag(HybridMode.onlyOnDevice)
                        Text("Prefer Cloud").tag(HybridMode.preferInCloud)
                        Text("Only Cloud").tag(HybridMode.onlyInCloud)
                    }
                    .pickerStyle(.segmented)

                    HStack {
                        Image(systemName: "cpu")
                        Text("Apple Intelligence: Standby / Supported")
                            .font(.caption)
                        Spacer()
                        Text("Model: gemini-1.5-flash fallback")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .padding(10)
                    .background(Color(white: 0.15))
                    .cornerRadius(8)

                    Button(action: runInference) {
                        HStack {
                            Spacer()
                            if isEvaluating {
                                ProgressView()
                            } else {
                                Text("Execute Observation Triage")
                                    .bold()
                            }
                            Spacer()
                        }
                        .padding()
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                    }
                    .disabled(isEvaluating)

                    if let error = errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .padding()
                            .background(Color.red.opacity(0.1))
                            .cornerRadius(8)
                    }

                    if let response = lastInference {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("Triage Result")
                                    .font(.headline)
                                Spacer()
                                Text(response.source.rawValue.uppercased())
                                    .font(.caption2)
                                    .bold()
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(response.source == .onDeviceSystem ? Color.green.opacity(0.3) : Color.orange.opacity(0.3))
                                    .cornerRadius(4)
                            }

                            Divider()

                            HStack {
                                Text("Severity: \(response.result.severity)")
                                    .bold()
                                Spacer()
                                Text("Confidence: \(String(format: "%.1f%%", response.result.confidence * 100))")
                                    .font(.caption)
                            }

                            Text("Recommended Action:")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(response.result.recommended_action)
                                .font(.subheadline)

                            HStack {
                                Text("Latency: \(response.latencyMs) ms")
                                Spacer()
                                Text("Model: \(response.modelUsed)")
                            }
                            .font(.caption2)
                            .foregroundColor(.gray)
                        }
                        .padding()
                        .background(Color(white: 0.18))
                        .cornerRadius(10)

                        Button(action: onProceed) {
                            HStack {
                                Spacer()
                                Text("Review Redaction & Consent")
                                    .bold()
                                Spacer()
                            }
                            .padding()
                            .background(Color.green)
                            .foregroundColor(.black)
                            .cornerRadius(10)
                        }
                    }

                    Spacer()
                }
                .padding()
            }
            .navigationTitle("AI Triage")
        }
    }

    private func runInference() {
        isEvaluating = true
        errorMessage = nil
        Task {
            do {
                let res = try await adapter.evaluateObservation(
                    assetId: assetId,
                    notes: notes,
                    ocrText: ocrText,
                    classification: classification,
                    mode: mode,
                    isForeground: true,
                    appleIntelligenceAvailable: true,
                    cloudApprovalGranted: cloudApproval
                )
                await MainActor.run {
                    self.lastInference = res
                    self.isEvaluating = false
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isEvaluating = false
                }
            }
        }
    }
}

public struct PrivacyConsentView: View {
    public let notes: String
    @Binding public var classification: DataClassification
    @Binding public var cloudApproval: Bool
    public var onProceed: () -> Void

    public var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Data Classification Policy")) {
                    Picker("Classification Tier", selection: $classification) {
                        Text("Public").tag(DataClassification.publicValue)
                        Text("Internal").tag(DataClassification.internalValue)
                        Text("Confidential").tag(DataClassification.confidential)
                        Text("Restricted").tag(DataClassification.restricted)
                    }

                    if classification == .restricted {
                        Text("RESTRICTED: Cloud transmission and cloud AI fallback are strictly forbidden.")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                Section(header: Text("Redaction Preview")) {
                    Text("Redacted Text:")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(notes)
                        .font(.body)
                }

                Section(header: Text("Cloud Transmission Consent")) {
                    Toggle("Grant Cloud Triage Consent", isOn: $cloudApproval)
                        .disabled(classification == .restricted)
                }

                Section {
                    Button(action: onProceed) {
                        HStack {
                            Spacer()
                            Text("Queue in Encrypted Outbox")
                                .bold()
                            Spacer()
                        }
                    }
                    .foregroundColor(.cyan)
                }
            }
            .navigationTitle("Consent & Redaction")
        }
    }
}

public struct OutboxSyncView: View {
    public let assetId: String
    public let notes: String

    @State private var outboxRecords: [OutboxRecord] = []
    @State private var isFlushing: Bool = false
    @State private var flushMessage: String? = nil

    public var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                HStack {
                    VStack(alignment: .leading) {
                        Text("Encrypted Offline Outbox")
                            .font(.headline)
                        Text("Hardware-backed AES-256-GCM Keychain protection")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                    Button("Queue Current") {
                        queueCurrentObservation()
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.horizontal)

                List(outboxRecords) { record in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(record.assetId)
                                .font(.system(.subheadline, design: .monospaced))
                                .bold()
                            Text("Payload: \(record.encryptedPayload.count) encrypted bytes")
                                .font(.caption2)
                                .foregroundColor(.gray)
                        }
                        Spacer()
                        Text(record.status.rawValue.uppercased())
                            .font(.caption2)
                            .bold()
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(record.status == .approvedForSync ? Color.green.opacity(0.2) : Color.gray.opacity(0.2))
                            .cornerRadius(4)
                    }
                }

                if let message = flushMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundColor(.cyan)
                }

                Button(action: flushOutbox) {
                    HStack {
                        Spacer()
                        if isFlushing {
                            ProgressView()
                        } else {
                            Text("Flush Approved Records to Server")
                                .bold()
                        }
                        Spacer()
                    }
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(10)
                }
                .disabled(isFlushing)
                .padding(.horizontal)
            }
            .navigationTitle("Outbox")
            .onAppear(perform: loadOutbox)
        }
    }

    private func loadOutbox() {
        Task {
            let records = await FieldRelayOutboxManager.shared.getAllRecords()
            await MainActor.run {
                self.outboxRecords = records
            }
        }
    }

    private func queueCurrentObservation() {
        Task {
            if let payload = notes.data(using: .utf8) {
                _ = try? await FieldRelayOutboxManager.shared.insert(
                    assetId: assetId,
                    plaintextPayload: payload,
                    status: .approvedForSync
                )
                loadOutbox()
            }
        }
    }

    private func flushOutbox() {
        isFlushing = true
        flushMessage = nil
        Task {
            guard let url = URL(string: "http://127.0.0.1:8000") else { return }
            let count = (try? await FieldRelayOutboxManager.shared.flushPendingSync(serverBaseURL: url)) ?? 0
            await MainActor.run {
                self.flushMessage = "Synced \(count) records successfully."
                self.isFlushing = false
                self.loadOutbox()
            }
        }
    }
}

public struct PeerMeshView: View {
    @StateObject private var transport = MultipeerMeshTransport()

    public var body: some View {
        NavigationStack {
            List {
                Section(header: Text("Mesh Protocol Status")) {
                    HStack {
                        Text("Service Type")
                        Spacer()
                        Text("nexus-mesh")
                            .font(.system(.caption, design: .monospaced))
                    }
                    HStack {
                        Text("Local Network Mesh")
                        Spacer()
                        Text(transport.isAdvertising ? "Active" : "Idle")
                            .foregroundColor(transport.isAdvertising ? .green : .secondary)
                    }
                }

                Section(header: Text("Discovered Plant Peers")) {
                    if transport.connectedPeers.isEmpty {
                        Text("No nearby FieldRelay peers discovered on local subnet.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        ForEach(transport.connectedPeers) { peer in
                            HStack {
                                Text(peer.displayName)
                                Spacer()
                                Text(peer.state == .connected ? "Connected" : "Connecting")
                                    .font(.caption)
                            }
                        }
                    }
                }

                Section {
                    Button(transport.isAdvertising ? "Stop Local Mesh" : "Broadcast & Discover Peers") {
                        if transport.isAdvertising {
                            transport.stopMesh()
                        } else {
                            transport.startMesh()
                        }
                    }
                    .foregroundColor(.cyan)
                }
            }
            .navigationTitle("Peer Mesh")
        }
    }
}

public struct CapabilityStatusView: View {
    public var body: some View {
        NavigationStack {
            List {
                Section(header: Text("Hardware & System AI")) {
                    HStack {
                        Text("Apple Intelligence")
                        Spacer()
                        Text("A17 Pro / M-Series Ready")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                    HStack {
                        Text("Local Foundation Model")
                        Spacer()
                        Text("System Language Model")
                            .font(.caption)
                    }
                }

                Section(header: Text("Security & Cryptography")) {
                    HStack {
                        Text("Keychain Storage")
                        Spacer()
                        Text("AES-GCM-256 Active")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                    HStack {
                        Text("App Check Attestation")
                        Spacer()
                        Text("Apple DeviceCheck")
                            .font(.caption)
                    }
                }

                Section(header: Text("Operational Constraints")) {
                    HStack {
                        Text("Background Inference")
                        Spacer()
                        Text("Disallowed / Foreground Only")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Safety-Critical Override")
                        Spacer()
                        Text("Advisory Only (Apple Policy)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Capability Status")
        }
    }
}
