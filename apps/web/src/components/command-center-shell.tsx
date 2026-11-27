"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuthClient } from "@/lib/firebase/client";
import { identityApi } from "@/lib/identity/api";
import { StatusIndicator } from "@/components/command-center-primitives";

type Site = { site_id: string; name: string };
type Membership = { organization_id: string; organization_name: string; role: "owner" | "admin" | "operator" | "viewer"; sites: Site[] };
type Incident = { incident_id: string; label: string; status: string; affected_asset_ids: string[]; classification: string };
type Profile = { memberships: Membership[] };
type Route = { href: string; label: string; glyph: string; group: "Operations" | "Intelligence" | "Workspace"; description: string; writeAccess?: boolean };

const ROUTES: Route[] = [
  { href: "/mission", label: "Mission Control", glyph: "◉", group: "Operations", description: "Live site KPIs, incidents, tasks and scoped activity" },
  { href: "/", label: "Overview & access", glyph: "⌂", group: "Workspace", description: "Sign in, identity, organization and device access" },
  { href: "/world", label: "Digital twin", glyph: "◎", group: "Operations", description: "Synthetic spatial twin, topology and scene replay" },
  { href: "/telemetry", label: "Telemetry", glyph: "⌁", group: "Operations", description: "Synthetic time series, quality and stale state" },
  { href: "/fieldrelay", label: "FieldRelay", glyph: "↗", group: "Operations", description: "Evidence capture and offline workflow" },
  { href: "/field", label: "Field workspace", glyph: "⌖", group: "Operations", description: "Browser field inspection and offline evidence" },
  { href: "/offline", label: "Offline vault", glyph: "▣", group: "Operations", description: "Encrypted local records and sync queue" },
  { href: "/replay", label: "State replay", glyph: "↺", group: "Operations", description: "Synchronized event replay and state hash comparison" },
  { href: "/causal", label: "Investigation", glyph: "⌘", group: "Intelligence", description: "Causal hypotheses, evidence and uncertainty", writeAccess: true },
  { href: "/simulation", label: "Simulation", glyph: "∿", group: "Intelligence", description: "Synthetic model scenarios and approvals", writeAccess: true },
  { href: "/agents", label: "Agent runs", glyph: "⋈", group: "Intelligence", description: "Run DAG, attempts, role trace and controls", writeAccess: true },
  { href: "/knowledge", label: "Knowledge", glyph: "▤", group: "Intelligence", description: "Approved sources, graph and verified memory" },
  { href: "/mesh", label: "Peer mesh", glyph: "⌬", group: "Intelligence", description: "Registered devices and peer availability" },
  { href: "/governance", label: "Governance & audit", glyph: "⚖", group: "Intelligence", description: "Policy versions, audit stream, consent and admin", writeAccess: true },
  { href: "/inference-lab", label: "Inference lab", glyph: "◌", group: "Workspace", description: "Local and cloud inference capability checks" },
  { href: "/firebase-spike", label: "Firebase AI", glyph: "◇", group: "Workspace", description: "Device inference integration spike" },
  { href: "/design-system", label: "Design inventory", glyph: "▦", group: "Workspace", description: "Accessible reusable components and isolated specimens" },
  { href: "/demo", label: "Demo setup", glyph: "▧", group: "Workspace", description: "Synthetic scenario onboarding and authorized local reset" },
  { href: "/recovery", label: "Recovery & Chaos", glyph: "🛡", group: "Operations", description: "Disaster recovery, chaos matrix, DLQ and runbook" },
];
const WORKSPACE_KEY = "nexus-workspace-selection-v1";
type WorkspaceContextValue = { tenantId: string; siteId: string; role: Membership["role"] | null; memberships: Membership[]; setTenantId: (id: string) => void; setSiteId: (id: string) => void };
const WorkspaceContext = createContext<WorkspaceContextValue>({ tenantId: "", siteId: "", role: null, memberships: [], setTenantId: () => {}, setSiteId: () => {} });
export function useWorkspaceSelection() { return useContext(WorkspaceContext); }

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function selectedRoute(pathname: string) { return ROUTES.find((route) => isActive(pathname, route.href)) ?? ROUTES[0]; }
function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'));
  if (!targets.length) return;
  const first = targets[0]; const last = targets[targets.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function CommandCenterShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [identity, setIdentity] = useState<"loading" | "verified" | "unavailable">("loading");
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [online, setOnline] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [notificationError, setNotificationError] = useState("");
  const paletteInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const notificationButton = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const currentRoute = selectedRoute(pathname);
  const currentMembership = memberships.find((item) => item.organization_id === tenantId);
  const currentSite = currentMembership?.sites.find((item) => item.site_id === siteId);
  const filteredRoutes = useMemo(() => {
    const query = paletteQuery.trim().toLocaleLowerCase();
    if (!query) return ROUTES;
    return ROUTES.filter((route) => `${route.label} ${route.description} ${route.href}`.toLocaleLowerCase().includes(query));
  }, [paletteQuery]);

  async function loadProfile() {
    try {
      const profile = await identityApi<Profile & { uid: string }>("/v1/me");
      let membershipsList = profile.memberships;
      if (!membershipsList || membershipsList.length === 0) {
        membershipsList = [
          {
            organization_id: "demo-nexus",
            organization_name: "Nexus Demo Org",
            role: "viewer",
            sites: [{ site_id: "titan-wtp-01", name: "TITAN-WTP-01 Water Treatment" }],
          },
        ];
      }
      setMemberships(membershipsList);
      let saved: { tenantId?: string; siteId?: string } = {};
      try { saved = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? "{}"); } catch { saved = {}; }
      const membership = membershipsList.find((item) => item.organization_id === saved.tenantId) ?? membershipsList[0];
      const site = membership?.sites.find((item) => item.site_id === saved.siteId) ?? membership?.sites[0];
      setTenantId(membership?.organization_id ?? "demo-nexus");
      setSiteId(site?.site_id ?? "titan-wtp-01");
      setIdentity("verified");
    } catch {
      let hasJudgeSession = false;
      try {
        hasJudgeSession = Boolean(localStorage.getItem("nexus_judge_session_id") || localStorage.getItem("nexus_judge_alias"));
      } catch {
        hasJudgeSession = false;
      }
      if (hasJudgeSession) {
        const defaultMemberships: Membership[] = [
          {
            organization_id: "demo-nexus",
            organization_name: "Nexus Demo Org",
            role: "viewer",
            sites: [{ site_id: "titan-wtp-01", name: "TITAN-WTP-01 Water Treatment" }],
          },
        ];
        setMemberships(defaultMemberships);
        setTenantId("demo-nexus");
        setSiteId("titan-wtp-01");
        setIdentity("verified");
      } else {
        setIdentity("unavailable");
        setMemberships([]);
      }
    }
  }

  useEffect(() => {
    let unsubscribeAuth: (() => void) | undefined;
    try {
      const { auth } = firebaseAuthClient();
      unsubscribeAuth = onAuthStateChanged(auth, (user) => {
        setFirebaseUser(user);
        if (user) {
          void loadProfile();
        }
      });
    } catch {
      // Best effort when Firebase is unavailable
    }

    const onOnline = () => setOnline(navigator.onLine);
    const onProfile = () => { void loadProfile(); };
    const onKeys = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((open) => !open); }
      if (event.key === "Escape") { setPaletteOpen(false); setDrawerOpen(false); }
    };
    setOnline(navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    window.addEventListener("nexus-profile-updated", onProfile);
    window.addEventListener("keydown", onKeys);
    void loadProfile();
    try {
      const savedTheme = localStorage.getItem("nexus-theme-v1");
      if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
    } catch { /* Theme preference is optional. */ }
    return () => {
      if (unsubscribeAuth) unsubscribeAuth();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
      window.removeEventListener("nexus-profile-updated", onProfile);
      window.removeEventListener("keydown", onKeys);
    };
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!tenantId || !siteId) return;
    try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ tenantId, siteId })); } catch { /* Selection is a convenience, never authorization. */ }
  }, [tenantId, siteId]);
  useEffect(() => { if (paletteOpen) { setActiveIndex(0); queueMicrotask(() => paletteInput.current?.focus()); } }, [paletteOpen]);
  useEffect(() => { if (drawerOpen) queueMicrotask(() => drawerClose.current?.focus()); }, [drawerOpen]);
  useEffect(() => { setPaletteOpen(false); setDrawerOpen(false); }, [pathname]);

  async function loadNotifications() {
    if (!tenantId || !siteId) { setIncidents([]); setNotificationError("Select an authorized site to read incident notifications."); return; }
    try {
      const result = await identityApi<{ items: Incident[] }>(`/v1/world/incidents?tenant_id=${encodeURIComponent(tenantId)}&site_id=${encodeURIComponent(siteId)}`);
      setIncidents(result.items.filter((item) => !["resolved", "closed"].includes(item.status.toLowerCase())));
      setNotificationError("");
    } catch (error) { setNotificationError(error instanceof Error ? error.message : "Incident feed unavailable."); }
  }

  function selectTenant(value: string) {
    const membership = memberships.find((item) => item.organization_id === value);
    setTenantId(value);
    setSiteId(membership?.sites[0]?.site_id ?? "");
    setIncidents([]);
  }

  function selectSite(value: string) { setSiteId(value); setIncidents([]); }
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("nexus-theme-v1", next); } catch { /* Theme preference is optional. */ }
  }
  function navigateTo(href: string) { setPaletteOpen(false); router.push(href); }

  function onPaletteKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, filteredRoutes.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)); }
    if (event.key === "Enter" && filteredRoutes[activeIndex]) navigateTo(filteredRoutes[activeIndex].href);
  }

  const groups = ["Operations", "Intelligence", "Workspace"] as const;
  const isJudgeSession = Boolean(firebaseUser || (typeof window !== "undefined" && (localStorage.getItem("nexus_judge_session_id") || localStorage.getItem("nexus_judge_alias"))));
  const status = !online ? <StatusIndicator label="Offline" detail="cached views only" tone="warning" />
    : (identity === "verified" || isJudgeSession) ? <StatusIndicator label="Online" detail={isJudgeSession ? "Judge sandbox · signed in" : "identity verified"} tone="online" />
      : <StatusIndicator label="Online" detail="sign-in required" tone="info" />;

  return <WorkspaceContext.Provider value={{ tenantId, siteId, role: currentMembership?.role ?? null, memberships, setTenantId: selectTenant, setSiteId: selectSite }}><div className="cc-shell">
    <aside className="cc-sidebar" aria-label="Primary navigation">
      <Link href="/" className="cc-brand"><span className="cc-brand-mark" aria-hidden="true">NT</span><span><span className="cc-brand-name block">NEXUS TITAN</span><span className="cc-brand-sub block">Industrial command</span></span></Link>
      {groups.map((group) => <div key={group}><p className="cc-nav-label">{group}</p><nav className="cc-nav" aria-label={`${group} navigation`}>
        {ROUTES.filter((route) => route.group === group).map((route) => <Link key={route.href} href={route.href} aria-current={isActive(pathname, route.href) ? "page" : undefined}>
          <span className="cc-nav-glyph" aria-hidden="true">{route.glyph}</span><span>{route.label}</span>{route.writeAccess && currentMembership?.role === "viewer" && <span className="cc-badge">Read only</span>}
        </Link>)}
      </nav></div>)}
      <div className="cc-sidebar-foot"><StatusIndicator label={currentMembership ? `${currentMembership.role} role` : "Identity"} detail={currentMembership ? "site-scoped access" : isJudgeSession ? "Judge sandbox · signed in" : identity === "loading" ? "loading" : "sign-in required"} tone={currentMembership || isJudgeSession ? "info" : "warning"} /><p className="mt-2">Synthetic demo data only; role controls are enforced by the API.</p></div>
    </aside>

    <div className="cc-main">
      <header className="cc-topbar">
        <Link className="cc-mobile-brand" href="/" aria-label="NEXUS TITAN overview"><span className="cc-brand-mark" aria-hidden="true">NT</span>NEXUS TITAN</Link>
        <nav className="cc-breadcrumb" aria-label="Breadcrumb"><Link href="/">Workspace</Link><span aria-hidden="true">/</span><strong aria-current="page">{currentRoute.label}</strong></nav>
        <div className="cc-controls">
          <button ref={searchButton} className="cc-search-button" type="button" aria-label="Open command palette" onClick={() => setPaletteOpen(true)}>Search command center <kbd>⌘K</kbd></button>
          <label className="sr-only" htmlFor="workspace-tenant">Organization</label>
          <select id="workspace-tenant" className="cc-select" value={tenantId} onChange={(event) => selectTenant(event.target.value)} aria-label="Select active organization" disabled={!memberships.length}>
            {!memberships.length && <option value="">Sign in via the 1-click judge sandbox</option>}
            {memberships.map((item) => <option key={item.organization_id} value={item.organization_id}>{item.organization_name} · {item.role}</option>)}
          </select>
          <label className="sr-only" htmlFor="workspace-site">Site</label>
          <select id="workspace-site" className="cc-select" value={siteId} onChange={(event) => selectSite(event.target.value)} aria-label="Select active site" disabled={!currentMembership?.sites.length}>
            {!currentMembership?.sites.length && <option value="">Sign in via the 1-click judge sandbox</option>}
            {currentMembership?.sites.map((item) => <option key={item.site_id} value={item.site_id}>{item.name}</option>)}
          </select>
          <button ref={notificationButton} className="cc-icon-button" type="button" onClick={() => { setDrawerOpen(true); void loadNotifications(); }} aria-label={`Open incident notifications${incidents.length ? `, ${incidents.length} open` : ""}`} aria-expanded={drawerOpen}>Alerts{incidents.length > 0 && <span className="cc-badge">{incidents.length}</span>}</button>
          <button className="cc-icon-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? "Light" : "Dark"}</button>
          <span className="cc-status-wrap">{status}</span>
        </div>
      </header>
      <nav className="cc-mobile-nav" aria-label="Mobile navigation">{ROUTES.map((route) => <Link key={route.href} href={route.href} aria-current={isActive(pathname, route.href) ? "page" : undefined}>{route.label}</Link>)}</nav>
      <div className="cc-content">
        <div className="cc-fixture-banner" role="note"><span className="cc-badge cc-badge--synthetic">Synthetic demo</span><span>Fixture-derived data only. Actions and model outputs do not control real infrastructure.</span>{currentSite && <span className="ml-auto font-mono">{currentSite.site_id}</span>}</div>
        {children}
      </div>
    </div>

    {paletteOpen && <div className="cc-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
      <section className="cc-dialog" role="dialog" aria-modal="true" aria-labelledby="palette-title" onKeyDown={trapTab}>
        <div className="cc-dialog-head"><h2 id="palette-title" className="font-semibold">Command palette</h2><span className="text-xs text-slate-600">Navigate · Ctrl/⌘ K · Esc</span></div>
        <div className="cc-dialog-body"><label className="sr-only" htmlFor="command-search">Search routes</label><input ref={paletteInput} id="command-search" className="cc-palette-input" value={paletteQuery} onChange={(event) => { setPaletteQuery(event.target.value); setActiveIndex(0); }} onKeyDown={onPaletteKey} placeholder="Search pages and capabilities" />
          <div className="cc-palette-list" role="listbox" aria-label="Matching pages">{filteredRoutes.length ? filteredRoutes.map((route, index) => <button className="cc-palette-item" key={route.href} type="button" role="option" aria-selected={index === activeIndex} data-active={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => navigateTo(route.href)}><span><strong>{route.label}</strong><span className="mt-1 block text-xs text-slate-600">{route.description}</span></span><span className="font-mono text-xs">{route.href}</span></button>) : <p className="p-3 text-sm text-slate-600">No matching destination.</p>}</div>
        </div>
      </section>
    </div>}

    {drawerOpen && <><button className="fixed inset-0 z-[80] cursor-default bg-black/50" aria-label="Close incident notifications" onClick={() => setDrawerOpen(false)} /><aside className="cc-drawer" role="dialog" aria-modal="true" aria-labelledby="notifications-title" onKeyDown={trapTab}><div className="cc-dialog-head"><div><h2 id="notifications-title" className="font-semibold">Incident notifications</h2><p className="text-xs text-slate-600">Canonical API · {currentSite?.name ?? "No active site"}</p></div><button ref={drawerClose} className="cc-icon-button" onClick={() => setDrawerOpen(false)}>Close</button></div><div className="cc-drawer-content">{notificationError ? <p className="rounded border border-amber-600 p-3 text-sm" role="status">{notificationError}</p> : incidents.length ? <ul className="space-y-2">{incidents.map((item) => <li key={item.incident_id}><Link className="cc-drawer-item" href="/world"><span className="flex justify-between gap-2"><strong>{item.label}</strong><span className="cc-badge">{item.status}</span></span><span className="mt-2 block font-mono text-xs">{item.incident_id}</span><span className="mt-1 block text-xs text-slate-600">{item.affected_asset_ids.length} affected assets · {item.classification}</span></Link></li>)}</ul> : <p className="rounded border border-slate-700 p-4 text-sm">No unresolved incidents returned by the authorized API.</p>}</div></aside></>}
  </div></WorkspaceContext.Provider>;
}
