package dev.nexustitan.privacy

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class PrivacyPolicyVectorsTest {
    @Test fun sharedPrivacyVectorsMatch() {
        val path = java.nio.file.Path.of("../../tests/fixtures/privacy/policy-cases.json")
        val root = Json.parseToJsonElement(java.nio.file.Files.readString(path)).jsonObject
        assertEquals(PrivacyPolicy.VERSION, root["policy_version"]!!.jsonPrimitive.content)
        for (item in root["cases"]!!.jsonArray) {
            val c = item.jsonObject
            val decision = PrivacyPolicy.evaluate(
                role = c["role"]?.jsonPrimitive?.content ?: "",
                purpose = c["purpose"]?.jsonPrimitive?.content ?: "",
                destination = c["destination"]?.jsonPrimitive?.content ?: "",
                classification = c["classification"]?.jsonPrimitive?.content,
                tenantMatch = c["tenant_match"]!!.jsonPrimitive.content.toBoolean(),
                deviceTrusted = c["device_trusted"]!!.jsonPrimitive.content.toBoolean(),
                consent = c["consent"]!!.jsonPrimitive.content.toBoolean(),
                approval = c["approval"]!!.jsonPrimitive.content.toBoolean(),
                requestedCeiling = c["requested_ceiling"]?.jsonPrimitive?.content,
            )
            assertEquals(c["allow"]!!.jsonPrimitive.content.toBoolean(), decision.allow, c["id"]!!.jsonPrimitive.content)
            assertEquals(c["reason"]!!.jsonPrimitive.content, decision.reason, c["id"]!!.jsonPrimitive.content)
        }
    }
}
