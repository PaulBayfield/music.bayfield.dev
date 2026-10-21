// The side panel on the right (like Calendar's event panel and DevTime's filters): what you just
// listened to, newest first, grouped by day. Toggled with "." or the button at the end of the toolbar.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, query as qs, type HistoryItem } from "../lib/api";
import { useApp } from "../lib/app";
import { useSettings } from "../lib/settings";
import { Refresh, X } from "./icons";
import { HistoryList } from "./HistoryList";

const PAGE = 50;

/** Recently played, a page at a time (YourSpotify's /spotify/gethistory), optionally within a range. */
export function useHistory(range?: { start: string; end: string }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = range ? `${range.start}|${range.end}` : "";
  const keyRef = useRef(key);
  keyRef.current = key;

  const load = useCallback(
    async (offset: number) => {
      setBusy(true);
      try {
        const page = await api<HistoryItem[]>(`/spotify/gethistory${qs({ number: PAGE, offset, ...(range ?? {}) })}`);
        if (keyRef.current !== key) return;
        setItems((prev) => (offset === 0 ? page : [...(prev ?? []), ...page]));
        setDone(page.length < PAGE);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    setItems(null);
    void load(0);
  }, [load]);

  const count = items?.length ?? 0;
  const more = useCallback(() => void load(count), [load, count]);
  const refresh = useCallback(() => void load(0), [load]);
  return { items, done, busy, more, refresh };
}

export type HistoryState = ReturnType<typeof useHistory>;

export function HistoryPanel() {
  const { t } = useSettings();
  const { togglePanel } = useApp();
  const history = useHistory();

  // New plays show up every couple of minutes.
  useEffect(() => {
    const timer = window.setInterval(() => document.visibilityState === "visible" && history.refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [history.refresh]);

  return (
    <aside className="panel">
      <div className="panel-header">
        <span className="panel-label">{t("recentlyPlayed")}</span>
        <div className="toolbar-spacer" />
        <button className="icon-button" aria-label={t("refresh")} title={t("refresh")} onClick={history.refresh}>
          <Refresh size={14} />
        </button>
        <button className="icon-button" aria-label={t("close")} title={`${t("close")} (.)`} onClick={togglePanel}>
          <X />
        </button>
      </div>
      <div className="panel-body">
        <HistoryList history={history} compact />
      </div>
    </aside>
  );
}
