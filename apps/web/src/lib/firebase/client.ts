"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";
import { getAI, GoogleAIBackend, AgentPlatformBackend, type AI, InferenceMode } from "firebase/ai";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

let appInstance: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let firestoreInstance: Firestore | undefined;
let appCheckInstance: AppCheck | undefined;
let aiInstance: AI | undefined;
let emulatorsConnected = false;

export type SpikeMode = keyof typeof InferenceMode;

function firebaseApp(): FirebaseApp {
  if (appInstance) return appInstance;
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
  if (!Object.values(config).every(Boolean)) {
    throw new Error("Firebase web config is required.");
  }
  appInstance = getApps().length ? getApp() : initializeApp(config);
  return appInstance;
}

export function firebaseAuthClient(): { app: FirebaseApp; auth: Auth; firestore: Firestore } {
  const app = firebaseApp();
  authInstance ??= getAuth(app);
  firestoreInstance ??= getFirestore(app);
  if (!emulatorsConnected && process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "true") {
    connectAuthEmulator(authInstance, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(firestoreInstance, "127.0.0.1", 8080);
    emulatorsConnected = true;
  }
  return { app, auth: authInstance, firestore: firestoreInstance };
}

function firebaseAppCheck(app: FirebaseApp): AppCheck {
  if (appCheckInstance) return appCheckInstance;
  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
  if (!siteKey) throw new Error("Firebase App Check site key is required for protected API calls.");
  if (process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG === "true") {
    const registeredDebugToken = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN?.trim();
    (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      registeredDebugToken && registeredDebugToken.length > 0 ? registeredDebugToken : true;
  }
  appCheckInstance = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return appCheckInstance;
}

export function firebaseAppCheckClient(): AppCheck {
  const { app } = firebaseAuthClient();
  return firebaseAppCheck(app);
}

export function firebaseClient() {
  const { app, auth, firestore } = firebaseAuthClient();
  const appCheck = firebaseAppCheck(app);
  const backend = process.env.NEXT_PUBLIC_FIREBASE_AI_BACKEND === "agent_platform" || process.env.NEXT_PUBLIC_FIREBASE_AI_BACKEND === "vertex"
    ? new AgentPlatformBackend(process.env.NEXT_PUBLIC_FIREBASE_VERTEX_LOCATION || "global")
    : new GoogleAIBackend();
  aiInstance ??= getAI(app, { backend });
  return { app, auth, firestore, appCheck, ai: aiInstance };
}

export { InferenceMode };
