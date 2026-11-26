# ADR-0010: Firebase AI Logic hybrid spike (web)

- Status: Accepted for Phase 02 spike; release gates remain open until device evidence exists
- Date: 2026-11-14

## Context
Phase 02 requires a real Firebase AI Logic hybrid proof with App Check, four inference modes, and SDK-reported `inferenceSource`. Emulators cover Auth/Firestore only and do not prove inference.

## Decision
- Use Firebase JS SDK `13.3.0` with `getAI` + `GoogleAIBackend`, `getGenerativeModel`, and explicit `InferenceMode` values.
- Initialize App Check (reCAPTCHA Enterprise; local debug token via supported mechanism only) before creating or calling AI.
- Treat `response.inferenceSource` as the only source of truth for ON_DEVICE vs IN_CLOUD; never infer from mode or test injection.
- Keep a public text fixture adapter separate from the Firebase provider. PREFER_* and cloud modes always use that public text; optional JPEG is not sent to cloud.
- Local Auth/Firestore emulators remain optional and out of band for inference evidence.

## Consequences
Cloud, on-device/offline, and App Check enforcement each require real project/device evidence and stay VERIFIED or BLOCKED independently. Native Android/Apple spikes are deferred to later prompts with real toolchains—not simulated artifacts.
