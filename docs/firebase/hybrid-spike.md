# Firebase AI Logic hybrid spike

Status on 2026-11-14: implementation and local software checks are present; Gates A–C remain **BLOCKED** pending Firebase project access and interactive on-device/offline proof. The `/firebase-spike` route makes real SDK calls; it does not synthesize inference source values. See [phase evidence](../evidence/phase-02.md).

## Current official support reviewed

| Platform | SDK / model provider | Device and requirements | Readiness / limits |
|---|---|---|---|
| Web | Firebase JS SDK pinned to `13.3.0`; on-device model is Chrome Prompt API (Gemini Nano); cloud is Gemini Developer API via `GoogleAIBackend` | Chrome desktop 139+; `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled and browser restarted; sufficient storage. **This host has Chrome 157.0.8103.78**; flag/model download not yet verified interactively. | `initializeDeviceModel()` starts model download and reports progress. Text-only single-turn is supported; model must be downloaded for on-device. |
| Android (future native spike) | Firebase AI Logic Android `18.2.0`; on-device `firebase-ai-ondevice` `16.0.0-beta08`; App Check debug `20.1.0` | SDK docs require AI Logic 17.10.0+/BoM 34.10.0+, on-device min API 26. ML Kit Prompt API on supported devices; AICore manages the model. **No Android SDK/ADB/device here.** | Supported device/model availability must be checked against the live ML Kit list on a real device. |
| Apple (future native spike) | Firebase Apple SDK `13.1.1` (release notes; SPM); hybrid guide minimum `12.13.0` | Xcode 26.2+ (Firebase 13 requires Swift 6.2.3); iOS 15+; Apple Intelligence device. **No Mac/Xcode/iPhone here.** | On-device provider is Apple Foundation Models; OS downloads when Apple Intelligence is enabled. |

Version sources: [Firebase JS release notes](https://firebase.google.com/support/release-notes/js) (13.3.0, Nov 11, 2026), [Firebase Apple release notes](https://firebase.google.com/support/release-notes/ios) (13.1.1, Oct 22, 2026), [Web hybrid guide](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started), [configuration options](https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options), [Android hybrid guide](https://firebase.google.com/docs/ai-logic/hybrid/android/get-started), [Apple hybrid guide](https://firebase.google.com/docs/ai-logic/hybrid/ios/get-started), [JS AI reference](https://firebase.google.com/docs/reference/js/ai). Hybrid features are experimental on native Android/Apple per the current guides. This repo pins the Web SDK exactly; native versions are documentation snapshots, not lockfiles.

No agent skills were used for this spike.

The spike uses cloud model `gemini-3.5-flash-lite` (guide default as of review). The SDK exposes `response.inferenceSource`. The JS API enum values are `on_device` and `in_cloud` (`InferenceSource.ON_DEVICE` / `InferenceSource.IN_CLOUD`); the guide text uses the labels `ON_DEVICE` / `IN_CLOUD`. The web mapper accepts both and never invents a source from mode.

## Firebase console setup (dev and staging)

Create separate `nexus-titan-dev` and `nexus-titan-staging` Firebase projects in the [Firebase console](https://console.firebase.google.com/). No project credentials/config have been added to this repository.

For each project:

1. Add a Web app and copy its web config into an ignored local `.env.local`, using `.env.example` as the variable list. Firebase web app config is public client configuration, not a server secret; never add service-account keys or App Check debug tokens here.
2. Open **AI Services → AI Logic → Get started**. Choose Gemini Developer API for this spike and complete the guided setup. It configures required APIs and enforces App Check. Do not use restricted/private content with this public-client test.
3. In **App Check → Apps**, register the app with reCAPTCHA Enterprise and put its site key in `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`. In **App Check → APIs**, confirm Firebase AI Logic says **Enforced**. For local development only set `NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG=true`; open DevTools, register the one-time printed debug token under **Manage debug tokens**, and keep the token private. Never paste it into a ticket, screenshot, log artifact, or source.
4. Enable Authentication and select only the provider the app needs; add `localhost` and the eventual staging host under **Authentication → Settings → Authorized domains**. Phase 02 does not add end-user authentication UI.
5. Create Firestore in the project if a future integration needs it. The checked-in local emulator rules deny every read/write; do not deploy those rules as a production policy without a reviewed tenant policy.
6. Enable Remote Config if needed for future experiments; no feature flags or remote values are used by this spike.
7. In **AI Logic / usage and billing/quota views**, record project-specific model, RPM/TPM, daily limits, billing tier, and current usage before testing. The official Firebase AI Logic guide states the gateway's default per-user limit is 100 RPM; underlying Gemini Developer API quota is project/model/provider-specific. See [official quotas](https://firebase.google.com/docs/ai-logic/quotas).

### Firebase CLI

Official install: `npm install -g firebase-tools` ([CLI setup](https://firebase.google.com/docs/cli)). Prefer **Node 20, 22, or 24** (this host is Node 26.5.0; `superstatic` warns and global install did not complete). After owner auth: `firebase login`, `firebase projects:list`, `firebase emulators:start --only auth,firestore --project <dev-project-id>`. Emulators cover Auth/Firestore only and do **not** prove hybrid inference. A workspace `pnpm add -D firebase-tools` attempt was abandoned after `re2` build-script policy failure; CLI remains an out-of-band tool.

## Local operation

1. Copy `.env.example` to `.env.local`, fill the values from your dev web app registration, and set the App Check site key. Use the debug provider only on a private local development app. Do not commit `.env.local`.
2. Start the web client with `pnpm dev`, then visit `http://127.0.0.1:3000/firebase-spike`.
3. Use one of the four mode buttons. The test prompt is fixed public text via the fixture adapter. The page displays SDK source, result/error, model readiness state and elapsed time. It persists only sanitized metadata to this browser's local storage.
4. Optional JPEG fixture: `apps/web/public/fixtures/public-router-sample.jpg`. The adapter never selects it for `PREFER_*` or cloud modes.
5. For a local Auth/Firestore emulator, use `firebase emulators:start --only auth,firestore --project <dev-project-id>`. No emulator connection is inference evidence.

