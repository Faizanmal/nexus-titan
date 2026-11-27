// Android/iOS are offline-relay scaffolds; Firebase AI Logic hybrid inference is implemented on Web/Chrome.
package dev.nexustitan.fieldrelay.ai

import android.graphics.Bitmap
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import kotlin.math.max

enum class HybridMode {
    PREFER_ON_DEVICE,
    ONLY_ON_DEVICE,
    PREFER_IN_CLOUD,
    ONLY_IN_CLOUD
}

enum class InferenceSource {
    ON_DEVICE,
    IN_CLOUD,
    MOCK,
    UNKNOWN
}

@Serializable
data class TriageObservationResult(
    val asset_id: String,
    val severity: String,
    val anomaly_detected: Boolean,
    val physical_observation: String,
    val recommended_action: String,
    val confidence: Double
)

data class InferenceResponse(
    val source: InferenceSource,
    val result: TriageObservationResult,
    val latencyMs: Long,
    val isFallback: Boolean = false
)

class FirebaseAiLogicAdapter(
    val defaultMode: HybridMode = HybridMode.PREFER_ON_DEVICE,
    private val cloudModelName: String = "gemini-1.5-flash"
) {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Preprocesses a native Bitmap for mobile model inference by downsampling
     * to a maximum bounding dimension of 1024x1024 and compressing to JPEG.
     */
    fun preprocessImage(bitmap: Bitmap, maxDimension: Int = 1024): ByteArray {
        val width = bitmap.width
        val height = bitmap.height
        val maxSide = max(width, height)

        val scaledBitmap = if (maxSide > maxDimension) {
            val ratio = maxDimension.toFloat() / maxSide
            Bitmap.createScaledBitmap(bitmap, (width * ratio).toInt(), (height * ratio).toInt(), true)
        } else {
            bitmap
        }

        val outputStream = ByteArrayOutputStream()
        scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 85, outputStream)
        return outputStream.toByteArray()
    }

    /**
     * Executes single-turn structured inference for field observation triage.
     */
    suspend fun evaluateObservation(
        assetId: String,
        notes: String,
        imageBytes: ByteArray? = null,
        mode: HybridMode = defaultMode,
        isForeground: Boolean = true,
        deviceAiCoreAvailable: Boolean = false,
        cloudApprovalGranted: Boolean = false
    ): InferenceResponse {
        val startTime = System.currentTimeMillis()

        // FOREGROUND ENFORCEMENT: Local model inference is strictly foreground only
        if (!isForeground) {
            throw IllegalStateException("FOREGROUND_REQUIRED: Local model evaluation requires active foreground UI.")
        }

        return when (mode) {
            HybridMode.ONLY_ON_DEVICE -> {
                if (!deviceAiCoreAvailable) {
                    throw IllegalStateException("ON_DEVICE_UNAVAILABLE: Hardware floor not met or AICore model not downloaded.")
                }
                // Scaffolding deterministic output labeled honestly as MOCK
                val triage = executeDeterministicTriage(assetId, notes, isMock = true)
                InferenceResponse(
                    source = InferenceSource.MOCK,
                    result = triage,
                    latencyMs = System.currentTimeMillis() - startTime,
                    isFallback = true
                )
            }

            HybridMode.ONLY_IN_CLOUD -> {
                if (!cloudApprovalGranted) {
                    throw IllegalStateException("CLOUD_APPROVAL_REQUIRED: Operator consent required for cloud transmission.")
                }
                val triage = executeDeterministicTriage(assetId, notes, isMock = true)
                InferenceResponse(
                    source = InferenceSource.MOCK,
                    result = triage,
                    latencyMs = System.currentTimeMillis() - startTime,
                    isFallback = true
                )
            }

            HybridMode.PREFER_ON_DEVICE -> {
                if (deviceAiCoreAvailable) {
                    val triage = executeDeterministicTriage(assetId, notes, isMock = true)
                    InferenceResponse(
                        source = InferenceSource.MOCK,
                        result = triage,
                        latencyMs = System.currentTimeMillis() - startTime,
                        isFallback = true
                    )
                } else if (cloudApprovalGranted) {
                    val triage = executeDeterministicTriage(assetId, notes, isMock = true)
                    InferenceResponse(
                        source = InferenceSource.MOCK,
                        result = triage,
                        latencyMs = System.currentTimeMillis() - startTime,
                        isFallback = true
                    )
                } else {
                    // Fail closed if local unavailable and cloud unapproved
                    throw IllegalStateException("FALLBACK_BLOCKED: On-device unavailable and cloud transmission unapproved.")
                }
            }

            HybridMode.PREFER_IN_CLOUD -> {
                if (cloudApprovalGranted) {
                    val triage = executeDeterministicTriage(assetId, notes, isMock = true)
                    InferenceResponse(
                        source = InferenceSource.MOCK,
                        result = triage,
                        latencyMs = System.currentTimeMillis() - startTime,
                        isFallback = true
                    )
                } else if (deviceAiCoreAvailable) {
                    val triage = executeDeterministicTriage(assetId, notes, isMock = true)
                    InferenceResponse(
                        source = InferenceSource.MOCK,
                        result = triage,
                        latencyMs = System.currentTimeMillis() - startTime,
                        isFallback = true
                    )
                } else {
                    throw IllegalStateException("ALL_SOURCES_BLOCKED: No eligible inference source available.")
                }
            }
        }
    }

    private fun executeDeterministicTriage(assetId: String, notes: String, isMock: Boolean): TriageObservationResult {
        val hasVibration = notes.contains("vibration", ignoreCase = true) || notes.contains("shake", ignoreCase = true)
        val hasLeak = notes.contains("leak", ignoreCase = true) || notes.contains("drip", ignoreCase = true)

        val severity = when {
            hasLeak -> "high"
            hasVibration -> "medium"
            else -> "low"
        }

        return TriageObservationResult(
            asset_id = assetId,
            severity = severity,
            anomaly_detected = hasVibration || hasLeak,
            physical_observation = notes.ifBlank { "Nominal operational physical inspection." },
            recommended_action = if (hasLeak || hasVibration) "Schedule mechanical inspection and isolate redundant valve." else "Continue periodic telemetry logging.",
            confidence = if (isMock) 0.5 else 0.92
        )
    }
}
