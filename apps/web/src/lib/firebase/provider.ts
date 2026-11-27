import { getGenerativeModel } from "firebase/ai";
import { firebaseClient, InferenceMode, type SpikeMode } from "./client";
import { mapReportedInferenceSource } from "./inference-source";
import { readHybridRemoteConfig, prepareGeminiNano } from "@nexus-titan/hybrid-web";

export type FirebaseInferenceResult = {
  text: string;
  /** Actual source is exclusively the SDK response; callers cannot inject/override it. */
  actualSource: "ON_DEVICE" | "IN_CLOUD" | "IN_CLOUD (inferred from mode)" | null;
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
  const { app, ai } = firebaseClient();
  let cloudModel = process.env.NEXT_PUBLIC_FIREBASE_CLOUD_MODEL || "gemini-3.5-flash-lite";
  try {
    const runtimeConfig = await readHybridRemoteConfig(app);
    if (runtimeConfig?.model) {
      cloudModel = runtimeConfig.model;
    }
  } catch {
    // Fall back to configured cloudModel
  }

  const model = getGenerativeModel(ai, {
    mode: InferenceMode[mode],
    inCloudParams: { model: cloudModel },
  });
  if (mode === "ONLY_IN_CLOUD") {
    try {
      const prep = await prepareGeminiNano();
      onProgress(prep.ready ? "Device model available (bypassed in cloud-only mode)" : prep.status);
    } catch {
      onProgress("On-device model check skipped (cloud-only mode)");
    }
  } else {
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
  const reportedSource = mapReportedInferenceSource(result.response.inferenceSource);
  const actualSource = reportedSource ?? (mode === "ONLY_IN_CLOUD" ? "IN_CLOUD (inferred from mode)" : null);
  return {
    text: result.response.text(),
    actualSource,
  };
}
