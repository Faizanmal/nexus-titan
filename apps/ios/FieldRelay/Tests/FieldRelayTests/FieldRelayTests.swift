import XCTest
import NexusTitanContracts
@testable import FieldRelayCore

final class FieldRelayTests: XCTestCase {

    // MARK: - MarkerParser Tests

    func testMarkerParserExtractsCanonicalAssetId() {
        let raw = "QR-TITAN-WTP-01-WTP01-PMP-001"
        let parsed = MarkerParser.parse(rawText: raw)

        XCTAssertEqual(parsed.canonicalAssetId, "WTP01-PMP-001")
        XCTAssertEqual(parsed.siteId, "TITAN-WTP-01")
        XCTAssertTrue(parsed.isTitanFormat)
        XCTAssertEqual(parsed.rawMarkerId, raw)
    }

    func testMarkerParserHandlesGenericBarcode() {
        let raw = "VALVE-RAW-992"
        let parsed = MarkerParser.parse(rawText: raw)

        XCTAssertEqual(parsed.canonicalAssetId, "VALVE-RAW-992")
        XCTAssertFalse(parsed.isTitanFormat)
    }

    // MARK: - FirebaseAiLogicAdapter Tests

    func testForegroundEnforcementThrowsError() async {
        let adapter = FirebaseAiLogicAdapter()
        do {
            _ = try await adapter.evaluateObservation(
                assetId: "WTP01-PMP-001",
                notes: "Vibration anomaly",
                isForeground: false
            )
            XCTFail("Expected foregroundRequired error to be thrown")
        } catch let error as FirebaseAiLogicError {
            guard case .foregroundRequired = error else {
                XCTFail("Expected .foregroundRequired, got \(error)")
                return
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testOnlyOnDeviceEnforcesAppleIntelligenceAvailability() async {
        let adapter = FirebaseAiLogicAdapter()
        do {
            _ = try await adapter.evaluateObservation(
                assetId: "WTP01-PMP-001",
                notes: "Bearing noise",
                mode: .onlyOnDevice,
                appleIntelligenceAvailable: false
            )
            XCTFail("Expected onDeviceUnavailable error")
        } catch let error as FirebaseAiLogicError {
            guard case .onDeviceUnavailable = error else {
                XCTFail("Expected .onDeviceUnavailable, got \(error)")
                return
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testOnlyOnDeviceSucceedsWhenAvailable() async throws {
        let adapter = FirebaseAiLogicAdapter()
        let response = try await adapter.evaluateObservation(
            assetId: "WTP01-PMP-001",
            notes: "Bearing noise",
            mode: .onlyOnDevice,
            appleIntelligenceAvailable: true
        )

        XCTAssertEqual(response.source, .mock)
        XCTAssertTrue(response.isFallback)
        XCTAssertEqual(response.modelUsed, "scaffold-relay-fixture")
        XCTAssertEqual(response.result.asset_id, "WTP01-PMP-001")
    }

    func testOnlyInCloudEnforcesOperatorConsent() async {
        let adapter = FirebaseAiLogicAdapter()
        do {
            _ = try await adapter.evaluateObservation(
                assetId: "WTP01-PMP-001",
                notes: "Filter differential pressure",
                mode: .onlyInCloud,
                cloudApprovalGranted: false
            )
            XCTFail("Expected cloudApprovalRequired error")
        } catch let error as FirebaseAiLogicError {
            guard case .cloudApprovalRequired = error else {
                XCTFail("Expected .cloudApprovalRequired, got \(error)")
                return
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testRestrictedDataProhibitsCloudTransmission() async {
        let adapter = FirebaseAiLogicAdapter()
        do {
            _ = try await adapter.evaluateObservation(
                assetId: "WTP01-PMP-001",
                notes: "Chlorine doser malfunction",
                classification: .restricted,
                mode: .onlyInCloud,
                cloudApprovalGranted: true
            )
            XCTFail("Expected restrictedFallbackProhibited error")
        } catch let error as FirebaseAiLogicError {
            guard case .restrictedFallbackProhibited = error else {
                XCTFail("Expected .restrictedFallbackProhibited, got \(error)")
                return
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testRestrictedDataInPreferOnDeviceDoesNotFallbackToCloud() async throws {
        let adapter = FirebaseAiLogicAdapter()
        let response = try await adapter.evaluateObservation(
            assetId: "WTP01-PMP-001",
            notes: "Restricted chemical formulation ratio",
            classification: .restricted,
            mode: .preferOnDevice,
            appleIntelligenceAvailable: false,
            cloudApprovalGranted: true // Even if user approved cloud, policy forbids it!
        )

        XCTAssertEqual(response.source, .mock)
        XCTAssertTrue(response.isFallback)
        XCTAssertEqual(response.modelUsed, "scaffold-relay-fixture")
    }

    func testPreferOnDeviceFallsBackToCloudWhenApproved() async throws {
        let adapter = FirebaseAiLogicAdapter()
        let response = try await adapter.evaluateObservation(
            assetId: "WTP01-PMP-001",
            notes: "Routine inspection notes",
            classification: .confidential,
            mode: .preferOnDevice,
            appleIntelligenceAvailable: false,
            cloudApprovalGranted: true
        )

        XCTAssertEqual(response.source, .mock)
        XCTAssertTrue(response.isFallback)
        XCTAssertEqual(response.modelUsed, "scaffold-relay-fixture")
    }

    func testStructuredTriageOutputMatchesSchema() async throws {
        let adapter = FirebaseAiLogicAdapter()
        let response = try await adapter.evaluateObservation(
            assetId: "WTP01-PMP-001",
            notes: "Cavitation burst pressure alert 14 bar",
            mode: .preferOnDevice,
            appleIntelligenceAvailable: true
        )

        let result = response.result
        XCTAssertTrue(result.anomaly_detected)
        XCTAssertEqual(result.severity, "CRITICAL")
        XCTAssertFalse(result.physical_observation.isEmpty)
        XCTAssertFalse(result.recommended_action.isEmpty)
        XCTAssertGreaterThan(result.confidence, 0.0)
    }

    // MARK: - Outbox Tests

    func testOutboxStatusTransitions() {
        let record = OutboxRecord(
            assetId: "WTP01-PMP-001",
            encryptedPayload: Data([0x01, 0x02, 0x03]),
            status: .draft
        )

        XCTAssertEqual(record.status, .draft)
        var approved = record
        approved.status = .approvedForSync
        XCTAssertEqual(approved.status, .approvedForSync)
    }
}
