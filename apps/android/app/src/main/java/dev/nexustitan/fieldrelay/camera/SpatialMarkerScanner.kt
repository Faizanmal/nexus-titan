package dev.nexustitan.fieldrelay.camera

import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage

data class ResolvedMarker(
    val rawMarkerId: String,
    val canonicalAssetId: String,
    val siteId: String,
    val isTitanFormat: Boolean
)

object MarkerParser {
    private const val TITAN_QR_PREFIX = "QR-TITAN-WTP-01-"

    fun parse(rawText: String): ResolvedMarker {
        val trimmed = rawText.trim()
        return if (trimmed.startsWith(TITAN_QR_PREFIX)) {
            val assetId = trimmed.removePrefix(TITAN_QR_PREFIX)
            ResolvedMarker(
                rawMarkerId = trimmed,
                canonicalAssetId = assetId,
                siteId = "TITAN-WTP-01",
                isTitanFormat = true
            )
        } else {
            ResolvedMarker(
                rawMarkerId = trimmed,
                canonicalAssetId = trimmed,
                siteId = "TITAN-WTP-01",
                isTitanFormat = false
            )
        }
    }
}

class SpatialMarkerAnalyzer(
    private val onMarkerDetected: (ResolvedMarker) -> Unit
) : ImageAnalysis.Analyzer {

    private val scanner = BarcodeScanning.getClient()

    @OptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage != null) {
            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
            scanner.process(image)
                .addOnSuccessListener { barcodes ->
                    for (barcode in barcodes) {
                        val rawValue = barcode.rawValue
                        if (!rawValue.isNullOrBlank()) {
                            onMarkerDetected(MarkerParser.parse(rawValue))
                            break
                        }
                    }
                }
                .addOnCompleteListener {
                    imageProxy.close()
                }
        } else {
            imageProxy.close()
        }
    }
}
