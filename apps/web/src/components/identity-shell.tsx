"use client";

import { onIdTokenChanged, reload, sendEmailVerification, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, type User as FirebaseUser } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { firebaseAuthClient } from "@/lib/firebase/client";
import { IdentityApiError, identityApi } from "@/lib/identity/api";
import { createDeviceProof, localDeviceId } from "@/lib/identity/device-key";
import { clearAllOfflineRecords, clearTenantOffline, listOffline, type DurableTask } from "@nexus-titan/hybrid-web";

type Site = { site_id: string; name: string };
type Membership = { organization_id: string; organization_name: string; role: "owner" | "admin" | "operator" | "viewer"; sites: Site[] };
type Me = { uid: string; email: string | null; email_verified: boolean; memberships: Membership[] };
type Device = { device_id: string; client_device_id: string; label: string; status: "registered" | "revoked"; created_at: string };
type DeviceGroup = { organizationId: string; devices: Device[] };
type AuthState = "starting" | "signed_out" | "loading" | "signed_in" | "offline" | "error";
type CachedIdentity = { me: Me; verifiedAt: string; leaseExpiresAt: string };

const CACHE_KEY = "nexus-authorized-identity-cache-v1";
const CACHE_LEASE_MS = 8 * 60 * 60 * 1000;

