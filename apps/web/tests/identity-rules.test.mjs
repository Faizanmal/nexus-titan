import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const root = new URL("../../../", import.meta.url);
const firestoreRules = await readFile(new URL("firestore.rules", root), "utf8");
const storageRules = await readFile(new URL("storage.rules", root), "utf8");
const projectId = "demo-nexus-identity-rules";
const environment = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules: firestoreRules },
  storage: { host: "127.0.0.1", port: 9199, rules: storageRules },
});

try {
  await environment.clearFirestore();
  await environment.clearStorage();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "organizations/org-alpha/memberships/alice"), {
      active: true, role: "viewer", site_ids: ["site-a"],
    });
    await setDoc(doc(db, "organizations/org-beta/memberships/alice"), {
      active: false, role: "admin", site_ids: [],
    });
    await setDoc(doc(db, "organizations/org-alpha/sites/site-a/projections/projected"), { value: "visible" });
    await setDoc(doc(db, "organizations/org-alpha/sites/site-b/projections/other"), { value: "hidden" });
    await setDoc(doc(db, "organizations/org-beta/sites/site-a/projections/foreign"), { value: "foreign" });
    await setDoc(doc(db, "organizations/org-alpha/sites/site-a/upload_authorizations/auth-good"), {
      status: "approved", user_id: "alice", max_bytes: 16, content_type: "application/pdf",
      classification: "INTERNAL", expires_at: new Date(Date.now() + 60_000),
    });
    await setDoc(doc(db, "organizations/org-alpha/sites/site-a/upload_authorizations/auth-wrong-type"), {
      status: "approved", user_id: "alice", max_bytes: 32, content_type: "application/pdf",
      classification: "RESTRICTED", expires_at: new Date(Date.now() + 60_000),
    });
    await setDoc(doc(db, "organizations/org-alpha/sites/site-a/upload_authorizations/auth-large"), {
      status: "approved", user_id: "alice", max_bytes: 16, content_type: "application/pdf",
      classification: "PUBLIC", expires_at: new Date(Date.now() + 60_000),
    });
    await setDoc(doc(db, "organizations/org-alpha/sites/site-a/upload_authorizations/auth-wrong-mime"), {
      status: "approved", user_id: "alice", max_bytes: 32, content_type: "image/jpeg",
      classification: "PUBLIC", expires_at: new Date(Date.now() + 60_000),
    });
  });

  const alice = environment.authenticatedContext("alice");
  const aliceDb = alice.firestore();
  const aliceStorage = alice.storage("gs://demo-nexus-identity-rules.appspot.com");
  const scopedProjection = doc(aliceDb, "organizations/org-alpha/sites/site-a/projections/projected");
  await assertSucceeds(getDoc(scopedProjection));
  await assertFails(getDoc(doc(aliceDb, "organizations/org-alpha/sites/site-b/projections/other")));
  await assertFails(getDoc(doc(aliceDb, "organizations/org-beta/sites/site-a/projections/foreign")));
  await assertFails(getDocs(collection(aliceDb, "organizations/org-beta/sites/site-a/projections")));
  await assertFails(setDoc(scopedProjection, { value: "client-write" }));
  await assertFails(setDoc(doc(aliceDb, "organizations/org-alpha/memberships/alice"), { active: true, role: "admin" }));
  console.log("PASS Firestore site scope, cross-tenant reads, query denial, and server-only writes");

  const approvedPath = "organizations/org-alpha/sites/site-a/artifacts/auth-good";
  await assertSucceeds(uploadBytes(ref(aliceStorage, approvedPath), new Uint8Array([1, 2, 3]), { contentType: "application/pdf" }));
  await assertSucceeds(getBytes(ref(aliceStorage, approvedPath)));
  await assertFails(uploadBytes(ref(aliceStorage, "organizations/org-beta/sites/site-a/artifacts/auth-good"), new Uint8Array([1]), { contentType: "application/pdf" }));
  await assertFails(uploadBytes(ref(aliceStorage, "organizations/org-alpha/sites/site-b/artifacts/auth-good"), new Uint8Array([1]), { contentType: "application/pdf" }));
  await assertFails(uploadBytes(ref(aliceStorage, "organizations/org-alpha/sites/site-a/artifacts/unknown"), new Uint8Array([1]), { contentType: "application/pdf" }));
  await assertFails(uploadBytes(ref(aliceStorage, "organizations/org-alpha/sites/site-a/artifacts/auth-large"), new Uint8Array(17), { contentType: "application/pdf" }));
  await assertFails(uploadBytes(ref(aliceStorage, "organizations/org-alpha/sites/site-a/artifacts/auth-wrong-mime"), new Uint8Array([1]), { contentType: "application/zip" }));
  await assertFails(uploadBytes(ref(aliceStorage, "organizations/org-alpha/sites/site-a/artifacts/auth-wrong-type"), new Uint8Array([1]), { contentType: "application/pdf" }));
  console.log("PASS Storage approval, site/tenant ACL, MIME, size, immutable object, and approved classification checks");
} finally {
  await environment.cleanup();
}
