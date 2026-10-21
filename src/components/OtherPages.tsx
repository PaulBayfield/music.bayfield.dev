// History (everything played in the range), the longest listening sessions, and affinity
// (what you and others all listen to).

import { useState } from "react";
import { query as qs, type Account, type CollaborativeRow, type GlobalPreferences, type ListeningSession } from "../lib/api";
import { useApp } from "../lib/app";
import { useApi } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import { Check, ChevronDown, ListMusic } from "./icons";
import { HistoryList } from "./HistoryList";
import { useHistory } from "./HistoryPanel";
import { ArtistNames, MediaList } from "./music";
import { Toolbar } from "./Toolbar";

// --- History ---

export function HistoryPage() {
  const { t } = useSettings();
  const { range } = useApp();
  const history = useHistory({ start: range.start, end: range.end });
  return (
    <>
      <Toolbar title={t("history")} loading={history.busy} range />
      <div className="content">
        <div className="page narrow">
          <HistoryList history={history} />
        </div>
      </div>
    </>
  );
}

// --- Sessions ---

export function SessionsPage() {
  const { t, f } = useSettings();
  const { range, me, navigate } = useApp();
  const req = useApi<ListeningSession[]>(`/spotify/top/sessions${qs({ start: range.start, end: range.end })}`);
  const [open, setOpen] = useState<number | null>(0);
  const time = new Intl.DateTimeFormat(f.locale, { hour: "numeric", minute: "2-digit", hour12: f.hour12, timeZone: me.timezone });
  const date = new Intl.DateTimeFormat(f.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: me.timezone });

  return (
    <>
      <Toolbar title={t("sessions")} loading={req.loading} range />
      <div className="content">
        <div className="page narrow">
          <p className="muted small page-intro">{t("sessionsHint")}</p>
          {!req.data ? (
            <div className="skeleton" style={{ height: 320 }} />
          ) : req.data.length === 0 ? (
            <div className="empty-state">
              <p>{t("noData")}</p>
            </div>
          ) : (
            req.data.map((s, i) => {
              const plays = s.distanceToLast.distance;
              const first = plays[0]?.info.played_at;
              const last = plays[plays.length - 1];
              const endsAt = last ? new Date(new Date(last.info.played_at).getTime() + last.info.durationMs) : null;
              const length = first && endsAt ? endsAt.getTime() - new Date(first).getTime() : s.sessionLength;
              return (
                <section key={i} className="card session-card">
                  <button className="session-head" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                    <span className="session-rank">{i + 1}</span>
                    <span className="session-text">
                      <span className="session-length">{f.duration(length / 1000)}</span>
                      <span className="muted small">
                        {first && date.format(new Date(first))} · {first && time.format(new Date(first))} – {endsAt && time.format(endsAt)} · {t("tracksN", { n: plays.length })}
                      </span>
                    </span>
                    <ChevronDown size={16} />
                  </button>
                  {open === i && (
                    <div className="session-tracks">
                      {plays.map(({ info }) => {
                        const track = s.full_tracks[info.id];
                        return (
                          <button key={info._id} className="history-row compact" onClick={() => navigate({ name: "track", id: info.id })}>
                            <span className="history-time tabular">{time.format(new Date(info.played_at))}</span>
                            <span className="media-text">
                              <span className="media-title">{track?.name ?? info.id}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

// --- Affinity ---

type Tab = "songs" | "artists" | "albums";

export function AffinityPage() {
  const { t, f } = useSettings();
  const { me, range, savePlaylist } = useApp();
  const prefs = useApi<GlobalPreferences>("/global/preferences").data;
  const accounts = (useApi<Account[]>("/accounts").data ?? []).filter((a) => a.id !== me.id);
  const [others, setOthers] = useState<string[]>([]);
  const [mode, setMode] = useState<"average" | "minima">("average");
  const [tab, setTab] = useState<Tab>("songs");
  const [picking, setPicking] = useState(false);
  const ids = others.length ? others : accounts.slice(0, 1).map((a) => a.id);
  const enabled = prefs?.allowAffinity !== false && ids.length > 0;
  const req = useApi<CollaborativeRow[]>(
    enabled ? `/spotify/collaborative/top/${tab}${qs({ start: range.start, end: range.end, mode })}${ids.map((id) => `&otherIds=${encodeURIComponent(id)}`).join("")}` : null,
  );
  const people = [me.id, ...ids];
  const nameOf = (id: string) => (id === me.id ? t("you") : (accounts.find((a) => a.id === id)?.username ?? id));
  const share = (row: CollaborativeRow) => people.map((p) => `${nameOf(p)} ${f.number(row[p] ?? 0)}`).join(" · ");

  return (
    <>
      <Toolbar title={t("affinity")} loading={req.loading} range>
        {enabled && tab === "songs" && (
          <button
            className="icon-button"
            title={t("saveAsPlaylist")}
            aria-label={t("saveAsPlaylist")}
            onClick={() => savePlaylist({ type: "affinity", interval: { start: range.start, end: range.end }, nb: 50, userIds: people, mode }, t("affinityPlaylist"))}
          >
            <ListMusic />
          </button>
        )}
      </Toolbar>
      <div className="content">
        <div className="page">
          <p className="muted small page-intro">{t("affinityHint")}</p>
          {prefs?.allowAffinity === false ? (
            <div className="empty-state">
              <p>{t("affinityOff")}</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="empty-state">
              <p>{t("affinityAlone")}</p>
            </div>
          ) : (
            <>
              <div className="affinity-bar">
                <div className="menu-anchor">
                  <button className="text-button" onClick={() => setPicking((p) => !p)} aria-haspopup="menu">
                    {t("withN", { names: ids.map(nameOf).join(", ") })} <ChevronDown size={14} />
                  </button>
                  {picking && (
                    <div className="menu left" role="menu">
                      {accounts.map((a) => {
                        const on = ids.includes(a.id);
                        return (
                          <button
                            key={a.id}
                            role="menuitemcheckbox"
                            aria-checked={on}
                            onClick={() => {
                              const next = on ? ids.filter((x) => x !== a.id) : [...ids, a.id];
                              setOthers(next.length ? next : ids);
                            }}
                          >
                            <span>{a.username}</span>
                            {on && <Check size={14} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="segmented" role="group">
                  {(["songs", "artists", "albums"] as Tab[]).map((x) => (
                    <button key={x} className={tab === x ? "active" : ""} onClick={() => setTab(x)}>
                      {t(x === "songs" ? "tracks" : x === "artists" ? "artists" : "albums")}
                    </button>
                  ))}
                </div>
                <div className="segmented" role="group">
                  <button className={mode === "average" ? "active" : ""} onClick={() => setMode("average")} title={t("modeAverageHint")}>
                    {t("modeAverage")}
                  </button>
                  <button className={mode === "minima" ? "active" : ""} onClick={() => setMode("minima")} title={t("modeMinimaHint")}>
                    {t("modeMinima")}
                  </button>
                </div>
              </div>
              <section className="card">
                {!req.data ? (
                  <div className="skeleton" style={{ height: 320 }} />
                ) : (
                  <MediaList
                    limit={50}
                    items={req.data.map((row) => {
                      const score = mode === "average" ? row.average_percents : row.minima;
                      const common = { value: score, main: f.percent(score), extra: share(row) };
                      if (tab === "artists")
                        return { id: row.artist.id, kind: "artist" as const, title: row.artist.name, images: row.artist.images, ...common };
                      if (tab === "albums")
                        return { id: row.album!.id, kind: "album" as const, title: row.album!.name, subtitle: <ArtistNames artists={[row.artist]} />, images: row.album!.images, ...common };
                      return { id: row.track!.id, kind: "track" as const, title: row.track!.name, subtitle: <ArtistNames artists={[row.artist]} />, images: row.album?.images, playable: true, ...common };
                    })}
                  />
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

