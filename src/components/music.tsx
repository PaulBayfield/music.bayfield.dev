// Covers, links and lists of tracks, artists and albums.

import { useState, type CSSProperties, type ReactNode } from "react";
import { imageOf, type Album, type Artist, type Image, type Track } from "../lib/api";
import { useApp } from "../lib/app";
import { useSettings } from "../lib/settings";
import { Disc, Mic, Music, Play } from "./icons";

/** A cover or a picture; a neutral tile with an icon when Spotify has none. */
export function Cover({ images, size = 40, round, kind = "track" }: { images: Image[] | undefined; size?: number; round?: boolean; kind?: "track" | "album" | "artist" }) {
  const [broken, setBroken] = useState(false);
  const url = imageOf(images, size * 2);
  const style = { width: size, height: size, "--r": round ? "50%" : size >= 96 ? "8px" : "4px" } as CSSProperties;
  if (!url || broken) {
    const Icon = kind === "artist" ? Mic : kind === "album" ? Disc : Music;
    return (
      <span className="cover cover-empty" style={style} aria-hidden="true">
        <Icon size={Math.max(12, Math.round(size * 0.42))} />
      </span>
    );
  }
  return <img className="cover" style={style} src={url} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

/** Artists' names, each one a link. */
export function ArtistNames({ ids, artists, fallback }: { ids?: string[]; artists?: Artist[]; fallback?: string }) {
  const { navigate } = useApp();
  const list = artists ?? [];
  if (!list.length) return <>{fallback ?? ids?.join(", ") ?? ""}</>;
  return (
    <>
      {list.map((a, i) => (
        <span key={a.id}>
          {i > 0 && ", "}
          <button
            className="inline-link"
            onClick={(e) => {
              e.stopPropagation();
              navigate({ name: "artist", id: a.id });
            }}
          >
            {a.name}
          </button>
        </span>
      ))}
    </>
  );
}

export interface MediaItem {
  id: string;
  kind: "track" | "album" | "artist";
  title: string;
  subtitle?: ReactNode;
  images?: Image[];
  /** The bar's length, relative to the list's first item. */
  value: number;
  /** Bold, on the right. */
  main: ReactNode;
  /** Muted, after it. */
  extra?: ReactNode;
  color?: string;
  /** For tracks: play on Spotify. */
  playable?: boolean;
}

/** A ranked list: rank, cover, name, a bar, and the numbers. */
export function MediaList({ items, limit = 10, ranked = true, empty }: { items: MediaItem[]; limit?: number; ranked?: boolean; empty?: string }) {
  const { t } = useSettings();
  const { navigate, play, guest } = useApp();
  const [all, setAll] = useState(false);
  if (!items.length) return <p className="empty-card">{empty ?? t("noData")}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const shown = all ? items : items.slice(0, limit);
  return (
    <div className="media-list">
      {shown.map((i, n) => (
        <div
          key={i.id}
          className="media-row"
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: i.kind, id: i.id })}
          onKeyDown={(e) => e.key === "Enter" && navigate({ name: i.kind, id: i.id })}
        >
          {ranked && <span className="media-rank">{n + 1}</span>}
          <span className="media-cover">
            <Cover images={i.images} size={36} round={i.kind === "artist"} kind={i.kind} />
            {i.playable && !guest && (
              <button
                className="media-play"
                title={t("playOnSpotify")}
                aria-label={t("playOnSpotify")}
                onClick={(e) => {
                  e.stopPropagation();
                  play(i.id);
                }}
              >
                <Play size={14} />
              </button>
            )}
          </span>
          <span className="media-text">
            <span className="media-title" title={i.title}>
              {i.title}
            </span>
            {i.subtitle && <span className="media-subtitle">{i.subtitle}</span>}
          </span>
          <span className="media-numbers">
            <b>{i.main}</b>
            {i.extra && <span>{i.extra}</span>}
          </span>
          <span className="media-track">
            <span className="media-fill" style={{ width: `${(i.value / max) * 100}%`, "--c": i.color ?? "var(--seq)" } as CSSProperties} />
          </span>
        </div>
      ))}
      {items.length > limit && (
        <button className="link-button breakdown-more" onClick={() => setAll((a) => !a)}>
          {all ? t("showLess") : t("showAll", { n: items.length })}
        </button>
      )}
    </div>
  );
}

/** Builds list items from YourSpotify's top rows. */
export function trackItem(track: Track, album: Album | undefined, artists: Artist[] | undefined, value: number, main: ReactNode, extra?: ReactNode): MediaItem {
  return {
    id: track.id,
    kind: "track",
    title: track.name,
    subtitle: <ArtistNames ids={track.artists} artists={artists} />,
    images: album?.images,
    value,
    main,
    extra,
    playable: true,
  };
}

/** A track's length: "3:27". */
export function mmss(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "plays" or "listening time", per the user's ranking preference. */
export function useMetric() {
  const { me } = useApp();
  const { t, f } = useSettings();
  const byTime = me.settings.metricUsed === "duration";
  return {
    byTime,
    value: (count: number, ms: number) => (byTime ? ms : count),
    main: (count: number, ms: number) => (byTime ? f.duration(ms / 1000) : t("playsN", { n: f.number(count) })),
    extra: (count: number, ms: number) => (byTime ? t("playsN", { n: f.number(count) }) : f.duration(ms / 1000)),
  };
}
