import { useRef, type CSSProperties, type ReactNode } from "react";
import { query as qs, type TopItem } from "../lib/api";
import { useApp } from "../lib/app";
import { addDays, today } from "../lib/dates";
import { useApi } from "../lib/hooks";
import { zonedMidnight } from "../lib/range";
import type { Route } from "../lib/router";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { BarChart, Disc, Heart, History, Home, Mic, Music, PanelLeft, Search, Timer } from "./icons";
import { Cover } from "./music";

const MIN_W = 200;
const MAX_W = 480;
const DEFAULT_W = 248;

const PAGES: { route: Route; label: StringKey; icon: ReactNode }[] = [
  { route: { name: "dashboard" }, label: "dashboard", icon: <Home /> },
  { route: { name: "all" }, label: "allStats", icon: <BarChart /> },
  { route: { name: "tracks" }, label: "topTracks", icon: <Music /> },
  { route: { name: "artists" }, label: "topArtists", icon: <Mic /> },
  { route: { name: "albums" }, label: "topAlbums", icon: <Disc /> },
  { route: { name: "history" }, label: "history", icon: <History /> },
  { route: { name: "sessions" }, label: "sessions", icon: <Timer /> },
  { route: { name: "affinity" }, label: "affinity", icon: <Heart /> },
];

/** Same layout as Calendar's, Notes' and DevTime's sidebars: toggle and search on top, then the pages. */
export function Sidebar() {
  const { t, f, settings } = useSettings();
  const { route, navigate, toggleSidebar, openSearch, me, guest } = useApp();
  // Your artists of the last four weeks, whatever range the page shows.
  const to = today(me.timezone);
  const start = zonedMidnight(addDays(to, -27), me.timezone).toISOString();
  const end = zonedMidnight(addDays(to, 1), me.timezone).toISOString();
  const recent = useApi<TopItem[]>(`/spotify/top/artists${qs({ start, end, nb: 12 })}`).data ?? [];

  return (
    <aside className="sidebar" style={{ "--sidebar-w": `${settings.sidebarWidth}px` } as CSSProperties}>
      <ResizeHandle />
      <div className="sidebar-top">
        <button className="icon-button" title={`${t("toggleSidebar")} (Ctrl+B)`} aria-label={t("toggleSidebar")} onClick={toggleSidebar}>
          <PanelLeft />
        </button>
        <div className="toolbar-spacer" />
        <button className="icon-button" title={`${t("search")} (Ctrl+K)`} aria-label={t("search")} onClick={openSearch}>
          <Search />
        </button>
      </div>

      <nav className="sidebar-nav">
        {PAGES.filter((p) => !(guest && p.route.name === "affinity")).map((p) => (
          <button key={p.route.name} className={`sidebar-row${route.name === p.route.name ? " active" : ""}`} onClick={() => navigate(p.route)}>
            {p.icon}
            <span className="row-label">{t(p.label)}</span>
          </button>
        ))}
      </nav>

      {/* Only the artist list scrolls; the header and pages stay put. */}
      <div className="sidebar-scroll">
        {recent.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t("recentArtists")}</div>
            {recent.map((r) => (
              <button
                key={r.artist.id}
                className={`sidebar-row${route.name === "artist" && route.id === r.artist.id ? " active" : ""}`}
                onClick={() => navigate({ name: "artist", id: r.artist.id })}
                title={r.artist.name}
              >
                <Cover images={r.artist.images} size={18} round kind="artist" />
                <span className="row-label">{r.artist.name}</span>
                <span className="row-meta">{f.number(r.count)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Drag the right edge to resize; double-click to reset. */
function ResizeHandle() {
  const { update } = useSettings();
  const drag = useRef<{ x: number; w: number; aside: HTMLElement } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const aside = e.currentTarget.parentElement!;
        drag.current = { x: e.clientX, w: aside.getBoundingClientRect().width, aside };
        e.currentTarget.setPointerCapture(e.pointerId);
        document.documentElement.classList.add("resizing-sidebar");
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) d.aside.style.setProperty("--sidebar-w", `${clamp(d.w + e.clientX - d.x)}px`);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        document.documentElement.classList.remove("resizing-sidebar");
        update({ sidebarWidth: clamp(d.w + e.clientX - d.x) });
      }}
      onDoubleClick={() => update({ sidebarWidth: DEFAULT_W })}
    />
  );
}
