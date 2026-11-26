# Firebase identity and tenancy setup

This guide configures development and staging without committing credentials. Use separate Firebase projects for each environment; never point local emulator settings at production.

## Console setup

For each dev/staging project:

1. In Firebase Console, create a project and register the web application. Copy its public web config into an ignored `apps/web/.env.local`; keep `FIREBASE_PROJECT_ID` and the expected `FIREBASE_APP_ID` in the API runtime environment. The web API key is Firebase client configuration, not an Admin credential.
2. In **Authentication → Sign-in method**, enable Email/Password. In **Authentication → Settings → Authorized domains**, add the local development host and the exact staging host.
3. In **App Check**, register the web app with reCAPTCHA Enterprise, add the matching site key to the ignored web environment, and register local debug tokens only in the project’s debug-token list. Never put a debug token in source control or build artifacts. Monitor metrics before enforcing App Check for Firebase products.
4. Enable Cloud Firestore and Cloud Storage. Deploy `firestore.rules` and `storage.rules` only after reviewing the project/environment target. These rules intentionally make membership and upload-authorization writes server-only.
5. For the API, use an attached workload identity/service account with only Firebase Authentication user verification and the required Firestore document read/write permissions. Do not download or commit service-account JSON keys. Set `FIREBASE_PROJECT_ID` and `FIREBASE_APP_ID` in the API runtime. Production startup fails if either is missing, if a Firebase emulator is configured, or if `ALLOW_APPCHECK_BYPASS=true`.
6. The API verifies Firebase ID tokens with revocation checks and independently verifies `X-Firebase-AppCheck` against Firebase. The expected Firebase app ID is compared with the verified App Check token. Firebase product-level App Check enforcement does not replace this custom-endpoint verification.

The current invite endpoint returns a one-time invite token only for `APP_ENV=local` or `test`. Staging/production invites return `INVITE_DELIVERY_UNCONFIGURED` until a verified-email delivery provider is implemented. Do not manually distribute invite tokens through logs or support channels.

## Local emulators

This repository binds Auth, Firestore, Storage, and the Emulator UI to loopback ports 9099, 8080, 9199, and 4000. The rule tests use the Firestore and Storage emulators with synthetic users/data; they do not prove production IAM, real App Check enforcement, or Firebase Auth token verification.

Install a JDK 21+ and Firebase CLI 15.36.0 or later, then from the repository root run:

```powershell
$env:JAVA_HOME = 'C:\Path\To\JDK-21'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
pnpm firebase:rules:emulated
```

```bash
export JAVA_HOME=/path/to/jdk-21
export PATH="$JAVA_HOME/bin:$PATH"
pnpm firebase:rules:emulated
```

The emulator runner downloads official emulator binaries if they are not cached. The tested local host had Java 17.0.12 and no running emulator processes, so this phase’s emulator tests have not passed on that host. Install JDK 21 only through the organization’s normal software process. The API’s emulator bypass is accepted only in `local`/`test`, and local mode additionally requires the loopback Auth emulator. Set both server and web bypass flags only in a local emulator environment. No bypass is accepted in production.

For local API + emulator use, set `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `APP_ENV=local`, and `ALLOW_APPCHECK_BYPASS=true`; configure the web app with `NEXT_PUBLIC_FIREBASE_EMULATORS=true` and `NEXT_PUBLIC_APPCHECK_EMULATOR_BYPASS=true`. The identity demo seed command is `python scripts/task.py identity-seed`; it reads the ignored root `.env`, and requires a verified user created in the Auth emulator and an isolated local PostgreSQL database. It creates/updates only the specified organization/site and owner membership, then writes the minimal Firestore ACL projection.

## Verification boundaries

- Unit tests exercise mocked token verifier outcomes and server-side tenant/role/device checks.
- Emulator rule tests exercise cross-tenant/site reads, client write denial, and artifact ACL/type/size/classification constraints.
- Real production App Check evidence requires a deployed API, enforced App Check configuration, and both a valid token request and a denied invalid/missing token request. No such cloud gate was run in this phase.
- Offline identity is a finite eight-hour, read-only UI cache for a previously Firebase-authenticated user. It never authorizes API calls or creates a first-time offline session.
