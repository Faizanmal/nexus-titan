import { getGenerativeModel } from "firebase/ai";
import { firebaseClient, InferenceMode, type SpikeMode } from "./client";
import { mapReportedInferenceSource } from "./inference-source";

export type FirebaseInferenceResult = {
  text: string;
  /** Actual source is exclusively the SDK response; callers cannot inject/override it. */
  actualSource: "ON_DEVICE" | "IN_CLOUD" | null;
};

/**
 * Real Firebase AI Logic provider. Test doubles must not set actualSource to ON_DEVICE;
 * only mapReportedInferenceSource(SDK value) produces that label.
 */
export async function requestFirebaseInference(
  mode: SpikeMode,
  prompt: string,
  onProgress: (label: string) => void,
): Promise<FirebaseInferenceResult> {
  const { ai } = firebaseClient();
  const model = getGenerativeModel(ai, {
    mode: InferenceMode[mode],
    inCloudParams: { model: process.env.NEXT_PUBLIC_FIREBASE_CLOUD_MODEL || "gemini-2.0-flash" },
  });
  if (mode !== "ONLY_IN_CLOUD") {
    onProgress("Checking / preparing device model…");
    try {
      await model.initializeDeviceModel((progress) =>
        onProgress(`Device model progress: ${Math.round(progress * 100)}%`),
      );
    } catch (error) {
      onProgress("Device model unavailable or initialization failed");
      throw error;
    }
    onProgress("Device model ready");
  }
  const result = await model.generateContent(prompt);
  return {
    text: result.response.text(),
    actualSource: mapReportedInferenceSource(result.response.inferenceSource),
  };
}
