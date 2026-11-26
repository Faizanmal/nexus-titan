import Foundation
import XCTest
@testable import NexusTitanContracts

final class PrivacyPolicyVectorsTests: XCTestCase {
    func testSharedPrivacyVectorsMatch() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let data = try Data(contentsOf: root.appendingPathComponent("tests/fixtures/privacy/policy-cases.json"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["policy_version"] as? String, PrivacyPolicy.version)
        let cases = try XCTUnwrap(json["cases"] as? [[String: Any]])
        for item in cases {
            let result = PrivacyPolicy.evaluate(role: item["role"] as? String ?? "", purpose: item["purpose"] as? String ?? "",
                destination: item["destination"] as? String ?? "", classification: item["classification"] as? String,
                tenantMatch: item["tenant_match"] as? Bool ?? false, deviceTrusted: item["device_trusted"] as? Bool ?? false,
                consent: item["consent"] as? Bool ?? false, approval: item["approval"] as? Bool ?? false,
                requestedCeiling: item["requested_ceiling"] as? String)
            XCTAssertEqual(result.allow, item["allow"] as? Bool, item["id"] as? String)
            XCTAssertEqual(result.reason, item["reason"] as? String, item["id"] as? String)
        }
    }
}