Debug provider docs: [Web App Check debug provider](https://firebase.google.com/docs/app-check/web/debug-provider). App Check enforcement for AI Logic is required starting Nov 2, 2026 ([official App Check guide](https://firebase.google.com/docs/ai-logic/app-check)).

## Proof protocol and gates

- **A — cloud source:** configured project; run `ONLY_IN_CLOUD` on the safe fixture; capture UI showing mapped `IN_CLOUD` plus Firebase AI Logic request metrics. Redact project IDs and tokens.
- **B — on-device + offline:** Chrome 139+ with required flag; wait for model readiness; capture real `ONLY_ON_DEVICE` → `ON_DEVICE`. Then OS network toggle (preferred) or agreed DevTools isolation; confirm a fresh on-device request succeeds with traffic capture showing no cloud request. Also verify `ONLY_ON_DEVICE` fails when the model is unavailable (no silent cloud fallback). Mode selection alone is not evidence.
- **C — App Check:** capture a valid enforced request and an intentionally unverified/denied request, with debug token and project identifiers redacted.

Required capture fields: UTC timestamp, Chrome/OS or device/model/OS versions, SDK version, mode, model readiness, observed `inferenceSource`, latency, outcome, App Check state, network-isolation method, redacted traffic evidence. Never send restricted data in the cloud test.

## Device access on this workspace

| Resource | Access now |
|---|---|
| Windows 10 host | Yes |
| Chrome Desktop 157 | Yes (path above); Prompt API/model not yet proven |
| Firebase project / `.env.local` | No |
| Firebase CLI | Not installed/verified (Node 26 engine friction) |
| Android SDK / ADB / device | No |
| Mac / Xcode / Apple Intelligence device | No |

Native spike projects belong in later prompts using real Android Studio / Xcode templates—not fabricated artifacts.

## Architecture note

See [ADR-0010](../adr/0010-firebase-ai-logic-hybrid-spike.md). Fixture adapter and Firebase provider are separate modules; test injection cannot set `actualSource` to `ON_DEVICE`.
