package dev.nexustitan.fieldrelay

import dev.nexustitan.fieldrelay.ai.FirebaseAiLogicAdapter
import dev.nexustitan.fieldrelay.ai.HybridMode
import dev.nexustitan.fieldrelay.ai.InferenceSource
import dev.nexustitan.fieldrelay.camera.MarkerParser
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FieldRelayUnitTest {

    @Test
    fun `MarkerParser correctly extracts canonical asset ID from TITAN QR prefix`() {
        val raw = "QR-TITAN-WTP-01-WTP01-PMP-001"
        val parsed = MarkerParser.parse(raw)

        assertEquals("WTP01-PMP-001", parsed.canonicalAssetId)
        assertEquals("TITAN-WTP-01", parsed.siteId)
        assertTrue(parsed.isTitanFormat)
        assertEquals(raw, parsed.rawMarkerId)
    }

    @Test
    fun `MarkerParser handles arbitrary barcode format with fallback`() {
        val raw = "VALVE-RAW-992"
        val parsed = MarkerParser.parse(raw)

        assertEquals("VALVE-RAW-992", parsed.canonicalAssetId)
        assertFalse(parsed.isTitanFormat)
    }

    @Test
    fun `FirebaseAiLogicAdapter throws IllegalStateException when not in foreground`() = runBlocking {
        val adapter = FirebaseAiLogicAdapter()
        val exception = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                adapter.evaluateObservation(
                    assetId = "WTP01-PMP-001",
                    notes = "Test vibration notes",
                    isForeground = false
                )
            }
        }
        assertTrue(exception.message?.contains("FOREGROUND_REQUIRED") == true)
    }

    @Test
    fun `FirebaseAiLogicAdapter enforces ONLY_ON_DEVICE requires AICore availability`() = runBlocking {
        val adapter = FirebaseAiLogicAdapter()
        val exception = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                adapter.evaluateObservation(
                    assetId = "WTP01-PMP-001",
                    notes = "Pump overheat",
                    mode = HybridMode.ONLY_ON_DEVICE,
                    deviceAiCoreAvailable = false
                )
            }
        }
        assertTrue(exception.message?.contains("ON_DEVICE_UNAVAILABLE") == true)
    }

    @Test
    fun `FirebaseAiLogicAdapter ONLY_ON_DEVICE succeeds with MOCK source when AICore is present`() = runBlocking {
        val adapter = FirebaseAiLogicAdapter()
        val response = adapter.evaluateObservation(
            assetId = "WTP01-PMP-001",
            notes = "Pump overheat",
            mode = HybridMode.ONLY_ON_DEVICE,
            deviceAiCoreAvailable = true
        )
        assertEquals(InferenceSource.MOCK, response.source)
        assertTrue(response.isFallback)
        assertEquals("WTP01-PMP-001", response.result.asset_id)
        assertNotNull(response.result.severity)
    }

    @Test
    fun `FirebaseAiLogicAdapter enforces ONLY_IN_CLOUD requires explicit operator consent`() = runBlocking {
        val adapter = FirebaseAiLogicAdapter()
        val exception = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                adapter.evaluateObservation(
                    assetId = "WTP01-PMP-001",
                    notes = "Filter pressure drop",
                    mode = HybridMode.ONLY_IN_CLOUD,
                    cloudApprovalGranted = false
                )
            }
        }
        assertTrue(exception.message?.contains("CLOUD_APPROVAL_REQUIRED") == true)
    }

    @Test
    fun `FirebaseAiLogicAdapter ONLY_IN_CLOUD succeeds with MOCK source when approved`() = runBlocking {
        val adapter = FirebaseAiLogicAdapter()
        val response = adapter.evaluateObservation(
            assetId = "WTP01-PMP-001",
            notes = "Filter pressure drop",
            mode = HybridMode.ONLY_IN_CLOUD,
            cloudApprovalGranted = true
        )
        assertEquals(InferenceSource.MOCK, response.source)
        assertTrue(response.isFallback)
    }

    @Test
    fun `FirebaseAiLogicAdapter PREFER_ON_DEVICE falls back to mock when neither cloud nor on-device is available`() = runBlocking {
        val adapter = FirebaseAiLogicAdapter()
        val response = adapter.evaluateObservation(
            assetId = "WTP01-PMP-001",
            notes = "Routine inspection",
            mode = HybridMode.PREFER_ON_DEVICE,
            deviceAiCoreAvailable = false,
            cloudApprovalGranted = false
        )
        assertEquals(InferenceSource.MOCK, response.source)
        assertTrue(response.isFallback)
    }

    @Test
    fun `FirebaseAiLogicAdapter PREFER_ON_DEVICE falls back to mock when approved and no AICore`() = runBlocking {
        val adapter = FirebaseAiLogicAdapter()
        val response = adapter.evaluateObservation(
            assetId = "WTP01-PMP-001",
            notes = "Routine inspection",
            mode = HybridMode.PREFER_ON_DEVICE,
            deviceAiCoreAvailable = false,
            cloudApprovalGranted = true
        )
        assertEquals(InferenceSource.MOCK, response.source)
        assertTrue(response.isFallback)
    }

    @Test
    fun `Structured triage schema returns valid fields on observation evaluation`() = runBlocking {
        val adapter = FirebaseAiLogicAdapter()
        val response = adapter.evaluateObservation(
            assetId = "WTP01-PMP-001",
            notes = "High cavitation vibration 12mm/s detected",
            mode = HybridMode.PREFER_ON_DEVICE,
            deviceAiCoreAvailable = true
        )
        val result = response.result
        assertTrue(result.anomaly_detected)
        assertEquals("HIGH", result.severity)
        assertTrue(result.physical_observation.isNotEmpty())
        assertTrue(result.recommended_action.isNotEmpty())
        assertTrue(result.confidence in 0.0..1.0)
    }
}
