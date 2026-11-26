import Foundation
import Vision
import CoreImage

public struct ResolvedMarker: Equatable, Sendable {
    public let rawMarkerId: String
    public let canonicalAssetId: String
    public let siteId: String
    public let isTitanFormat: BooleanLiteralType

    public init(
        rawMarkerId: String,
        canonicalAssetId: String,
        siteId: String = "TITAN-WTP-01",
        isTitanFormat: Bool
    ) {
        self.rawMarkerId = rawMarkerId
        self.canonicalAssetId = canonicalAssetId
        self.siteId = siteId
        self.isTitanFormat = isTitanFormat
    }
}

public enum MarkerParser {
    public static let titanQrPrefix = "QR-TITAN-WTP-01-"

    public static func parse(rawText: String) -> ResolvedMarker {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix(titanQrPrefix) {
            let assetId = String(trimmed.dropFirst(titanQrPrefix.count))
            return ResolvedMarker(
                rawMarkerId: trimmed,
                canonicalAssetId: assetId,
                siteId: "TITAN-WTP-01",
                isTitanFormat: true
            )
        } else {
            return ResolvedMarker(
                rawMarkerId: trimmed,
                canonicalAssetId: trimmed,
                siteId: "TITAN-WTP-01",
                isTitanFormat: false
            )
        }
    }
}

/// Vision-based barcode scanner for processing plant QR codes from camera sample buffers.
public final class SpatialMarkerScanner: Sendable {
    public init() {}

    public func detectBarcode(in pixelBuffer: CVPixelBuffer) async throws -> ResolvedMarker? {
        return try await withCheckedThrowingContinuation { continuation in
            let request = VNDetectBarcodesRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let results = request.results as? [VNBarcodeObservation],
                      let firstBarcode = results.first(where: { $0.symbology == .qr }),
                      let payload = firstBarcode.payloadStringValue else {
                    continuation.resume(returning: nil)
                    return
                }

                let resolved = MarkerParser.parse(rawText: payload)
                continuation.resume(returning: resolved)
            }

            let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
