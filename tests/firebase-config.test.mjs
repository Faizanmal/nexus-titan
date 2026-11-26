import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const firebaseConfig = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
const webPackage = JSON.parse(await readFile(new URL("../apps/web/package.json", import.meta.url), "utf8"));
const firestoreRules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const storageRules = await readFile(new URL("../storage.rules", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const spikePage = await readFile(new URL("../apps/web/src/app/firebase-spike/page.tsx", import.meta.url), "utf8");

assert.deepEqual(Object.keys(firebaseConfig.emulators).sort(), ["auth", "firestore", "singleProjectMode", "storage", "ui"]);
assert.equal(firebaseConfig.emulators.auth.host, "127.0.0.1");
assert.equal(firebaseConfig.emulators.auth.port, 9099);
assert.equal(firebaseConfig.emulators.firestore.host, "127.0.0.1");
assert.equal(firebaseConfig.emulators.firestore.port, 8080);
assert.equal(firebaseConfig.emulators.storage.host, "127.0.0.1");
assert.equal(firebaseConfig.emulators.storage.port, 9199);
assert.equal(firebaseConfig.emulators.ui.host, "127.0.0.1");
assert.equal(firebaseConfig.emulators.ui.port, 4000);
console.log("PASS local Auth/Firestore emulator scope and loopback bindings");

assert.match(firestoreRules, /allow read, write: if false;/);
console.log("PASS local Firestore emulator rules deny all access");
assert.match(firebaseConfig.storage.rules, /storage\.rules/);
assert.match(storageRules, /allow read, write: if false;/);
console.log("PASS local Storage emulator rules deny all access");

assert.equal(webPackage.dependencies.firebase, "13.3.0");
assert.match(envExample, /NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG=false/);
assert.match(envExample, /^NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN=\s*$/m);
assert.match(envExample, /^NEXT_PUBLIC_INFERENCE_PROVIDER=(fixture|firebase)$/m);
assert.match(spikePage, /providerMode === "fixture"[\s\S]*?no inference request was sent/);
console.log("PASS Firebase SDK pin and no debug token in example config");
