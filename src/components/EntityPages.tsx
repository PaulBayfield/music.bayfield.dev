// An artist's, an album's or a track's page: what you listened to of it, and when.
// Built on YourSpotify's /artist/:id/stats, /album/:id/stats and /track/:id/stats.

import { useMemo, useState, type ReactNode } from "react";
import { api, type Album, type Artist, type Info, type Rank, type Track, type TrackWithAlbum } from "../lib/api";
import { useApp } from "../lib/app";
import { invalidate, useApi } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import { HourChart, TimeChart, type Bucket } from "./charts";
import { Dropdown, useToast } from "./common";
import { Ban, ExternalLink, ListMusic, MoreHorizontal, Play } from "./icons";
import { ArtistNames, Cover, MediaList, mmss } from "./music";
import { Panel } from "./Dashboard";
import { Toolbar } from "./Toolbar";

type Kind = "artist" | "album" | "track";

interface ArtistStats {
  artist: Artist;
  firstLast: { first: Info & { track: TrackWithAlbum }; last: Info & { track: TrackWithAlbum } };
  mostListened: { _id: string; count: number; track: TrackWithAlbum }[];
  albumMostListened: { _id: string; count: number; album: Album }[];
  bestPeriod: { _id: { year: number; month: number }; count: number; total: number }[];
  total: { count: number; differents: number; duration_ms: number };
  dayRepartition: { _id: number; count: number; duration: number }[];
}
interface AlbumStats {
  album: Album;
  artists: Artist[];
  firstLast?: { first: Info & { track: TrackWithAlbum }; last: Info & { track: TrackWithAlbum } };
  tracks: { _id: string; count: number; track: Track }[];
  bestPeriod: { _id: { year: number; month: number }; count: number; total: number }[];
  total: { count: number; differents: number; duration_ms: number };
}
interface TrackStats {
  track: Track;
  artist: Artist;
  album: Album;
  bestPeriod: { _id: { year: number; month: number }; count: number; total: number }[];
  firstLast: { first: Info; last: Info };
  recentHistory: Info[];
  total: { count: number };
}
type NeverListened = { code: "NEVER_LISTENED" };

// --- Shared pieces ---

