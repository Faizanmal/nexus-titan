import Foundation

public struct PrivacyDecision: Equatable {
    public let allow: Bool
    public let reason: String
    public let policyVersion: String
    public let classification: String
}

public enum PrivacyPolicy {
    public static let version = "nexus-privacy-v1"
    private static let order = ["public", "internal", "confidential", "restricted"]
    private struct Rule {
        let purpose: String; let ceiling: String; let roles: Set<String>
        var device = false; var consent = false; var approval = false; var metadataOnly = false
    }
    private static let rules: [String: Rule] = [
        "local_inference": Rule(purpose: "approved_task", ceiling: "restricted", roles: ["owner", "admin", "operator"], device: true),
        "cloud_inference": Rule(purpose: "approved_summary", ceiling: "public", roles: ["owner", "admin", "operator"], device: true, consent: true),
        "upload": Rule(purpose: "approved_artifact", ceiling: "internal", roles: ["owner", "admin", "operator"], device: true, consent: true, approval: true),
        "telemetry": Rule(purpose: "synthetic_telemetry", ceiling: "public", roles: ["owner", "admin", "operator", "service_worker"], device: true),
        "sync": Rule(purpose: "state_sync", ceiling: "internal", roles: ["owner", "admin", "operator"], device: true),
        "peer": Rule(purpose: "event_replication", ceiling: "public", roles: ["owner", "admin", "operator"], device: true, consent: true),
        "rag_index": Rule(purpose: "approved_retrieval", ceiling: "public", roles: ["owner", "admin", "operator"], device: true, approval: true),
        "audit_metadata": Rule(purpose: "privacy_audit", ceiling: "restricted", roles: ["owner", "admin", "operator", "viewer", "service_worker"], metadataOnly: true),
    ]
    private static func normalize(_ value: String?) -> String { guard let value, order.contains(value) else { return "restricted" }; return value }
    public static func evaluate(role: String, purpose: String, destination: String, classification: String?, tenantMatch: Bool,
                                deviceTrusted: Bool, consent: Bool, approval: Bool, metadataOnly: Bool = false,
                                requestedCeiling: String? = nil) -> PrivacyDecision {
        let klass = normalize(classification)
        func deny(_ reason: String) -> PrivacyDecision { PrivacyDecision(allow: false, reason: reason, policyVersion: version, classification: klass) }
        guard let rule = rules[destination] else { return deny("DESTINATION_UNKNOWN") }
        guard tenantMatch else { return deny("TENANT_SCOPE_VIOLATION") }
        guard rule.roles.contains(role) else { return deny("ROLE_FORBIDDEN") }
        guard purpose == rule.purpose else { return deny("PURPOSE_MISMATCH") }
        if rule.device && !deviceTrusted { return deny("DEVICE_UNTRUSTED") }
        if rule.consent && !consent { return deny("CONSENT_REQUIRED") }
        if rule.approval && !approval { return deny("APPROVAL_REQUIRED") }
        if rule.metadataOnly && !metadataOnly { return deny("RAW_AUDIT_FORBIDDEN") }
        var ceiling = order.firstIndex(of: rule.ceiling)!
        if let requestedCeiling {
            let requested = order.firstIndex(of: normalize(requestedCeiling))!
            if requested > ceiling { return deny("CLASSIFICATION_CEILING") }
            ceiling = min(ceiling, requested)
        }
        if order.firstIndex(of: klass)! > ceiling { return deny("CLASSIFICATION_CEILING") }
        return PrivacyDecision(allow: true, reason: "ALLOW", policyVersion: version, classification: klass)
    }
}
