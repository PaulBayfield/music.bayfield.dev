// Top songs, artists or albums of the range (YourSpotify's /spotify/top/*), 30 at a time.

import { useEffect, useState } from "react";
import { api, query as qs, type TopItem } from "../lib/api";
import { useApp } from "../lib/app";
import { invalidate } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { useToast } from "./common";
import { ListMusic, Play } from "./icons";
import { ArtistNames, Cover } from "./music";
import { Toolbar } from "./Toolbar";

const PAGE = 30;
type Kind = "tracks" | "artists" | "albums";
const PATH: Record<Kind, string> = { tracks: "songs", artists: "artists", albums: "albums" };
const TITLE: Record<Kind, StringKey> = { tracks: "topTracks", artists: "topArtists", albums: "topAlbums" };

export function TopPage({ kind }: { kind: Kind }) {
  const { t, f } = useSettings();
  const { range, navigate, me, play, guest, savePlaylist, artistColor } = useApp();
  const [items, setItems] = useState<TopItem[] | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byTime = me.settings.metricUsed === "duration";
  const key = `${kind}|${range.start}|${range.end}|${me.settings.metricUsed}`;

  const load = async (offset: number) => {
    setBusy(true);
    try {
      const page = await api<TopItem[]>(`/spotify/top/${PATH[kind]}${qs({ start: range.start, end: range.end, nb: PAGE, offset })}`);
      setItems((prev) => (offset === 0 ? page : [...(prev ?? []), ...page]));
      setDone(page.length < PAGE);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setItems(null);
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const total = items?.[0] ? (byTime ? items[0].total_duration_ms : items[0].total_count) : 0;
  const max = items?.[0] ? (byTime ? items[0].duration_ms : items[0].count) : 1;

  return (
    <>
      <Toolbar title={t(TITLE[kind])} loading={busy} range>
        <MetricSwitch />
        {kind === "tracks" && !guest && (
          <button
            className="icon-button"
            title={t("saveAsPlaylist")}
            aria-label={t("saveAsPlaylist")}
            onClick={() => savePlaylist({ type: "top", interval: { start: range.start, end: range.end }, nb: 50 })}
          >
            <ListMusic />
          </button>
        )}
      </Toolbar>
      <div className="content">
        <div className="page">
          {error && <p className="error-text">{error}</p>}
          {!items ? (
            <div className="skeleton" style={{ height: 420 }} />
          ) : items.length === 0 ? (
            <div className="empty-state">
              <p>{t("noData")}</p>
            </div>
          ) : (
            <table className="project-table top-table">
              <thead>
                <tr>
                  <th className="num rank-col">#</th>
                  <th>{t(kind === "tracks" ? "track" : kind === "artists" ? "artist" : "album")}</th>
                  <th className="num">{t("plays")}</th>
                  <th className="num hide-mobile">{t("time")}</th>
                  <th className="share-col hide-mobile">{t("share")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x, i) => {
                  const target =
                    kind === "tracks" ? ({ name: "track", id: x.track.id } as const) : kind === "artists" ? ({ name: "artist", id: x.artist.id } as const) : ({ name: "album", id: x.album.id } as const);
                  const value = byTime ? x.duration_ms : x.count;
                  return (
                    <tr key={x._id} onClick={() => navigate(target)}>
                      <td className="num muted rank-col">{i + 1}</td>
                      <td>
                        <span className="media-cell">
                          <span className="media-cover">
                            <Cover images={kind === "artists" ? x.artist.images : x.album.images} size={40} round={kind === "artists"} kind={kind === "tracks" ? "track" : kind === "artists" ? "artist" : "album"} />
                            {kind === "tracks" && !guest && (
                              <button
                                className="media-play"
                                title={t("playOnSpotify")}
                                aria-label={t("playOnSpotify")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  play(x.track.id);
                                }}
                              >
                                <Play size={14} />
                              </button>
                            )}
                          </span>
                          <span className="media-text">
                            <span className="media-title">{kind === "tracks" ? x.track.name : kind === "artists" ? x.artist.name : x.album.name}</span>
                            <span className="media-subtitle">
                              {kind === "artists" ? (
                                t("differentTracksN", { n: x.differents })
                              ) : (
                                <>
                                  <ArtistNames artists={[x.artist]} />
                                  {kind === "tracks" && ` · ${x.album.name}`}
                                </>
                              )}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="num">{f.number(x.count)}</td>
                      <td className="num muted hide-mobile">{f.duration(x.duration_ms / 1000)}</td>
                      <td className="share-col hide-mobile">
                        <span className="share-cell">
                          <span className="breakdown-track">
                            <span
                              className="breakdown-fill"
                              style={{ width: `${(value / max) * 100}%`, display: "block", ["--c" as string]: kind === "artists" ? artistColor(x.artist.id) : "var(--seq)" }}
                            />
                          </span>
                          <span className="muted tabular">{f.percent(total ? value / total : 0)}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {items && !done && (
            <button className="text-button load-more" disabled={busy} onClick={() => void load(items.length)}>
              {busy ? t("loading") : t("loadMore")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Rank by plays or by listening time (YourSpotify's "statistic measurement"), saved to the account. */
export function MetricSwitch() {
  const { t } = useSettings();
  const { me, reloadMe, guest } = useApp();
  const toast = useToast();
  if (guest) return null;
  const set = async (metricUsed: "number" | "duration") => {
    if (metricUsed === me.settings.metricUsed) return;
    try {
      await api("/settings", { body: { metricUsed } });
      invalidate("/spotify/");
      reloadMe();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div className="segmented" role="group" aria-label={t("rankBy")}>
      <button className={me.settings.metricUsed === "number" ? "active" : ""} onClick={() => void set("number")} title={t("rankByPlays")}>
        {t("plays")}
      </button>
      <button className={me.settings.metricUsed === "duration" ? "active" : ""} onClick={() => void set("duration")} title={t("rankByTime")}>
        {t("time")}
      </button>
    </div>
  );
}
