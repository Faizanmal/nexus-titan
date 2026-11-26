/** Mirrors Firebase InferenceMode keys without importing the SDK here. */
export type SpikeMode = "PREFER_ON_DEVICE" | "ONLY_ON_DEVICE" | "PREFER_IN_CLOUD" | "ONLY_IN_CLOUD";

/** Public, non-sensitive text used for every cloud-capable mode. */
export const publicTextFixture = {
  id: "public-router-text-v1",
  kind: "text",
  prompt: "In one short sentence, explain what a network router does.",
} as const;

/**
 * Optional local JPEG fixture for future on-device multimodal checks.
 * Never routed to cloud modes by resolveSpikeFixture(); do not treat presence as proof.
 */
export const optionalJpegFixture = {
  id: "public-router-jpeg-v1",
  kind: "image",
  mimeType: "image/jpeg",
  /** Served from the web app public directory when present. */
  publicPath: "/fixtures/public-router-sample.jpg",
  caption: "Public sample diagram of a network router (optional; not used for cloud).",
  cloudAllowed: false,
} as const;

export type SpikeFixture =
  | { id: typeof publicTextFixture.id; kind: "text"; prompt: string }
  | {
      id: typeof optionalJpegFixture.id;
      kind: "image";
      mimeType: "image/jpeg";
      publicPath: string;
      caption: string;
      cloudAllowed: false;
    };

/**
 * Fixture adapter: PREFER_* and ONLY_IN_CLOUD always use the public text fixture.
 * The optional JPEG is never selected for cloud-capable modes.
 */
export function resolveSpikeFixture(mode: SpikeMode, options?: { includeOptionalJpeg?: boolean }): SpikeFixture {
  const cloudCapable =
    mode === "ONLY_IN_CLOUD" || mode === "PREFER_IN_CLOUD" || mode === "PREFER_ON_DEVICE";
  if (cloudCapable || !options?.includeOptionalJpeg) {
    return {
      id: publicTextFixture.id,
      kind: "text",
      prompt: publicTextFixture.prompt,
    };
  }
  return {
    id: optionalJpegFixture.id,
    kind: "image",
    mimeType: optionalJpegFixture.mimeType,
    publicPath: optionalJpegFixture.publicPath,
    caption: optionalJpegFixture.caption,
    cloudAllowed: false,
  };
}

/** Back-compat alias used by the spike page for the cloud-safe text fixture. */
export const publicFixture = publicTextFixture;
