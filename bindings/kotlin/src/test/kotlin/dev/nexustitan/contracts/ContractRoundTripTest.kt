package dev.nexustitan.contracts

import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ContractRoundTripTest {
    private val sample = """{"tenant_id":"tenant-demo","events":[{"event_id":"11111111-1111-4111-8111-111111111111","tenant_id":"tenant-demo","schema_version":"1.0.0","event_type":"device.observed","source":"device","sequence":1,"occurred_at":"2026-11-14T10:00:00Z","classification":"internal","payload":{"observation_id":"obs-synthetic-001"}}]}"""

    @Test fun eventBatchRoundTrips() {
        val batch = Json.decodeFromString<EventBatch>(sample)
        batch.validate()
        val decoded = Json.decodeFromString<EventBatch>(Json.encodeToString(batch))
        assertEquals("11111111-1111-4111-8111-111111111111", decoded.events.first().event_id)
    }

    @Test fun unknownEnumAndSchemaVersionAreRejected() {
        assertFailsWith<SerializationException> { Json.decodeFromString<EventSource>("\"future_source\"") }
        assertFailsWith<SerializationException> { Json.decodeFromString<SchemaVersion>("\"2.0.0\"") }
    }

    @Test fun duplicateEventIdsAreRejected() {
        val batch = Json.decodeFromString<EventBatch>(sample)
        assertFailsWith<IllegalArgumentException> { batch.copy(events = batch.events + batch.events.first()).validate() }
    }
}
