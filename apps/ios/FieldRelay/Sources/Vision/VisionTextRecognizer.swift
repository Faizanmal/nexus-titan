import Foundation
import Vision
import CoreGraphics

public struct OcrResult: Equatable, Sendable {
    public let recognizedText: String
    public let lineCount: Int
    public let confidenceAverage: Float

    public init(recognizedText: String, lineCount: Int, confidenceAverage: Float) {
        self.recognizedText = recognizedText
        self.lineCount = lineCount
        self.confidenceAverage = confidenceAverage
    }
}

/// On-device Vision OCR engine for extracting text from equipment gauges, serial tags, and plaques locally.
/// Keeps raw photos strictly local on device and feeds structured, reviewed text strings to AI logic.
public final class VisionTextRecognizer: Sendable {
    public init() {}

    public func recognizeText(in cgImage: CGImage) async throws -> OcrResult {
        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let observations = request.results as? [VNRecognizedTextObservation], !observations.isEmpty else {
                    continuation.resume(returning: OcrResult(recognizedText: "", lineCount: 0, confidenceAverage: 0.0))
                    return
                }

                var lines: [String] = []
                var confidenceSum: Float = 0.0
                var count: Float = 0.0

                for observation in observations {
                    if let candidate = observation.topCandidates(1).first {
                        lines.append(candidate.string)
                        confidenceSum += candidate.confidence
                        count += 1.0
                    }
                }

                let fullText = lines.joined(separator: "\n")
                let avgConfidence = count > 0 ? (confidenceSum / count) : 0.0

                continuation.resume(returning: OcrResult(
                    recognizedText: fullText,
                    lineCount: lines.count,
                    confidenceAverage: avgConfidence
                ))
            }

            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true

            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
