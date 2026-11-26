/**
 * Maps Firebase AI Logic `response.inferenceSource` to a display label.
 * Accepts SDK enum string values (`on_device` / `in_cloud`) and the guide labels
 * (`ON_DEVICE` / `IN_CLOUD`). Never invents a source from mode or test input.
 */
export function mapReportedInferenceSource(reported: unknown): "ON_DEVICE" | "IN_CLOUD" | null {
  if (reported === "on_device" || reported === "ON_DEVICE") return "ON_DEVICE";
  if (reported === "in_cloud" || reported === "IN_CLOUD") return "IN_CLOUD";
  return null;
}