function readCache(uid: string): CachedIdentity | null {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as CachedIdentity | null;
    if (!value || value.me.uid !== uid || Date.parse(value.leaseExpiresAt) <= Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The identity request failed.";
}

export default function IdentityShell() {
  const [state, setState] = useState<AuthState>("starting");
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [devices, setDevices] = useState<DeviceGroup[]>([]);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "operator" | "admin">("viewer");
  const [inviteSiteIds, setInviteSiteIds] = useState("");
  const [siteId, setSiteId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedOrganization, setSelectedOrganization] = useState("");
  const [sessionExpiresAt, setSessionExpiresAt] = useState("");

  const selectedMembership = useMemo(
    () => me?.memberships.find((membership) => membership.organization_id === selectedOrganization) ?? me?.memberships[0],
    [me, selectedOrganization],
  );

  async function loadDevices(profile: Me) {
    const groups = await Promise.all(profile.memberships.map(async (membership) => {
      try {
        const result = await identityApi<{ devices: Device[] }>(`/v1/organizations/${encodeURIComponent(membership.organization_id)}/devices`);
        return { organizationId: membership.organization_id, devices: result.devices };
      } catch {
        return { organizationId: membership.organization_id, devices: [] };
      }
    }));
    setDevices(groups);
  }

  async function refreshProfile(activeUser: FirebaseUser) {
    setState("loading");
    try {
      const profile = await identityApi<Me>("/v1/me");
      if (activeUser.uid !== profile.uid) throw new IdentityApiError("The API identity does not match the signed-in user.", 401, "IDENTITY_MISMATCH");
      const tokenResult = await activeUser.getIdTokenResult();
      setSessionExpiresAt(tokenResult.expirationTime);
      const now = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        me: profile,
        verifiedAt: new Date(now).toISOString(),
        leaseExpiresAt: new Date(now + CACHE_LEASE_MS).toISOString(),
      } satisfies CachedIdentity));
      setMe(profile);
      window.dispatchEvent(new Event("nexus-profile-updated"));
      setSelectedOrganization((current) => profile.memberships.some((item) => item.organization_id === current) ? current : profile.memberships[0]?.organization_id ?? "");
      setState("signed_in");
      setMessage("");
      void loadDevices(profile);
    } catch (error) {
      if (error instanceof IdentityApiError && error.status === 401) {
        localStorage.removeItem(CACHE_KEY);
        await signOut(firebaseAuthClient().auth);
        setState("signed_out");
        setMe(null);
        setMessage("Your server session expired or was revoked. Sign in again.");
        return;
      }
      if (error instanceof IdentityApiError && error.status === 403) {
        setMe(null);
        setState("error");
        setMessage(`${error.message} The server rejected this session; cached identity is not used for an authorization failure.`);
        return;
      }
      const cached = readCache(activeUser.uid);
      if (cached) {
        setMe(cached.me);
        window.dispatchEvent(new Event("nexus-profile-updated"));
        setSelectedOrganization(cached.me.memberships[0]?.organization_id ?? "");
        setState("offline");
        setMessage(`Offline read-only identity cache. Lease expires ${new Date(cached.leaseExpiresAt).toLocaleString()}. No API action is authorized offline.`);
      } else {
        setMe(null);
        setState("error");
        setMessage(`${errorMessage(error)} No authorized offline identity cache is available.`);
      }
    }
  }

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      const { auth } = firebaseAuthClient();
      unsubscribe = onIdTokenChanged(auth, (activeUser) => {
        setUser(activeUser);
        if (!activeUser) {
          localStorage.removeItem(CACHE_KEY);
          void clearAllOfflineRecords().catch(() => undefined);
          setMe(null);
          window.dispatchEvent(new Event("nexus-profile-updated"));
          setDevices([]);
          setState("signed_out");
          return;
        }
        void refreshProfile(activeUser);
      });
    } catch (error) {
      const message = errorMessage(error);
      queueMicrotask(() => {
        setState("error");
        setMessage(message);
      });
    }
    return () => unsubscribe?.();
    // Firebase observer is installed once; refreshProfile reads current API state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const { auth } = firebaseAuthClient();
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function doSignUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inviteToken.trim()) {
      setMessage("An organization invite code is required to create an account.");
      return;
    }
    setBusy(true);
    try {
      const { auth } = firebaseAuthClient();
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await sendEmailVerification(credential.user);
      setMessage("Account created. Verify your email, then sign in and accept the invitation code.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function doSignOut() {
    if (!user) return;
    const tenantIds = new Set(me?.memberships.map((item) => item.organization_id) ?? []);
    const [events, states] = await Promise.all([listOffline<DurableTask>("outbox"), listOffline<{taskId: string; state: DurableTask["state"]}>("outbox_states")]);
    const stateById = new Map(states.map((row) => [row.taskId, row.state]));
    const pending = events.filter((row) => tenantIds.has(row.tenantId) && stateById.get(row.id) !== "acked").length;
    if (!window.confirm(`Sign out and clear authorized offline data?${pending ? ` ${pending} pending change(s) will be deleted and cannot sync.` : ""}`)) return;
    for (const membership of me?.memberships ?? []) await clearTenantOffline(membership.organization_id);
    await signOut(firebaseAuthClient().auth);
  }

  async function refreshVerifiedEmail() {
    if (!user) return;
    setBusy(true);
    try {
      await reload(user);
      await user.getIdToken(true);
      await refreshProfile(user);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvite() {
    if (!user || !inviteToken.trim()) return;
    setBusy(true);
    try {
      await reload(user);
      await user.getIdToken(true);
      await identityApi("/v1/invites/accept", { method: "POST", body: JSON.stringify({ invite_token: inviteToken.trim() }) });
      setInviteToken("");
      setMessage("Invitation accepted.");
      await refreshProfile(user);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMembership) return;
    setBusy(true);
    try {
      const result = await identityApi<{ invite_token: string; email: string; role: string; expires_at: string }>(
        `/v1/organizations/${encodeURIComponent(selectedMembership.organization_id)}/invites`,
        { method: "POST", body: JSON.stringify({ email: inviteEmail, role: inviteRole, site_ids: inviteSiteIds.split(",").map((value) => value.trim()).filter(Boolean) }) },
      );
      setInviteToken(result.invite_token);
      setMessage(`One-time invite for ${result.email} (${result.role}) expires ${new Date(result.expires_at).toLocaleString()}. Copy the code now; it will not be shown again.`);
      setInviteEmail("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMembership) return;
    setBusy(true);
    try {
      await identityApi(`/v1/organizations/${encodeURIComponent(selectedMembership.organization_id)}/sites`, {
        method: "POST", body: JSON.stringify({ site_id: siteId, name: siteName }),
      });
      setSiteId("");
      setSiteName("");
      if (user) await refreshProfile(user);
      setMessage("Site created.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function registerDevice() {
    if (!selectedMembership) return;
    setBusy(true);
    try {
      const id = localDeviceId();
      const challenge = await identityApi<{ challenge_id: string; challenge: string }>(
        `/v1/organizations/${encodeURIComponent(selectedMembership.organization_id)}/devices/challenges`,
        { method: "POST", body: JSON.stringify({ client_device_id: id }) },
      );
      const proof = await createDeviceProof(challenge.challenge);
      await identityApi(`/v1/organizations/${encodeURIComponent(selectedMembership.organization_id)}/devices`, {
        method: "POST",
        body: JSON.stringify({ challenge_id: challenge.challenge_id, client_device_id: proof.deviceId, label: proof.label, public_key_pem: proof.publicKeyPem, signature_base64: proof.signatureBase64 }),
      });
      if (me) await loadDevices(me);
      setMessage("This browser proved possession of its private key and is registered for the selected organization.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function revokeDevice(organizationId: string, deviceId: string) {
    setBusy(true);
    try {
      await identityApi(`/v1/organizations/${encodeURIComponent(organizationId)}/devices/${encodeURIComponent(deviceId)}/revoke`, { method: "POST" });
      if (me) await loadDevices(me);
      setMessage("Device revoked. Its registered key cannot be reused.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const canAdmin = selectedMembership?.role === "owner" || selectedMembership?.role === "admin";

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-6 md:p-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-sm font-semibold tracking-widest text-teal-700">NEXUS TITAN · IDENTITY</p>
          <h1 className="text-3xl font-bold">Organization workspace</h1>
        </div>
        {user && <button className="rounded border px-4 py-2" onClick={() => void doSignOut()}>Sign out</button>}
      </header>

      <p role="status" aria-live="polite" className="rounded bg-slate-100 p-3 text-sm">{message || `Session state: ${state}`}</p>

      {!user && state !== "starting" && (
        <section className="grid gap-6 md:grid-cols-2">
          <form className="space-y-3 rounded border p-5" onSubmit={(event) => void doSignIn(event)}>
            <h2 className="text-xl font-semibold">Sign in</h2>
            <label className="block">Email<input className="mt-1 w-full rounded border p-2" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="block">Password<input className="mt-1 w-full rounded border p-2" type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Sign in</button>
          </form>
          <form className="space-y-3 rounded border p-5" onSubmit={(event) => void doSignUp(event)}>
            <h2 className="text-xl font-semibold">Create account from invite</h2>
            <label className="block">Invite code<input className="mt-1 w-full rounded border p-2" required value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} /></label>
            <label className="block">Email<input className="mt-1 w-full rounded border p-2" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="block">Password<input className="mt-1 w-full rounded border p-2" type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button disabled={busy} className="rounded border px-4 py-2 disabled:opacity-50">Create account and send verification email</button>
          </form>
        </section>
      )}

      {user && me && (
        <>
          <section className="rounded border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-xl font-semibold">{me.email ?? me.uid}</h2><p className="text-sm">Server-verified Firebase identity · email {me.email_verified ? "verified" : "not verified"} · token expires {sessionExpiresAt || "unavailable"} · {state === "offline" ? "offline, read-only" : "online"}</p></div>
              {me.memberships.length > 0 && <label>Organization<select className="ml-2 rounded border p-2" value={selectedMembership?.organization_id ?? ""} onChange={async (event) => { const previous = selectedMembership?.organization_id; const next = event.target.value; if (previous && previous !== next) { const [events, states] = await Promise.all([listOffline<DurableTask>("outbox"), listOffline<{taskId: string; state: DurableTask["state"]}>("outbox_states")]); const stateById = new Map(states.map((row) => [row.taskId, row.state])); const pending = events.filter((row) => row.tenantId === previous && stateById.get(row.id) !== "acked").length; if (!window.confirm(`Switch organization and clear its authorized offline data?${pending ? ` ${pending} pending change(s) will be deleted and cannot sync.` : ""}`)) return; await clearTenantOffline(previous); } setSelectedOrganization(next); }}>{me.memberships.map((membership) => <option key={membership.organization_id} value={membership.organization_id}>{membership.organization_name} · {membership.role}</option>)}</select></label>}
            </div>
            {me.memberships.length === 0 && <p className="mt-4">No organization membership is active. Use an invite from an organization administrator.</p>}
            {!me.email_verified && <div className="mt-3 flex flex-wrap items-center gap-2 text-amber-800"><span>Verify your email before accepting an invitation.</span><button disabled={busy || state === "offline"} className="rounded border px-3 py-1" onClick={() => void refreshVerifiedEmail()}>Refresh verified session</button></div>}
            {inviteToken && <div className="mt-4 space-y-2"><label className="block">Invitation code<input className="mt-1 w-full rounded border p-2 font-mono" value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} /></label><button disabled={busy || !me.email_verified || state === "offline"} className="rounded bg-teal-700 px-4 py-2 text-white disabled:opacity-50" onClick={() => void acceptInvite()}>Accept invitation</button></div>}
          </section>

          {selectedMembership && (
            <section className="grid gap-6 md:grid-cols-2">
              <div className="rounded border p-5">
                <h2 className="text-xl font-semibold">Sites · {selectedMembership.organization_name}</h2>
                <ul className="mt-3 space-y-2">{selectedMembership.sites.map((site) => <li className="rounded bg-slate-50 p-2" key={site.site_id}>{site.name} <span className="text-slate-500">({site.site_id})</span></li>)}</ul>
                {canAdmin && state !== "offline" && <form className="mt-4 space-y-2 border-t pt-4" onSubmit={(event) => void createSite(event)}><h3 className="font-semibold">Add site</h3><input className="w-full rounded border p-2" aria-label="Site ID" placeholder="site-id" pattern="[a-z0-9][a-z0-9_-]{1,62}" required value={siteId} onChange={(event) => setSiteId(event.target.value)} /><input className="w-full rounded border p-2" aria-label="Site name" placeholder="Site name" required value={siteName} onChange={(event) => setSiteName(event.target.value)} /><button disabled={busy} className="rounded border px-3 py-2">Create site</button></form>}
              </div>
              <div className="rounded border p-5">
                <h2 className="text-xl font-semibold">Devices</h2>
                <p className="mt-1 text-sm text-slate-600">Keys are proven with a one-time challenge. Revoked keys cannot be registered again under the same device ID.</p>
                {(devices.find((group) => group.organizationId === selectedMembership.organization_id)?.devices ?? []).map((device) => <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 p-3" key={device.device_id}><span>{device.label} · {device.status}</span>{device.status === "registered" && state !== "offline" && <button disabled={busy} className="rounded border px-3 py-1" onClick={() => void revokeDevice(selectedMembership.organization_id, device.device_id)}>Revoke</button>}</div>)}
                {state === "offline" ? <p className="mt-3">Device status is unavailable offline.</p> : <button disabled={busy} className="mt-4 rounded border px-3 py-2" onClick={() => void registerDevice()}>Register this browser</button>}
              </div>
            </section>
          )}

          {canAdmin && selectedMembership && state !== "offline" && (
            <form className="space-y-3 rounded border p-5" onSubmit={(event) => void createInvite(event)}>
              <h2 className="text-xl font-semibold">Invite a member</h2>
              <p className="text-sm">The invite code is shown once. Share it only with the intended verified email using an approved channel.</p>
              <div className="grid gap-3 md:grid-cols-3"><input className="rounded border p-2" type="email" placeholder="person@example.com" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /><select className="rounded border p-2" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}><option value="viewer">Viewer</option><option value="operator">Operator</option>{selectedMembership.role === "owner" && <option value="admin">Admin</option>}</select><input className="rounded border p-2" placeholder="site ids, comma separated" value={inviteSiteIds} onChange={(event) => setInviteSiteIds(event.target.value)} /></div>
              <button disabled={busy || !me.email_verified} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Create 24-hour invite</button>
            </form>
          )}
        </>
      )}

      {state === "offline" && <p className="rounded border border-amber-400 bg-amber-50 p-4">This cached identity is for display only. No first-time offline login or offline API write is allowed.</p>}
    </main>
  );
}
