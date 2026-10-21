// Plays, newest first, under a heading per day (the side panel and the History page).

import type { ReactNode } from "react";
import { useApp } from "../lib/app";
import { useSettings } from "../lib/settings";
import type { HistoryState } from "./HistoryPanel";
import { ArtistNames, Cover } from "./music";

/** The local day ("YYYY-MM-DD") and time of an instant in a time zone. */
function localParts(iso: string, tz: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return { day, date: d };
}

export function HistoryList({ history, compact }: { history: HistoryState; compact?: boolean }) {
  const { t, f } = useSettings();
  const { me, navigate } = useApp();
  const { items, done, busy, more } = history;
  if (!items) return <div className="skeleton" style={{ height: 240 }} />;
  if (!items.length) return <p className="empty-card">{t("noPlays")}</p>;

  const time = new Intl.DateTimeFormat(f.locale, { hour: "numeric", minute: "2-digit", hour12: f.hour12, timeZone: me.timezone });
  const todayDay = localParts(new Date().toISOString(), me.timezone).day;
  const dayLabel = (day: string) => (day === todayDay ? t("today") : f.longDate(day));

  const rows: ReactNode[] = [];
  let last = "";
  for (const item of items) {
    const { day, date } = localParts(item.played_at, me.timezone);
    if (day !== last) {
      last = day;
      rows.push(
        <div key={`d${day}`} className="history-day">
          {dayLabel(day)}
        </div>,
      );
    }
    rows.push(
      <div
        key={item._id}
        role="button"
        tabIndex={0}
        className={`history-row${compact ? " compact" : ""}`}
        onClick={() => navigate({ name: "track", id: item.track.id })}
        onKeyDown={(e) => e.key === "Enter" && navigate({ name: "track", id: item.track.id })}
      >
        <Cover images={item.track.full_album?.images} size={compact ? 32 : 40} />
        <span className="media-text">
          <span className="media-title" title={item.track.name}>
            {item.track.name}
          </span>
          <span className="media-subtitle">
            <ArtistNames ids={item.track.artists} artists={item.track.full_artists} />
            {!compact && item.track.full_album && (
              <>
                {" · "}
                <span
                  className="inline-link"
                  role="link"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate({ name: "album", id: item.track.full_album!.id });
                  }}
                >
                  {item.track.full_album.name}
                </span>
              </>
            )}
          </span>
        </span>
        <span className="history-time tabular">{time.format(date)}</span>
      </div>,
    );
  }

  return (
    <div className="history-list">
      {rows}
      {!done && (
        <button className="link-button breakdown-more" disabled={busy} onClick={more}>
          {busy ? t("loading") : t("loadMore")}
        </button>
      )}
    </div>
  );
}
