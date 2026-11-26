import Foundation
import XCTest
@testable import NexusTitanContracts

final class ContractRoundTripTests: XCTestCase {
    private let sample = #"{"tenant_id":"tenant-demo","events":[{"event_id":"11111111-1111-4111-8111-111111111111","tenant_id":"tenant-demo","schema_version":"1.0.0","event_type":"device.observed","source":"device","sequence":1,"occurred_at":"2026-11-14T10:00:00Z","classification":"internal","payload":{"observation_id":"obs-synthetic-001"}}]}"#

    func testEventBatchCodableRoundTrip() throws {
        let decoder = JSONDecoder()
        let batch = try decoder.decode(EventBatch.self, from: Data(sample.utf8))
        try batch.validate()
        let encoded = try JSONEncoder().encode(batch)
        let decoded = try decoder.decode(EventBatch.self, from: encoded)
        XCTAssertEqual(decoded.events.first?.event_id, "11111111-1111-4111-8111-111111111111")
    }

    func testUnknownEnumAndSchemaVersionsFailDecoding() {
        XCTAssertThrowsError(try JSONDecoder().decode(EventSource.self, from: Data(#""future_source""#.utf8)))
        XCTAssertThrowsError(try JSONDecoder().decode(SchemaVersion.self, from: Data(#""2.0.0""#.utf8)))
    }

    func testDuplicateEventIdsFailValidation() throws {
        let batch = try JSONDecoder().decode(EventBatch.self, from: Data(sample.utf8))
        let duplicate = EventBatch(tenant_id: batch.tenant_id, events: batch.events + [batch.events[0]])
        XCTAssertThrowsError(try duplicate.validate())
    }
}
