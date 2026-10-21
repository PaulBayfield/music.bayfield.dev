// "All stats" (YourSpotify's /all page): every chart it had, over the range in the toolbar.
// Periods are hours, days, weeks or months depending on the range's length.

import { useMemo, useState } from "react";
import { query as qs, type Album, type Artist, type Track, type TopItem } from "../lib/api";
import { useApp } from "../lib/app";
import { palette } from "../lib/colors";
import { useApi } from "../lib/hooks";
import { keyOf, periodsOf, splitFor, type Period, type PeriodId, type Split } from "../lib/periods";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { HourChart } from "./charts";
import { HourStack, LineChart, PictureBars, ShareChart, type Point } from "./curves";
import { Panel } from "./Dashboard";
import { MetricSwitch } from "./TopPage";
import { useMetric } from "./music";
import { Toolbar } from "./Toolbar";

/** Round steps for durations (seconds), as the dashboard's chart uses. */
const DURATION_STEPS = [300, 900, 1800, 3600, 7200, 4 * 3600, 6 * 3600, 12 * 3600, 24 * 3600, 48 * 3600, 100 * 3600, 200 * 3600, 500 * 3600, 1000 * 3600];

type Row<T> = T & { _id: PeriodId | null };

export function AllStats() {
  const { t, f } = useSettings();
  const { range, navigate, artistColor, me } = useApp();
  const split: Split = splitFor(range.from, range.to);
  const periods = useMemo(() => periodsOf(range.from, range.to, split), [range.from, range.to, split]);
  const params = qs({ start: range.start, end: range.end, timeSplit: split });
  const interval = qs({ start: range.start, end: range.end });
  const metric = useMetric();

  const songs = useApi<Row<{ count: number; differents: number }>[]>(`/spotify/songs_per${params}`);
  const time = useApi<Row<{ count: number }>[]>(`/spotify/time_per${params}`);
  const variety = useApi<Row<{ artists: number }>[]>(`/app/variety${params}`);
  const years = useApi<Row<{ totalYear: number; count: number }>[]>(`/spotify/album_date_ratio${params}`);
  const feats = useApi<Row<{ average: number }>[]>(`/spotify/feat_ratio${params}`);
  const perArtist = useApi<Row<{ artists: Artist[]; counts: number[] }>[]>(`/spotify/best_artists_per${params}`);
  const top = useApi<TopItem[]>(`/spotify/top/artists${qs({ start: range.start, end: range.end, nb: 8 })}`).data;
  const best = useApi<TopItem[]>(`/spotify/top/artists${qs({ start: range.start, end: range.end, nb: 10 })}`).data;
  const hours = useApi<{ _id: number; count: number }[]>(`/spotify/time_per_hour_of_day${interval}`).data;

  /** Axis label and tooltip title of a period. */
  const multiYear = range.from.slice(0, 4) !== range.to.slice(0, 4);
  const label = (p: Period) =>
    split === "hour" ? f.hour(p.hour!) : split === "month" ? (multiYear ? f.monthYear(p.day) : f.monthShort(p.day)) : f.shortDate(p.day);
  const title = (p: Period) =>
    split === "hour"
      ? `${f.shortDate(p.day)}, ${f.hour(p.hour!)}`
      : split === "day"
        ? f.longDate(p.day)
        : split === "week"
          ? t("weekOf", { date: f.mediumDate(p.day) })
          : f.monthYearLong(p.day);

  /** One point per period; `empty` for periods without plays (0 for counts, a gap for averages). */
  function points<T>(rows: Row<T>[] | undefined, value: (r: T) => number, empty: number | null = 0): Point[] {
    const byKey = new Map((rows ?? []).map((r) => [keyOf(r._id, split), r]));
    return periods.map((p) => {
      const r = byKey.get(p.key);
      return { label: label(p), title: title(p), value: r ? value(r) : empty };
    });
  }

  // Shares of the range's top artists in each period, by plays or time (the user's metric).
  const shares = useMemo(() => {
    const totals = metric.byTime ? time.data : songs.data;
    if (!totals || !perArtist.data) return null;
    const totalOf = new Map(totals.map((r) => [keyOf(r._id, split), r.count]));
    const valuesOf = new Map(perArtist.data.map((r) => [keyOf(r._id, split), Object.fromEntries(r.artists.map((a, i) => [a.id, r.counts[i]]))]));
    // Periods without plays have no shares: left out rather than drawn as gaps.
    return periods.map((p) => ({ label: label(p), title: title(p), total: totalOf.get(p.key) ?? 0, values: valuesOf.get(p.key) ?? {} })).filter((b) => b.total > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs.data, time.data, perArtist.data, periods, metric.byTime]);
  const names = new Map(top?.map((x) => [x.artist.id, x.artist.name]));

  const per: StringKey = split === "hour" ? "perHour" : split === "day" ? "perDay" : split === "week" ? "perWeek" : "perMonth";
  const loading = songs.loading || time.loading;
  const hourValues = Array.from({ length: 24 }, (_, h) => {
    const v = hours?.find((x) => x._id === h)?.count ?? 0;
    return metric.byTime ? v / 1000 : v;
  });

  return (
    <>
      <Toolbar title={t("allStats")} loading={loading} range>
        <MetricSwitch />
      </Toolbar>
      <div className="content">
        <div className="page">
          <p className="muted small page-intro">{t("allStatsHint", { per: t(per).toLowerCase() })}</p>
          <div className="grid">
            <Panel className="span-6" title={t("bestArtists")}>
              {!best ? (
                <div className="skeleton" style={{ height: 220 }} />
              ) : (
                <PictureBars
                  items={best.map((x) => ({
                    id: x.artist.id,
                    name: x.artist.name,
                    images: x.artist.images,
                    value: metric.value(x.count, x.duration_ms),
                    text: metric.byTime ? f.duration(x.duration_ms / 1000, "short") : f.number(x.count),
                    color: artistColor(x.artist.id),
                  }))}
                  onPick={(id) => navigate({ name: "artist", id })}
                />
              )}
            </Panel>
            <Panel className="span-6" title={t("listeningOverDay")} hint={t("rhythmHint")}>
              {!hours ? (
                <div className="skeleton" style={{ height: 160 }} />
              ) : (
                <HourChart values={hourValues} format={(v) => (metric.byTime ? f.duration(v) : t("playsN", { n: f.number(v) }))} />
              )}
            </Panel>

            <Panel className="span-6" title={t("artistDistribution")} hint={t(per)}>
              {!shares ? (
                <div className="skeleton" style={{ height: 220 }} />
              ) : (
                <ShareChart
                  label={t("artistDistribution")}
                  buckets={shares}
                  series={(top ?? []).map((x) => x.artist.id)}
                  colorOf={artistColor}
                  nameOf={(id) => names.get(id) ?? id}
                  height={260}
                />
              )}
            </Panel>
            <BestOfHour className="span-6" interval={interval} />

            <Panel className="span-6" title={t("songsListened")} hint={t(per)}>
              {!songs.data ? (
                <div className="skeleton" style={{ height: 200 }} />
              ) : (
                <LineChart label={t("songsListened")} points={points(songs.data, (r) => r.count)} format={(v) => t("playsN", { n: f.number(Math.round(v)) })} tick={(v) => f.number(v)} />
              )}
            </Panel>
            <Panel className="span-6" title={t("timeListened")} hint={t(per)}>
              {!time.data ? (
                <div className="skeleton" style={{ height: 200 }} />
              ) : (
                <LineChart
                  label={t("timeListened")}
                  points={points(time.data, (r) => r.count / 1000)}
                  format={(v) => f.duration(v)}
                  tick={(v, step) => f.axisDuration(v, step)}
                  steps={DURATION_STEPS}
                />
              )}
            </Panel>
            <Panel className="span-6" title={t("differentArtistsListened")} hint={t(per)}>
              {!variety.data ? (
                <div className="skeleton" style={{ height: 200 }} />
              ) : (
                <LineChart label={t("differentArtistsListened")} points={points(variety.data, (r) => r.artists)} format={(v) => t("artistsN", { n: f.number(v) })} tick={(v) => f.number(v)} />
              )}
            </Panel>
            <Panel className="span-6" title={t("differentSongsListened")} hint={t(per)}>
              {!songs.data ? (
                <div className="skeleton" style={{ height: 200 }} />
              ) : (
                <LineChart label={t("differentSongsListened")} points={points(songs.data, (r) => r.differents)} format={(v) => t("tracksN", { n: f.number(v) })} tick={(v) => f.number(v)} />
              )}
            </Panel>
            <Panel className="span-6" title={t("averageReleaseDate")} hint={t(per)}>
              {!years.data ? (
                <div className="skeleton" style={{ height: 200 }} />
              ) : (
                <LineChart
                  label={t("averageReleaseDate")}
                  points={points(years.data, (r) => r.totalYear, null)}
                  format={(v) => String(Math.round(v))}
                  tick={(v) => String(Math.round(v))}
                  fromZero={false}
                />
              )}
            </Panel>
            <Panel className="span-6" title={t("averageFeats")} hint={t(per)}>
              {!feats.data ? (
                <div className="skeleton" style={{ height: 200 }} />
              ) : (
                <LineChart
                  label={t("averageFeats")}
                  points={points(feats.data, (r) => r.average, null)}
                  format={(v) => t("artistsPerTrackN", { n: v.toFixed(2) })}
                  tick={(v) => v.toFixed(2)}
                  fromZero={false}
                />
              )}
            </Panel>
          </div>
          <p className="muted small">{t("allStatsTimezone", { zone: me.timezone.replace(/_/g, " ") })}</p>
        </div>
      </div>
    </>
  );
}

type Kind = "artists" | "albums" | "songs";

/** The most played artists, albums or songs of each hour of the day. */
function BestOfHour({ className, interval }: { className: string; interval: string }) {
  const { t } = useSettings();
  const { navigate } = useApp();
  const settings = useSettings();
  const [kind, setKind] = useState<Kind>("artists");
  const data = useApi<{ hour: number; total: number; items: { itemId: string; total: number }[]; full_items: Record<string, Artist | Album | Track> }[]>(
    `/spotify/top/hour-repartition/${kind}${interval}`,
  ).data;

  const { hours, colorOf } = useMemo(() => {
    if (!data) return { hours: [], colorOf: () => "var(--text-faint)" };
    // Colours go to the items that lead the most hours overall.
    const totals = new Map<string, number>();
    for (const h of data) for (const i of h.items.slice(0, 5)) totals.set(i.itemId, (totals.get(i.itemId) ?? 0) + i.total);
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const colors = palette(ranked, settings.dark);
    return {
      hours: data.map((h) => ({ hour: h.hour, total: h.total, items: h.items.map((i) => ({ id: i.itemId, name: h.full_items[i.itemId]?.name ?? i.itemId, value: i.total })) })),
      colorOf: (id: string) => colors.get(id) ?? "var(--text-faint)",
    };
  }, [data, settings.dark]);

  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <span className="card-title">{t("bestOfHour")}</span>
        <div className="segmented" role="group">
          {(["artists", "albums", "songs"] as Kind[]).map((k) => (
            <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {t(k === "songs" ? "tracks" : k)}
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : (
        <HourStack hours={hours} colorOf={colorOf} onPick={(id) => navigate({ name: kind === "artists" ? "artist" : kind === "albums" ? "album" : "track", id })} />
      )}
    </section>
  );
}
