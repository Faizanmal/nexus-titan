// Android/iOS are offline-relay scaffolds; Firebase AI Logic hybrid inference is implemented on Web/Chrome.
import Foundation
import NexusTitanContracts

public enum HybridMode: String, Codable, Sendable {
    case preferOnDevice = "prefer_on_device"
    case onlyOnDevice = "only_on_device"
    case preferInCloud = "prefer_in_cloud"
    case onlyInCloud = "only_in_cloud"
}

public enum InferenceSource: String, Codable, Sendable {
    case onDeviceSystem = "on_device_system"
    case inCloud = "in_cloud"
    case mock = "mock"
    case unknown = "unknown"
}

public struct TriageObservationResult: Codable, Sendable, Equatable {
    public let asset_id: String
    public let severity: String
    public let anomaly_detected: Bool
    public let physical_observation: String
    public let recommended_action: String
    public let confidence: Double

    public init(
        asset_id: String,
        severity: String,
        anomaly_detected: Bool,
        physical_observation: String,
        recommended_action: String,
        confidence: Double
    ) {
        self.asset_id = asset_id
        self.severity = severity
        self.anomaly_detected = anomaly_detected
        self.physical_observation = physical_observation
        self.recommended_action = recommended_action
        self.confidence = confidence
    }
}

public struct InferenceResponse: Sendable {
    public let source: InferenceSource
    public let modelUsed: String
    public let result: TriageObservationResult
    public let latencyMs: Int64
    public let isFallback: Bool

    public init(
        source: InferenceSource,
        modelUsed: String,
        result: TriageObservationResult,
        latencyMs: Int64,
        isFallback: Bool = false
    ) {
        self.source = source
        self.modelUsed = modelUsed
        self.result = result
        self.latencyMs = latencyMs
        self.isFallback = isFallback
    }
}

public enum FirebaseAiLogicError: Error, LocalizedError {
    case foregroundRequired
    case onDeviceUnavailable
    case cloudApprovalRequired
    case restrictedFallbackProhibited
    case inferenceFailed(String)

    public var errorDescription: String? {
        switch self {
        case .foregroundRequired:
            return "FOREGROUND_REQUIRED: Local system model evaluation requires an active foreground UI state."
        case .onDeviceUnavailable:
            return "ON_DEVICE_UNAVAILABLE: Apple Intelligence or on-device foundation model not available or supported on this hardware."
        case .cloudApprovalRequired:
            return "CLOUD_APPROVAL_REQUIRED: Operator consent required before transmitting telemetry or observation notes to the cloud."
        case .restrictedFallbackProhibited:
            return "RESTRICTED_FALLBACK_PROHIBITED: Data classification is restricted; cloud transmission or fallback is strictly prohibited."
        case .inferenceFailed(let message):
            return "Inference execution failed: \(message)"
        }
    }
}

/// Firebase AI Logic hybrid adapter for iOS FieldRelay nodes.
/// Manages system-level on-device foundation models (Apple Intelligence) and cloud-based Gemini fallback.
public final class FirebaseAiLogicAdapter: Sendable {
    public let defaultMode: HybridMode
    public let cloudModelName: String

    public init(
        defaultMode: HybridMode = .preferOnDevice,
        cloudModelName: String = "gemini-3.5-flash-lite"
    ) {
        self.defaultMode = defaultMode
        self.cloudModelName = cloudModelName
    }

    /// Evaluates structured field observation triage.
    /// Strictly operates on text input; images must be pre-extracted via Vision OCR.
    public func evaluateObservation(
        assetId: String,
        notes: String,
        ocrText: String? = nil,
        classification: DataClassification = .confidential,
        mode: HybridMode? = nil,
        isForeground: Bool = true,
        appleIntelligenceAvailable: Bool = false,
        cloudApprovalGranted: Bool = false
    ) async throws -> InferenceResponse {
        let startTime = Date()
        let activeMode = mode ?? defaultMode

        // 1. FOREGROUND ENFORCEMENT: Never execute local models in background
        guard isForeground else {
            throw FirebaseAiLogicError.foregroundRequired
        }

        // Combine notes and reviewed OCR text into a single-turn bounded prompt
        var combinedText = notes
        if let ocr = ocrText, !ocr.isEmpty {
            combinedText += "\n[Extracted Gauge/Plate OCR: \(ocr)]"
        }

        // 2. RESTRICTED CLASSIFICATION CHECK: Cloud transmission strictly prohibited on restricted data
        let isRestricted = (classification == .restricted)

        switch activeMode {
        case .onlyOnDevice:
            guard appleIntelligenceAvailable else {
                throw FirebaseAiLogicError.onDeviceUnavailable
            }
            let triage = executeDeterministicTriage(assetId: assetId, text: combinedText, isMock: true)
            let elapsed = Int64(Date().timeIntervalSince(startTime) * 1000)
            return InferenceResponse(
                source: .mock,
                modelUsed: "scaffold-relay-fixture",
                result: triage,
                latencyMs: elapsed,
                isFallback: true
            )

        case .onlyInCloud:
            if isRestricted {
                throw FirebaseAiLogicError.restrictedFallbackProhibited
            }
            guard cloudApprovalGranted else {
                throw FirebaseAiLogicError.cloudApprovalRequired
            }
            let triage = executeDeterministicTriage(assetId: assetId, text: combinedText, isMock: true)
            let elapsed = Int64(Date().timeIntervalSince(startTime) * 1000)
            return InferenceResponse(
                source: .mock,
                modelUsed: "scaffold-relay-fixture",
                result: triage,
                latencyMs: elapsed,
                isFallback: true
            )

        case .preferOnDevice:
            let triage = executeDeterministicTriage(assetId: assetId, text: combinedText, isMock: true)
            let elapsed = Int64(Date().timeIntervalSince(startTime) * 1000)
            return InferenceResponse(
                source: .mock,
                modelUsed: "scaffold-relay-fixture",
                result: triage,
                latencyMs: elapsed,
                isFallback: true
            )

        case .preferInCloud:
            let triage = executeDeterministicTriage(assetId: assetId, text: combinedText, isMock: true)
            let elapsed = Int64(Date().timeIntervalSince(startTime) * 1000)
            return InferenceResponse(
                source: .mock,
                modelUsed: "scaffold-relay-fixture",
                result: triage,
                latencyMs: elapsed,
                isFallback: true
            )
        }
    }

    private func executeDeterministicTriage(assetId: String, text: String, isMock: Bool) -> TriageObservationResult {
        let lower = text.lowercased()
        let isAnomaly = lower.contains("anomaly") || lower.contains("leak") || lower.contains("vibration") || lower.contains("cavitation") || lower.contains("drop")

        let severity: String
        let action: String

        if lower.contains("cavitation") || lower.contains("burst") || lower.contains("critical") {
            severity = "CRITICAL"
            action = "Immediately throttle influent valve and dispatch mechanical technician for impeller inspection."
        } else if isAnomaly {
            severity = "HIGH"
            action = "Verify local differential pressure gauge and schedule vibration bearing analysis within 4 hours."
        } else {
            severity = "NORMAL"
            action = "Routine inspection within acceptable operational tolerances. Log telemetry into shift record."
        }

        return TriageObservationResult(
            asset_id: assetId,
            severity: severity,
            anomaly_detected: isAnomaly,
            physical_observation: "Field technician observation for \(assetId): \(text)",
            recommended_action: action,
            confidence: isMock ? 0.75 : 0.94
        )
    }
}
