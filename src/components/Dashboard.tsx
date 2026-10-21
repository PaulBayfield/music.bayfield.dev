import { useMemo, useState, type ReactNode } from "react";
import { query as qs, type Summary, type TopItem } from "../lib/api";
import { useApp } from "../lib/app";
import { useApi } from "../lib/hooks";
import { previousRange, rangeParams } from "../lib/range";
import { useSettings } from "../lib/settings";
import { Heatmap, Legend, RhythmGrid, TimeChart, TimeTable, bucketize } from "./charts";
import { BarChart, ChevronRight, Music, Table, Upload } from "./icons";
import { ArtistNames, MediaList, mmss, trackItem, useMetric } from "./music";
import { Toolbar } from "./Toolbar";

export function Dashboard() {
  const { t, f } = useSettings();
  const { query, setQuery, navigate, artistColor, me, range, openSettings, guest } = useApp();
  const allTime = rangeParams(query).range === "all_time";
  const days = allTime ? { to: range.to } : { from: range.from, to: range.to };
  const interval = { start: range.start, end: range.end };

  const stats = useApi<Summary>(`/app/summary${qs(days)}`);
  const s = stats.data;
  const prevRange = s && !allTime ? previousRange(s.from, addOne(s.to)) : null;
  const prev = useApi<Summary>(prevRange ? `/app/summary${qs(prevRange)}` : null).data;
  const heat = useApi<{ date: string; ms: number; plays: number }[]>("/app/activity").data;
  const rhythm = useApi<number[][]>(`/app/rhythm${qs(days)}`).data;
  const songs = useApi<TopItem[]>(`/spotify/top/songs${qs({ ...interval, nb: 10 })}`).data;
  const artists = useApi<TopItem[]>(`/spotify/top/artists${qs({ ...interval, nb: 10 })}`).data;
  const albums = useApi<TopItem[]>(`/spotify/top/albums${qs({ ...interval, nb: 10 })}`).data;

  const [table, setTable] = useState(false);
  const metric = useMetric();

  const chart = useMemo(
    () => (s ? bucketize(s.days.map((d) => ({ date: d.date, total: d.ms / 1000, series: Object.fromEntries(Object.entries(d.artists).map(([k, v]) => [k, v / 1000])) })), me.weekStart) : null),
    [s, me.weekStart],
  );
  const series = s?.top.map((x) => x.artist.id) ?? [];
  const names = new Map(s?.top.map((x) => [x.artist.id, x.artist.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const noPlaysEver = !me.firstListenedAt;

  return (
    <>
      <Toolbar title={t("dashboard")} loading={stats.loading} range />
      <div className="content">
        <div className="page">
          {noPlaysEver ? (
            <div className="card">
              <div className="empty-state">
                <Music size={32} />
                <h2>{t("noPlaysYet")}</h2>
                <p>{t("noPlaysYetHint")}</p>
                {!guest && (
                  <button className="primary-button" onClick={() => openSettings("import")}>
                    <Upload size={14} />
                    {t("importHistory")}
                  </button>
                )}
              </div>
            </div>
          ) : !s ? (
            stats.error ? (
              <div className="card">
                <p className="error-text">{stats.error}</p>
                <button className="text-button" onClick={stats.reload}>
                  {t("retry")}
                </button>
              </div>
            ) : (
              <>
                <div className="skeleton" style={{ height: 96 }} />
                <div className="skeleton" style={{ height: 300 }} />
              </>
            )
          ) : (
            <>
              <Overview summary={s} previous={prev} />

              <section className="card">
                <div className="card-head">
                  <span className="card-title">
                    {chart?.granularity === "month" ? t("timePerMonth") : chart?.granularity === "week" ? t("timePerWeek") : t("timePerDay")}
                  </span>
                  <div className="segmented" role="group">
                    <button className={!table ? "active" : ""} onClick={() => setTable(false)} title={t("showChart")} aria-label={t("showChart")}>
                      <BarChart size={14} />
                    </button>
                    <button className={table ? "active" : ""} onClick={() => setTable(true)} title={t("showTable")} aria-label={t("showTable")}>
                      <Table size={14} />
                    </button>
                  </div>
                </div>
                {s.top.length > 1 && (
                  <Legend
                    items={legendItems(s)}
                    colorOf={artistColor}
                    nameOf={nameOf}
                    onPick={(id) => navigate({ name: "artist", id })}
                  />
                )}
                {chart &&
                  (table ? (
                    <TimeTable buckets={chart.buckets} granularity={chart.granularity} />
                  ) : (
                    <TimeChart
                      buckets={chart.buckets}
                      granularity={chart.granularity}
                      series={series}
                      colorOf={artistColor}
                      nameOf={nameOf}
                      onPick={(b) => setQuery({ range: undefined, from: b.from, to: b.to })}
                    />
                  ))}
              </section>

              <div className="grid">
                <Panel className="span-6" title={t("topTracks")} onMore={() => navigate({ name: "tracks" })}>
                  {!songs ? (
                    <div className="skeleton" style={{ height: 200 }} />
                  ) : (
                    <MediaList
                      items={songs.map((x) =>
                        trackItem(x.track, x.album, [x.artist], metric.value(x.count, x.duration_ms), metric.main(x.count, x.duration_ms), metric.extra(x.count, x.duration_ms)),
                      )}
                    />
                  )}
                </Panel>
                <Panel className="span-6" title={t("topArtists")} onMore={() => navigate({ name: "artists" })}>
                  {!artists ? (
                    <div className="skeleton" style={{ height: 200 }} />
                  ) : (
                    <MediaList
                      items={artists.map((x) => ({
                        id: x.artist.id,
                        kind: "artist" as const,
                        title: x.artist.name,
                        subtitle: t("differentTracksN", { n: x.differents }),
                        images: x.artist.images,
                        value: metric.value(x.count, x.duration_ms),
                        main: metric.main(x.count, x.duration_ms),
                        extra: f.percent(metric.byTime ? x.duration_ms / x.total_duration_ms : x.count / x.total_count),
                        color: artistColor(x.artist.id),
                      }))}
                    />
                  )}
                </Panel>
                <Panel className="span-6" title={t("topAlbums")} onMore={() => navigate({ name: "albums" })}>
                  {!albums ? (
                    <div className="skeleton" style={{ height: 200 }} />
                  ) : (
                    <MediaList
                      items={albums.map((x) => ({
                        id: x.album.id,
                        kind: "album" as const,
                        title: x.album.name,
                        subtitle: <ArtistNames artists={[x.artist]} />,
                        images: x.album.images,
                        value: metric.value(x.count, x.duration_ms),
                        main: metric.main(x.count, x.duration_ms),
                        extra: metric.extra(x.count, x.duration_ms),
                      }))}
                    />
                  )}
                </Panel>
                <Habits className="span-6" interval={interval} summary={s} />
              </div>

              {heat && (
                <section className="card">
                  <div className="card-head">
                    <span className="card-title">{t("activity")}</span>
                    <span className="card-hint">{t("activityHint", { total: f.duration(heat.reduce((sum, d) => sum + d.ms, 0) / 1000) })}</span>
                  </div>
                  <Heatmap
                    days={heat.map((d) => ({ date: d.date, seconds: d.ms / 1000 }))}
                    weekStart={me.weekStart}
                    onPick={(day) => setQuery({ range: undefined, from: day, to: day })}
                  />
                </section>
              )}

              {rhythm && s.ms > 0 && (
                <section className="card">
                  <div className="card-head">
                    <span className="card-title">{t("rhythm")}</span>
                    <span className="card-hint">{t("rhythmHint")}</span>
                  </div>
                  <RhythmGrid grid={rhythm.map((row) => row.map((ms) => ms / 1000))} weekStart={me.weekStart} />
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

const addOne = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function Panel({ title, className, children, onMore, hint }: { title: string; className?: string; children: ReactNode; onMore?: () => void; hint?: ReactNode }) {
  const { t } = useSettings();
  return (
    <section className={`card ${className ?? ""}`}>
      <div className="card-head">
        <span className="card-title">{title}</span>
        {hint && <span className="card-hint">{hint}</span>}
        {onMore && (
          <button className="link-button card-more" onClick={onMore}>
            {t("seeAll")}
            <ChevronRight size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** The top artists with their time, then everything else as one "Other" entry. */
function legendItems(s: Summary) {
  const shown = s.top.map((x) => ({ name: x.artist.id, seconds: x.ms / 1000 }));
  const other = s.ms - s.top.reduce((sum, x) => sum + x.ms, 0);
  return other > 1000 ? [...shown, { name: "\0other", seconds: other / 1000 }] : shown;
}

function Overview({ summary, previous }: { summary: Summary; previous: Summary | undefined }) {
  const { t, f } = useSettings();
  const elapsed = summary.days.length || 1;
  const active = summary.days.filter((d) => d.ms > 0);
  const best = summary.days.reduce((a, b) => (b.ms > a.ms ? b : a), summary.days[0]);
  const delta = previous && previous.ms > 0 ? (summary.ms - previous.ms) / previous.ms : null;

  return (
    <section className="overview">
      <div>
        <div className="hero-label">{t("listeningTime")}</div>
        <div className="hero-number">{f.duration(summary.ms / 1000)}</div>
        <div className="hero-delta">
          {delta === null ? (
            previous ? t("noPrevious") : " "
          ) : (
            <span>
              <span className={delta >= 0 ? "delta-up" : "delta-down"}>
                {delta >= 0 ? "▲" : "▼"} {f.percent(Math.abs(delta))}
              </span>{" "}
              {t("vsPrevious")}
            </span>
          )}
        </div>
      </div>
      <div className="stat">
        <span className="stat-label">{t("plays")}</span>
        <span className="stat-value">{f.number(summary.plays)}</span>
        <span className="stat-sub">{summary.days.length > 1 ? t("perDayN", { n: f.number(Math.round(summary.plays / elapsed)) }) : " "}</span>
      </div>
      <div className="stat">
        <span className="stat-label">{t("differentTracks")}</span>
        <span className="stat-value">{f.number(summary.tracks)}</span>
        <span className="stat-sub">{t("artistsAlbumsN", { artists: f.number(summary.artists), albums: f.number(summary.albums) })}</span>
      </div>
      {summary.days.length > 1 && (
        <>
          <div className="stat">
            <span className="stat-label">{t("dailyAverage")}</span>
            <span className="stat-value">{f.duration(summary.ms / 1000 / elapsed)}</span>
            <span className="stat-sub">{t("activeDaysN", { n: active.length, total: summary.days.length })}</span>
          </div>
          {best && best.ms > 0 && (
            <div className="stat">
              <span className="stat-label">{t("bestDay")}</span>
              <span className="stat-value">{f.duration(best.ms / 1000)}</span>
              <span className="stat-sub">{f.longDate(best.date)}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** A few facts about the range (release years, features, variety, peak hour), and your streaks. */
/** Runs of consecutive days with music (GET /app/streaks). */
interface Streaks {
  current: { start: string; end: string; days: number } | null;
  longest: { start: string; end: string; days: number } | null;
  today: string;
}

function Habits({ className, interval, summary }: { className: string; interval: { start: string; end: string }; summary: Summary }) {
  const { t, f } = useSettings();
  const years = useApi<{ totalYear: number; count: number }[]>(`/spotify/album_date_ratio${qs({ ...interval, timeSplit: "all" })}`).data;
  const feats = useApi<{ count: number; average: number; 1: number }[]>(`/spotify/feat_ratio${qs({ ...interval, timeSplit: "all" })}`).data;
  const hours = useApi<{ _id: number; count: number }[]>(`/spotify/time_per_hour_of_day${qs(interval)}`).data;
  const streaks = useApi<Streaks>("/app/streaks").data;
  const days = (n: number) => (n === 1 ? t("oneDay") : t("daysN", { n: f.number(n) }));
  const year = years?.[0];
  const feat = feats?.[0];
  const peak = hours?.length ? hours.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  const row = (label: string, value: ReactNode, hint?: ReactNode) => (
    <div className="habit">
      <span className="habit-label">{label}</span>
      <span className="habit-value">{value}</span>
      {hint && <span className="habit-hint">{hint}</span>}
    </div>
  );
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <span className="card-title">{t("habits")}</span>
      </div>
      <div className="habits">
        {row(t("averageReleaseYear"), year ? Math.round(year.totalYear) : "—", t("averageReleaseYearHint"))}
        {row(t("withFeatures"), feat ? f.percent(1 - feat[1] / feat.count) : "—", feat ? t("artistsPerTrackN", { n: f.number(Math.round(feat.average * 100) / 100) }) : undefined)}
        {row(t("variety"), summary.plays ? f.percent(summary.tracks / summary.plays) : "—", t("varietyHint"))}
        {row(t("peakHour"), peak ? f.hour(peak._id) : "—", t("peakHourHint"))}
        {row(t("averageTrack"), summary.plays ? mmss(summary.ms / summary.plays) : "—", t("averageTrackHint"))}
        {row(t("perArtist"), summary.artists ? f.number(Math.round(summary.plays / summary.artists)) : "—", t("perArtistHint"))}
        {row(
          t("currentStreak"),
          streaks ? (streaks.current ? days(streaks.current.days) : t("noStreak")) : "—",
          streaks?.current ? (streaks.current.end < streaks.today ? t("streakKeepGoing") : t("streakSince", { date: f.mediumDate(streaks.current.start) })) : t("streakHint"),
        )}
        {row(
          t("longestStreak"),
          streaks?.longest ? days(streaks.longest.days) : "—",
          streaks?.longest ? `${f.mediumDate(streaks.longest.start)} – ${f.mediumDate(streaks.longest.end)}` : undefined,
        )}
      </div>
    </section>
  );
}
