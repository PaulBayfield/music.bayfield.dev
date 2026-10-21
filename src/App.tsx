import { useCallback, useEffect, useMemo, useState } from "react";
import { api, publicToken, query as qs, type Me, type ServerInfo, type TopItem } from "./lib/api";
import { AppContext, type AppContextValue, type PlaylistSource, type SettingsPage } from "./lib/app";
import { palette } from "./lib/colors";
import { MOBILE_QUERY, invalidate, useApi, useMediaQuery } from "./lib/hooks";
import { rangeInstants, shiftRange } from "./lib/range";
import { useRouter } from "./lib/router";
import { SettingsProvider, useSettings } from "./lib/settings";
import { ErrorBoundary, ToastProvider, useToast } from "./components/common";
import { Sidebar } from "./components/Sidebar";
import { SignIn } from "./components/SignIn";
import { Dashboard } from "./components/Dashboard";
import { AllStats } from "./components/AllStats";
import { TopPage } from "./components/TopPage";
import { AlbumPage, ArtistPage, TrackPage } from "./components/EntityPages";
import { AffinityPage, HistoryPage, SessionsPage } from "./components/OtherPages";
import { SettingsDialog } from "./components/SettingsDialog";
import { HistoryPanel } from "./components/HistoryPanel";
import { SearchDialog } from "./components/SearchDialog";
import { PlaylistDialog } from "./components/PlaylistDialog";
import { TabBar } from "./components/TabBar";

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </SettingsProvider>
  );
}

function Root() {
  const { t } = useSettings();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  // Set by the server when signing in fails (it redirects back with ?signin_error=…).
  const [signinError] = useState(() => new URLSearchParams(location.search).get("signin_error"));

  const loadMe = useCallback(() => {
    api<{ status: true; user: Me } | { status: false }>("/me").then(
      (r) => setMe(r.status ? r.user : null),
      () => setMe(null),
    );
  }, []);

  useEffect(() => {
    loadMe();
    const q = new URLSearchParams(location.search);
    if (q.has("signin_error") || q.has("spotify")) {
      q.delete("signin_error");
      q.delete("spotify");
      const s = q.toString();
      history.replaceState(null, "", location.pathname + (s ? `?${s}` : ""));
    }
  }, [loadMe]);

  // Any API call answering 401 means the session ended (expired, signed out elsewhere).
  useEffect(() => {
    const onSignedOut = () => setMe(null);
    window.addEventListener("music:signed-out", onSignedOut);
    return () => window.removeEventListener("music:signed-out", onSignedOut);
  }, []);

  if (me === undefined) return <div className="splash" />;
  if (me === null) return <SignIn error={publicToken ? t("publicLinkInvalid") : signinError} onSignedIn={loadMe} />;
  return <Shell me={me} reloadMe={loadMe} onSignedOut={() => setMe(null)} />;
}

