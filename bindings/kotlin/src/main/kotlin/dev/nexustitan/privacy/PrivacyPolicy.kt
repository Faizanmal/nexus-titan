package dev.nexustitan.privacy

data class PrivacyDecision(val allow: Boolean, val reason: String, val policyVersion: String, val classification: String)

object PrivacyPolicy {
    const val VERSION = "nexus-privacy-v1"
    private val order = listOf("public", "internal", "confidential", "restricted")
    private data class Rule(val purpose: String, val ceiling: String, val roles: Set<String>, val device: Boolean = false, val consent: Boolean = false, val approval: Boolean = false, val metadataOnly: Boolean = false)
    private val rules = mapOf(
        "local_inference" to Rule("approved_task", "restricted", setOf("owner", "admin", "operator"), device = true),
        "cloud_inference" to Rule("approved_summary", "public", setOf("owner", "admin", "operator"), device = true, consent = true),
        "upload" to Rule("approved_artifact", "internal", setOf("owner", "admin", "operator"), device = true, consent = true, approval = true),
        "telemetry" to Rule("synthetic_telemetry", "public", setOf("owner", "admin", "operator", "service_worker"), device = true),
        "sync" to Rule("state_sync", "internal", setOf("owner", "admin", "operator"), device = true),
        "peer" to Rule("event_replication", "public", setOf("owner", "admin", "operator"), device = true, consent = true),
        "rag_index" to Rule("approved_retrieval", "public", setOf("owner", "admin", "operator"), device = true, approval = true),
        "audit_metadata" to Rule("privacy_audit", "restricted", setOf("owner", "admin", "operator", "viewer", "service_worker"), metadataOnly = true),
    )
    fun normalize(value: String?): String = value?.takeIf { it in order } ?: "restricted"
    fun evaluate(role: String, purpose: String, destination: String, classification: String?, tenantMatch: Boolean,
                 deviceTrusted: Boolean, consent: Boolean, approval: Boolean, metadataOnly: Boolean = false,
                 requestedCeiling: String? = null): PrivacyDecision {
        val klass = normalize(classification)
        fun deny(reason: String) = PrivacyDecision(false, reason, VERSION, klass)
        val rule = rules[destination] ?: return deny("DESTINATION_UNKNOWN")
        if (!tenantMatch) return deny("TENANT_SCOPE_VIOLATION")
        if (role !in rule.roles) return deny("ROLE_FORBIDDEN")
        if (purpose != rule.purpose) return deny("PURPOSE_MISMATCH")
        if (rule.device && !deviceTrusted) return deny("DEVICE_UNTRUSTED")
        if (rule.consent && !consent) return deny("CONSENT_REQUIRED")
        if (rule.approval && !approval) return deny("APPROVAL_REQUIRED")
        if (rule.metadataOnly && !metadataOnly) return deny("RAW_AUDIT_FORBIDDEN")
        var ceiling = order.indexOf(rule.ceiling)
        if (requestedCeiling != null) {
            val requested = order.indexOf(normalize(requestedCeiling))
            if (requested > ceiling) return deny("CLASSIFICATION_CEILING")
            ceiling = minOf(ceiling, requested)
        }
        if (order.indexOf(klass) > ceiling) return deny("CLASSIFICATION_CEILING")
        return PrivacyDecision(true, "ALLOW", VERSION, klass)
    }
}
