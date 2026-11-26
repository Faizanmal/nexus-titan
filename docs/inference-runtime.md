# Adaptive inference runtime configuration

## Lab

Run `pnpm dev`, then open `http://127.0.0.1:3000/inference-lab`. Configure the same local Firebase Web app and App Check site key documented by `docs/firebase/*`; the lab invokes the existing App Check initializer before Firebase AI Logic. Do not put credentials or App Check debug tokens in source control or evidence. Use a registered local debug token only through the existing local `.env` setting; production must use configured reCAPTCHA Enterprise and enforced App Check.

The lab uses a fixed synthetic public-only task and a provisional `fixture_qa` prompt. Select one of the four SDK modes. Explicit approval is needed for modes that can use cloud. The local audit checkbox stores only timestamp, task ID, selected mode, SDK-reported source, latency and terminal status in this browser. It stores neither prompt nor output. Do not enter operational or restricted content; the UI has no free-form prompt field.

## Remote Config parameters

AI Logic configuration uses these keys:

- `nexus_hybrid_model`: allowlisted `gemini-3.5-flash-lite`, `gemini-3.8-flash`, or `gemini-4-hydrogen`.
- `nexus_hybrid_prompt_version`: currently only `fixture-qa-v1`.
- `nexus_hybrid_max_output_tokens`: clamped to 32–512 for cloud generation.
- `nexus_hybrid_cloud_enabled`: `true`/`false`, disables cloud-capable modes when false.

The shipped safe default for `nexus_hybrid_cloud_enabled` is `false`; a project administrator must explicitly enable it in Remote Config for cloud-capable lab modes.

Remote Config values are not proof that a provider/model is enabled or quota is available. The browser capability view reports quota as unknown because no reliable quota API is exposed to this client. On-device generation has no assumed SDK token budget; the prompt and response validation stay short and bounded.

## Platform and gate

The on-device path is Firebase AI Logic's Chrome Prompt API integration; Firebase documentation specifies Chrome Desktop 139+, compatible model availability, model initialization and storage/hardware constraints. It is single-turn and supports text and inline JPEG/PNG only. Emulator Auth/Firestore does not prove inference. The browser lab currently creates a local short-lived lease and does not submit results to the server; a real task service is future work.