function Shell({ me, reloadMe, onSignedOut }: { me: Me; reloadMe: () => void; onSignedOut: () => void }) {
  const { t, settings, update, dark } = useSettings();
  const router = useRouter();
  const toast = useToast();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const guest = me.guest;
  const [drawer, setDrawer] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [playlist, setPlaylist] = useState<{ source: PlaylistSource; name?: string } | null>(null);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const server = useApi<ServerInfo>("/app/server").data;

  const r = router.route;
  const range = useMemo(() => rangeInstants(router.query, me), [router.query, me]);

  // Colours follow the range's top artists (the dashboard chart's stacking order).
  const top = useApi<TopItem[]>(`/spotify/top/artists${qs({ start: range.start, end: range.end, nb: 8 })}`).data;
  const colors = useMemo(() => palette((top ?? []).map((x) => x.artist.id), dark), [top, dark]);

  // Close the drawers when navigating on phones.
  useEffect(() => {
    setDrawer(false);
    setMobilePanel(false);
  }, [r]);

  const ranged = r.name === "dashboard" || r.name === "all" || r.name === "tracks" || r.name === "artists" || r.name === "albums" || r.name === "history" || r.name === "sessions" || r.name === "affinity";
  const sidebarVisible = mobile ? drawer : settings.sidebar;
  const panelVisible = mobile ? mobilePanel : settings.panel;
  const toggleSidebar = () => (mobile ? setDrawer((d) => !d) : update({ sidebar: !settings.sidebar }));
  const togglePanel = () => (mobile ? setMobilePanel((p) => !p) : update({ panel: !settings.panel }));

  const value: AppContextValue = {
    me,
    reloadMe,
    server,
    guest,
    route: r,
    query: router.query,
    navigate: router.navigate,
    setQuery: router.setQuery,
    range,
    artistColor: (id) => colors.get(id) ?? "var(--text-faint)",
    openSettings: (page) => setSettingsPage(page ?? (guest ? "preferences" : "profile")),
    signOut: () => {
      void api("/auth/logout", { method: "POST" }).finally(() => {
        invalidate();
        onSignedOut();
      });
    },
    sidebarVisible,
    toggleSidebar,
    panelVisible,
    togglePanel,
    openSearch: () => setSearchOpen(true),
    play: (id) => {
      api("/spotify/play", { body: { id } }).then(
        () => toast(t("playing")),
        (e: Error) => toast(/NO_ACTIVE_DEVICE|404/i.test(e.message) ? t("noActiveDevice") : e.message, "error"),
      );
    },
    savePlaylist: (source, name) => setPlaylist({ source, name }),
  };

  // The same keys as Calendar, Notes and DevTime.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = !!target.closest?.("input, textarea, select, [contenteditable]");
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (ctrl && !e.altKey && !e.shiftKey && (k === "b" || k === "\\")) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (ctrl && !e.altKey && k === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (ctrl && !e.altKey && e.key === ",") {
        e.preventDefault();
        setSettingsPage((p) => p ?? (guest ? "preferences" : "profile"));
        return;
      }
      if (ctrl && !e.altKey && k === ".") {
        e.preventDefault();
        togglePanel();
        return;
      }

      // Single keys: not while typing, in a dialog, or with modifiers.
      if (ctrl || e.altKey || inField || settingsPage || searchOpen || playlist) return;
      if (document.querySelector(".dialog-backdrop, .picker")) return;
      const setRange = (id: string) => router.setQuery({ range: id, from: undefined, to: undefined });
      const shift = (dir: 1 | -1) => {
        const next = shiftRange(router.query, me, dir);
        if (next) router.setQuery({ range: undefined, ...next });
      };

      if (k === "\\") toggleSidebar();
      else if (k === "/") setSearchOpen(true);
      else if (k === ".") togglePanel();
      else if (k === "escape" && mobile && (drawer || mobilePanel)) {
        setDrawer(false);
        setMobilePanel(false);
      } else if (!ranged) return;
      else if (k === "t") setRange("today");
      else if (k === "j" || k === "n" || k === "arrowright") shift(1);
      else if (k === "k" || k === "p" || k === "arrowleft") shift(-1);
      else if (k === "w") setRange("week");
      else if (k === "m") setRange("month");
      else if (k === "y") setRange("year");
      else if (k === "a") setRange("all_time");
      else if (k === "7") setRange("last_7_days");
      else if (k === "3") setRange("last_30_days");
      else if (k === "1") setRange("last_12_months");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <AppContext.Provider value={value}>
      <div className="app">
        {sidebarVisible && (
          <>
            {mobile && <div className="sidebar-backdrop" onClick={() => setDrawer(false)} />}
            <Sidebar />
          </>
        )}
        <main className="main">
          {!guest && me.pollError && !me.spotifyLinked && (
            <div className="banner">
              {me.pollError}{" "}
              <a className="link-button" href="/api/oauth/spotify">
                {t("signInWithSpotify")}
              </a>
            </div>
          )}
          {guest && <div className="banner">{t("publicViewBanner", { name: me.username })}</div>}
          <ErrorBoundary key={JSON.stringify(r)} message={t("pageFailed")} retry={t("retry")}>
          {r.name === "tracks" || r.name === "artists" || r.name === "albums" ? (
            <TopPage kind={r.name} key={r.name} />
          ) : r.name === "artist" ? (
            <ArtistPage id={r.id} key={r.id} />
          ) : r.name === "album" ? (
            <AlbumPage id={r.id} key={r.id} />
          ) : r.name === "track" ? (
            <TrackPage id={r.id} key={r.id} />
          ) : r.name === "all" ? (
            <AllStats />
          ) : r.name === "history" ? (
            <HistoryPage />
          ) : r.name === "sessions" ? (
            <SessionsPage />
          ) : r.name === "affinity" && !guest ? (
            <AffinityPage />
          ) : (
            <Dashboard />
          )}
          </ErrorBoundary>
          <TabBar />
        </main>
        {panelVisible && (
          <>
            {mobile && <div className="sidebar-backdrop" onClick={() => setMobilePanel(false)} />}
            <HistoryPanel />
          </>
        )}
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      {settingsPage && <SettingsDialog page={settingsPage} onClose={() => setSettingsPage(null)} />}
      {playlist && <PlaylistDialog source={playlist.source} name={playlist.name} onClose={() => setPlaylist(null)} />}
    </AppContext.Provider>
  );
}