function Header({ images, kind, title, subtitle, url, children }: { images: Artist["images"]; kind: Kind; title: string; subtitle?: ReactNode; url?: string; children?: ReactNode }) {
  const { t } = useSettings();
  return (
    <section className="entity-head">
      <Cover images={images} size={132} round={kind === "artist"} kind={kind} />
      <div className="entity-text">
        <span className="entity-kind">{t(kind)}</span>
        <h1 className="entity-title">{title}</h1>
        {subtitle && <div className="entity-subtitle">{subtitle}</div>}
        <div className="entity-actions">
          {children}
          {url && (
            <a className="text-button" href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              {t("openInSpotify")}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-sub">{sub ?? " "}</span>
    </div>
  );
}

/** "#3 of your artists", with its neighbours on hover. */
function useRank(kind: Kind, id: string) {
  return useApi<Rank>(`/${kind}/${encodeURIComponent(id)}/rank`).data;
}

function when(iso: string | undefined, f: ReturnType<typeof useSettings>["f"], tz: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(f.locale, { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));
}

/** Plays per month since the first one. */
function Timeline({ kind, id }: { kind: Kind; id: string }) {
  const { t } = useSettings();
  const data = useApi<{ date: string; count: number; ms: number }[]>(`/app/timeline/${kind}/${encodeURIComponent(id)}`).data;
  const chart = useMemo(() => {
    if (!data?.length) return null;
    // Every month from the first to now, so gaps show.
    const byMonth = new Map(data.map((d) => [d.date.slice(0, 7), d]));
    const buckets: Bucket[] = [];
    const end = new Date().toISOString().slice(0, 7);
    for (let m = data[0].date.slice(0, 7); m <= end; m = nextMonth(m)) {
      const s = (byMonth.get(m)?.ms ?? 0) / 1000;
      buckets.push({ from: `${m}-01`, to: `${m}-01`, total: s, series: { all: s } });
    }
    return { buckets };
  }, [data]);
  if (!chart) return null;
  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">{t("timePerMonth")}</span>
      </div>
      <TimeChart buckets={chart.buckets} granularity="month" series={["all"]} colorOf={() => "var(--seq)"} nameOf={() => t("listeningTime")} height={180} />
    </section>
  );
}

const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

function BestPeriod({ periods }: { periods: { _id: { year: number; month: number }; count: number; total: number }[] }) {
  const { t, f } = useSettings();
  const [best] = periods;
  if (!best) return null;
  const month = f.monthYearLong(`${best._id.year}-${String(best._id.month).padStart(2, "0")}-01`);
  return <Stat label={t("bestMonth")} value={month} sub={t("bestMonthHint", { n: f.number(best.count), share: f.percent(best.count / best.total) })} />;
}

function Never({ kind, title }: { kind: Kind; title: string }) {
  const { t } = useSettings();
  return (
    <>
      <Toolbar title={title} />
      <div className="content">
        <div className="page">
          <div className="empty-state">
            <p>{t(kind === "artist" ? "neverListenedArtist" : "neverListenedTrack")}</p>
          </div>
        </div>
      </div>
    </>
  );
}

function Loading({ error }: { error: string | null }) {
  const { t } = useSettings();
  return (
    <>
      <Toolbar title="" loading={!error} />
      <div className="content">
        <div className="page">
          {error ? <p className="error-text">{error === "Request failed (404)" ? t("notFound") : error}</p> : <div className="skeleton" style={{ height: 420 }} />}
        </div>
      </div>
    </>
  );
}

// --- Artist ---

export function ArtistPage({ id }: { id: string }) {
  const { t, f } = useSettings();
  const { me, guest, savePlaylist, reloadMe, artistColor } = useApp();
  const toast = useToast();
  const req = useApi<ArtistStats | NeverListened>(`/artist/${encodeURIComponent(id)}/stats`);
  const rank = useRank("artist", id);
  const fallback = useApi<Artist[]>(req.data && "code" in req.data ? `/artist/${encodeURIComponent(id)}` : null).data;
  const s = req.data;
  if (!s) return <Loading error={req.error} />;
  if ("code" in s) return <Never kind="artist" title={fallback?.[0]?.name ?? ""} />;
  const hidden = me.settings.blacklistedArtists.includes(id);

  const toggleHidden = async () => {
    try {
      await api(`/artist/${hidden ? "unblacklist" : "blacklist"}/${encodeURIComponent(id)}`, { method: "POST" });
      invalidate();
      reloadMe();
      toast(hidden ? t("artistShown") : t("artistHidden"));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const hours = Array.from({ length: 24 }, (_, h) => (s.dayRepartition.find((d) => d._id === h)?.duration ?? 0) / 1000);

  return (
    <>
      <Toolbar title={s.artist.name}>
        {!guest && (
          <Dropdown button={(_, toggle) => <button className="icon-button" aria-label={t("more")} onClick={toggle}><MoreHorizontal /></button>}>
            {(close) => (
              <>
                <button
                  onClick={() => {
                    close();
                    savePlaylist({ type: "top-artist", artistId: id, nb: 30 }, t("topOfArtist", { name: s.artist.name }));
                  }}
                >
                  <span>{t("saveTopAsPlaylist")}</span>
                  <ListMusic size={14} />
                </button>
                <button
                  onClick={() => {
                    close();
                    void toggleHidden();
                  }}
                >
                  <span>{hidden ? t("showArtistInStats") : t("hideArtistFromStats")}</span>
                  <Ban size={14} />
                </button>
              </>
            )}
          </Dropdown>
        )}
      </Toolbar>
      <div className="content">
        <div className="page">
          <Header images={s.artist.images} kind="artist" title={s.artist.name} subtitle={s.artist.genres.join(" · ") || undefined} url={s.artist.external_urls?.spotify}>
            {hidden && <span className="badge">{t("hiddenFromStats")}</span>}
          </Header>
          <section className="overview">
            <Stat label={t("plays")} value={f.number(s.total.count)} sub={rank && rank.index >= 0 ? t("rankOfArtists", { n: rank.index + 1 }) : undefined} />
            <Stat label={t("listeningTime")} value={f.duration(s.total.duration_ms / 1000)} />
            <Stat label={t("differentTracks")} value={f.number(s.total.differents)} />
            <BestPeriod periods={s.bestPeriod} />
            <Stat label={t("firstListen")} value={when(s.firstLast?.first.played_at, f, me.timezone)} sub={s.firstLast?.first.track.name} />
            <Stat label={t("lastListen")} value={when(s.firstLast?.last.played_at, f, me.timezone)} sub={s.firstLast?.last.track.name} />
          </section>
          <Timeline kind="artist" id={id} />
          <div className="grid">
            <Panel className="span-6" title={t("mostPlayedTracks")}>
              <MediaList
                items={s.mostListened.map((m) => ({
                  id: m.track.id,
                  kind: "track",
                  title: m.track.name,
                  subtitle: m.track.album.name,
                  images: m.track.album.images,
                  value: m.count,
                  main: t("playsN", { n: f.number(m.count) }),
                  playable: true,
                  color: artistColor(id),
                }))}
              />
            </Panel>
            <Panel className="span-6" title={t("albums")}>
              <MediaList
                items={s.albumMostListened.map((m) => ({
                  id: m.album.id,
                  kind: "album",
                  title: m.album.name,
                  subtitle: m.album.release_date?.slice(0, 4),
                  images: m.album.images,
                  value: m.count,
                  main: t("playsN", { n: f.number(m.count) }),
                }))}
              />
            </Panel>
          </div>
          <section className="card">
            <div className="card-head">
              <span className="card-title">{t("whenYouListen")}</span>
              <span className="card-hint">{t("rhythmHint")}</span>
            </div>
            <HourChart values={hours} />
          </section>
        </div>
      </div>
    </>
  );
}

// --- Album ---

export function AlbumPage({ id }: { id: string }) {
  const { t, f } = useSettings();
  const { me, guest, savePlaylist } = useApp();
  const req = useApi<AlbumStats>(`/album/${encodeURIComponent(id)}/stats`);
  const rank = useRank("album", id);
  const s = req.data;
  if (!s) return <Loading error={req.error} />;
  const length = s.tracks.reduce((sum, x) => sum + x.track.duration_ms, 0);

  return (
    <>
      <Toolbar title={s.album.name}>
        {!guest && s.tracks.length > 0 && (
          <button
            className="icon-button"
            title={t("saveAsPlaylist")}
            aria-label={t("saveAsPlaylist")}
            onClick={() => savePlaylist({ type: "specific", songIds: s.tracks.map((x) => x.track.id) }, s.album.name)}
          >
            <ListMusic />
          </button>
        )}
      </Toolbar>
      <div className="content">
        <div className="page">
          <Header
            images={s.album.images}
            kind="album"
            title={s.album.name}
            subtitle={
              <>
                <ArtistNames artists={s.artists} />
                {s.album.release_date && ` · ${s.album.release_date.slice(0, 4)}`}
              </>
            }
            url={s.album.external_urls?.spotify}
          />
          {s.total.count === 0 ? (
            <div className="empty-state">
              <p>{t("neverListenedTrack")}</p>
            </div>
          ) : (
            <>
              <section className="overview">
                <Stat label={t("plays")} value={f.number(s.total.count)} sub={rank && rank.index >= 0 ? t("rankOfAlbums", { n: rank.index + 1 }) : undefined} />
                <Stat label={t("listeningTime")} value={f.duration(s.total.duration_ms / 1000)} sub={t("albumListensN", { n: length ? (s.total.duration_ms / length).toFixed(1) : "—" })} />
                <Stat label={t("differentTracks")} value={f.number(s.total.differents)} />
                <BestPeriod periods={s.bestPeriod} />
                <Stat label={t("firstListen")} value={when(s.firstLast?.first.played_at, f, me.timezone)} sub={s.firstLast?.first.track.name} />
                <Stat label={t("lastListen")} value={when(s.firstLast?.last.played_at, f, me.timezone)} sub={s.firstLast?.last.track.name} />
              </section>
              <Timeline kind="album" id={id} />
              <Panel title={t("tracks")}>
                <MediaList
                  limit={50}
                  items={s.tracks.map((x) => ({
                    id: x.track.id,
                    kind: "track",
                    title: x.track.name,
                    subtitle: mmss(x.track.duration_ms),
                    images: s.album.images,
                    value: x.count,
                    main: t("playsN", { n: f.number(x.count) }),
                    playable: true,
                  }))}
                />
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// --- Track ---

export function TrackPage({ id }: { id: string }) {
  const { t, f } = useSettings();
  const { me, guest, play, navigate } = useApp();
  const req = useApi<TrackStats | NeverListened>(`/track/${encodeURIComponent(id)}/stats`);
  const rank = useRank("track", id);
  const [all, setAll] = useState(false);
  const s = req.data;
  if (!s) return <Loading error={req.error} />;
  if ("code" in s) return <Never kind="track" title="" />;

  const time = new Intl.DateTimeFormat(f.locale, { dateStyle: "medium", timeStyle: "short", hour12: f.hour12, timeZone: me.timezone });
  const recent = all ? s.recentHistory : s.recentHistory.slice(0, 5);

  return (
    <>
      <Toolbar title={s.track.name} />
      <div className="content">
        <div className="page">
          <Header
            images={s.album?.images}
            kind="track"
            title={s.track.name}
            subtitle={
              <>
                <ArtistNames artists={s.artist ? [s.artist] : []} />
                {s.album && (
                  <>
                    {" · "}
                    <button className="inline-link" onClick={() => navigate({ name: "album", id: s.album.id })}>
                      {s.album.name}
                    </button>
                  </>
                )}
                {` · ${mmss(s.track.duration_ms)}`}
              </>
            }
            url={s.track.external_urls?.spotify}
          >
            {!guest && (
              <button className="primary-button" onClick={() => play(id)}>
                <Play size={14} />
                {t("playOnSpotify")}
              </button>
            )}
          </Header>
          <section className="overview">
            <Stat label={t("plays")} value={f.number(s.total.count)} sub={rank && rank.index >= 0 ? t("rankOfTracks", { n: rank.index + 1 }) : undefined} />
            <Stat label={t("listeningTime")} value={f.duration((s.total.count * s.track.duration_ms) / 1000)} />
            <BestPeriod periods={s.bestPeriod} />
            <Stat label={t("firstListen")} value={when(s.firstLast.first?.played_at, f, me.timezone)} />
            <Stat label={t("lastListen")} value={when(s.firstLast.last?.played_at, f, me.timezone)} />
          </section>
          <Timeline kind="track" id={id} />
          <Panel title={t("recentlyPlayed")}>
            <div className="plain-list">
              {recent.map((p) => (
                <div key={p._id} className="plain-row">
                  <span>{time.format(new Date(p.played_at))}</span>
                  <span className="muted">{f.relative(p.played_at, t)}</span>
                </div>
              ))}
            </div>
            {s.recentHistory.length > 5 && (
              <button className="link-button breakdown-more" onClick={() => setAll((a) => !a)}>
                {all ? t("showLess") : t("showAll", { n: s.recentHistory.length })}
              </button>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
