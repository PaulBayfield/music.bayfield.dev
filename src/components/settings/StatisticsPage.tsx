import { useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import { PageHeader, Row } from "./common";

interface Statistics {
  you: {
    plays: number;
    ms: number;
    tracks: number;
    artists: number;
    albums: number;
    first: string | null;
    last: string | null;
    last24h: number;
    sessions: number;
  };
  server: null | {
    users: number;
    collecting: number;
    plays: number;
    last24h: number;
    tracks: number;
    albums: number;
    artists: number;
    dbSize: string;
    playsSize: string;
    postgres: string;
    node: string;
    uptimeSeconds: number;
    memoryMb: number;
    version: string;
    poller: { runs: number; plays: number; errors: number; lastRunAt: string | null; intervalSeconds: number };
  };
}

export function StatisticsPage() {
  const { t, f } = useSettings();
  const { data, error } = useApi<Statistics>("/app/statistics");
  const n = (v: number) => f.number(v);
  const bytes = (v: string) => {
    const b = Number(v);
    return b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
  };
  const uptime = (s: number) => (s >= 86400 ? t("daysN", { n: Math.floor(s / 86400) }) : s >= 3600 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 60)} min`);
  const when = (d: string | null) => (!d ? "—" : Date.now() - Date.parse(d) < 30 * 86400_000 ? f.relative(d, t) : f.mediumDate(d.slice(0, 10)));

  if (error) return <p className="error-text">{error}</p>;
  if (!data) return <div className="skeleton" style={{ height: 320 }} />;
  const { you, server } = data;

  return (
    <>
      <PageHeader title={t("statistics")} hint={t("statisticsHint")} />
      <section className="settings-rows">
        <h3>{t("yourData")}</h3>
        <Row label={t("plays")}>
          <span className="stat-cell">{n(you.plays)}</span>
        </Row>
        <Row label={t("last24h")}>
          <span className="stat-cell">{n(you.last24h)}</span>
        </Row>
        <Row label={t("listeningTime")}>
          <span className="stat-cell">{f.duration(you.ms / 1000)}</span>
        </Row>
        <Row label={`${t("tracks")} · ${t("artists")} · ${t("albums")}`}>
          <span className="stat-cell">
            {n(you.tracks)} · {n(you.artists)} · {n(you.albums)}
          </span>
        </Row>
        <Row label={t("firstListen")}>
          <span className="stat-cell">{you.first ? f.mediumDate(you.first.slice(0, 10)) : "—"}</span>
        </Row>
        <Row label={t("lastListen")}>
          <span className="stat-cell">{when(you.last)}</span>
        </Row>
      </section>

      {server && (
        <section className="settings-rows">
          <h3>{t("serverStats")}</h3>
          <Row label={t("users")} hint={t("collectingUsersHint", { n: server.collecting })}>
            <span className="stat-cell">{n(server.users)}</span>
          </Row>
          <Row label={t("plays")} hint={t("last24hHint", { n: n(server.last24h) })}>
            <span className="stat-cell">{n(server.plays)}</span>
          </Row>
          <Row label={`${t("tracks")} · ${t("artists")} · ${t("albums")}`} hint={t("catalogHint")}>
            <span className="stat-cell">
              {n(server.tracks)} · {n(server.artists)} · {n(server.albums)}
            </span>
          </Row>
          <Row label={t("collection")} hint={t("collectionHint", { runs: n(server.poller.runs), errors: n(server.poller.errors), seconds: server.poller.intervalSeconds })}>
            <span className="stat-cell">{when(server.poller.lastRunAt)}</span>
          </Row>
          <Row label={t("databaseSize")} hint={t("databaseSizeHint", { plays: bytes(server.playsSize) })}>
            <span className="stat-cell">{bytes(server.dbSize)}</span>
          </Row>
          <Row label={t("runtime")} hint={`PostgreSQL ${server.postgres} · Node ${server.node} · ${server.memoryMb} MB`}>
            <span className="stat-cell">{t("upFor", { time: uptime(server.uptimeSeconds) })}</span>
          </Row>
        </section>
      )}
    </>
  );
}
