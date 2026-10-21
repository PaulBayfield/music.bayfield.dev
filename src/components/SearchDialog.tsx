// Ctrl+K / "/": the same command palette as Calendar's, Notes' and DevTime's. Jumps to a page, a
// settings page, or an artist, song or album (YourSpotify's /search, from 3 characters).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Album, type Artist, type Track } from "../lib/api";
import { useApp, type SettingsPage } from "../lib/app";
import type { Route } from "../lib/router";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { BarChart, Disc, Gear, Heart, History, Home, Mic, Music, Search, Timer } from "./icons";
import { Cover } from "./music";

interface Result {
  key: string;
  section: StringKey;
  title: string;
  extra?: string;
  icon: ReactNode;
  run: () => void;
}

const SETTINGS: { id: SettingsPage; label: StringKey }[] = [
  { id: "profile", label: "profile" },
  { id: "preferences", label: "preferences" },
  { id: "security", label: "security" },
  { id: "spotify", label: "spotify" },
  { id: "import", label: "importHistory" },
  { id: "blacklist", label: "hiddenArtists" },
  { id: "sharing", label: "sharing" },
  { id: "data", label: "data" },
  { id: "statistics", label: "statistics" },
  { id: "shortcuts", label: "shortcuts" },
];

const PAGES: [StringKey, ReactNode, Route][] = [
  ["dashboard", <Home size={16} />, { name: "dashboard" }],
  ["allStats", <BarChart size={16} />, { name: "all" }],
  ["topTracks", <Music size={16} />, { name: "tracks" }],
  ["topArtists", <Mic size={16} />, { name: "artists" }],
  ["topAlbums", <Disc size={16} />, { name: "albums" }],
  ["history", <History size={16} />, { name: "history" }],
  ["sessions", <Timer size={16} />, { name: "sessions" }],
  ["affinity", <Heart size={16} />, { name: "affinity" }],
];

type Found = { artists: Artist[]; tracks: (Track & { full_album?: Album; full_artists?: Artist[] })[]; albums: (Album & { full_artists?: Artist[] })[] };

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { t } = useSettings();
  const { navigate, openSettings, guest } = useApp();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  // The catalog, once typing pauses.
  useEffect(() => {
    if (q.length < 3) {
      setFound(null);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      api<Found>(`/search/${encodeURIComponent(q.slice(0, 64))}`).then((r) => live && setFound(r), () => {});
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  const results = useMemo(() => {
    const keep = (title: string) => !q || title.toLowerCase().includes(q);
    const done = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const out: Result[] = [];
    for (const [label, icon, route] of PAGES) {
      if (guest && route.name === "affinity") continue;
      if (keep(t(label))) out.push({ key: `page:${label}`, section: "pages", title: t(label), icon, run: done(() => navigate(route)) });
    }
    for (const a of found?.artists.slice(0, 6) ?? []) {
      out.push({ key: `artist:${a.id}`, section: "artists", title: a.name, extra: a.genres.slice(0, 2).join(", "), icon: <Cover images={a.images} size={20} round kind="artist" />, run: done(() => navigate({ name: "artist", id: a.id })) });
    }
    for (const s of found?.tracks.slice(0, 8) ?? []) {
      out.push({
        key: `track:${s.id}`,
        section: "tracks",
        title: s.name,
        extra: (s.full_artists ?? []).map((a) => a.name).join(", "),
        icon: <Cover images={s.full_album?.images} size={20} />,
        run: done(() => navigate({ name: "track", id: s.id })),
      });
    }
    for (const a of found?.albums.slice(0, 6) ?? []) {
      out.push({
        key: `album:${a.id}`,
        section: "albums",
        title: a.name,
        extra: (a.full_artists ?? []).map((x) => x.name).join(", "),
        icon: <Cover images={a.images} size={20} kind="album" />,
        run: done(() => navigate({ name: "album", id: a.id })),
      });
    }
    if (q && !guest) {
      for (const s of SETTINGS.filter((s) => keep(t(s.label)))) {
        out.push({ key: `settings:${s.id}`, section: "settings", title: t(s.label), icon: <Gear size={16} />, run: done(() => openSettings(s.id)) });
      }
    }
    return out;
  }, [q, found, t, navigate, openSettings, onClose, guest]);

  useEffect(() => setActive(0), [q, found]);
  useEffect(() => {
    listRef.current?.querySelector(".search-result.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastSection: StringKey | null = null;
  return (
    <div className="dialog-backdrop search-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-dialog" role="dialog" aria-label={t("search")}>
        <div className="search-input-row">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            placeholder={t("searchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") setActive((i) => Math.min(results.length - 1, i + 1));
              else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
              else if (e.key === "Enter" && results[active]) results[active].run();
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        </div>
        <div className="search-results" ref={listRef}>
          {results.length === 0 && <p className="search-empty">{q.length > 0 && q.length < 3 ? t("searchMore") : t("noResults")}</p>}
          {results.map((r, i) => {
            const header = r.section !== lastSection ? <div className="search-section">{t(r.section)}</div> : null;
            lastSection = r.section;
            return (
              <div key={r.key}>
                {header}
                <button className={`search-result${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onClick={r.run}>
                  <span className="search-result-icon">{r.icon}</span>
                  <span className="search-result-text">
                    <span className="search-result-title">{r.title}</span>
                  </span>
                  {r.extra && <span className="search-result-when">{r.extra}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
