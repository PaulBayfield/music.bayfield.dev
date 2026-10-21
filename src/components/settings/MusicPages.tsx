import { useEffect, useRef, useState } from "react";
import { api, query as qs, type Artist, type HistoryItem, type ImportState } from "../../lib/api";
import { useApp } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import { CopyButton, useToast } from "../common";
import { Download, ExternalLink, Refresh, SpotifyLogo, Upload } from "../icons";
import { Cover } from "../music";
import { PageHeader, Row } from "./common";

// --- Spotify ---

export function SpotifyPage() {
  const { t, f } = useSettings();
  const { me, reloadMe, server } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const last = me.lastTimestamp > 0 ? new Date(me.lastTimestamp) : null;

  return (
    <>
      <PageHeader title={t("spotify")} hint={t("spotifyHint", { minutes: Math.round((server?.pollIntervalSeconds ?? 120) / 60) })} />
      <section className="settings-rows">
        <Row label={t("spotifyAccount")} hint={me.spotifyId.startsWith("dev:") ? t("devAccount") : me.spotifyId}>
          {me.spotifyLinked ? <span className="badge good">{t("collecting")}</span> : <span className="badge">{t("notCollecting")}</span>}
        </Row>
        {me.pollError && (
          <Row label={t("lastError")}>
            <span className="error-text small">{me.pollError}</span>
          </Row>
        )}
        <Row label={t("lastFetch")} hint={t("lastFetchHint")}>
          <button
            className="text-button"
            disabled={busy || !me.spotifyLinked}
            onClick={async () => {
              setBusy(true);
              try {
                const { added } = await api<{ added: number }>("/app/poll", { method: "POST" });
                invalidate();
                reloadMe();
                toast(t("fetchedN", { n: added }));
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Refresh size={14} />
            {last ? f.relative(last, t) : t("never")}
          </button>
        </Row>
        <Row label={t("reconnect")} hint={t("reconnectHint")}>
          <a className="text-button" href="/api/oauth/spotify">
            <SpotifyLogo size={14} />
            {t("signInWithSpotify")}
          </a>
        </Row>
      </section>
      <LastCollected />
    </>
  );
}

/** The last plays collected from Spotify, newest first. */
function LastCollected() {
  const { t, f } = useSettings();
  const { me } = useApp();
  // Keyed on the last fetch, so "Fetch now" shows what it brought in.
  const plays = useApi<HistoryItem[]>(`/spotify/gethistory${qs({ number: 10, offset: 0, at: me.lastTimestamp })}`);
  return (
    <section>
      <h3>{t("lastCollected")}</h3>
      {!plays.data ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : plays.data.length === 0 ? (
        <p className="settings-empty">{t("noPlays")}</p>
      ) : (
        <div className="settings-list">
          {plays.data.map((p) => (
            <div key={p._id} className="settings-list-row">
              <Cover images={p.track.full_album?.images} size={32} />
              <div className="settings-list-main">
                <span>{p.track.name}</span>
                <span className="small muted">{p.track.full_artists.map((a) => a.name).join(", ")}</span>
              </div>
              <span className="small muted tabular" title={new Date(p.played_at).toLocaleString(f.locale)}>
                {f.relative(p.played_at, t)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --- Import ---

const STATUS = { progress: "importRunning", success: "importDone", failure: "importFailed", "failure-removed": "importRemoved" } as const;

export function ImportPage() {
  const { t, f } = useSettings();
  const { reloadMe } = useApp();
  const toast = useToast();
  const imports = useApi<ImportState[]>("/imports");
  const running = imports.data?.some((i) => i.status === "progress");
  const [busy, setBusy] = useState(false);
  const reload = () => {
    invalidate("/imports");
    imports.reload();
  };

  // Follow a running import.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(reload, 3000);
    return () => {
      window.clearInterval(timer);
      invalidate();
      reloadMe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const upload = async (type: "privacy" | "full-privacy", files: FileList | null) => {
    if (!files?.length) return;
    const form = new FormData();
    for (const file of files) form.append("imports", file);
    setBusy(true);
    try {
      await api(`/import/${type}`, { form });
      toast(t("importStarted"));
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t("importHistory")} hint={t("importHint")} />
      <section className="settings-rows">
        <Row label={t("importFull")} hint={t("importFullHint")}>
          <FilePick disabled={busy || running} onPick={(files) => void upload("full-privacy", files)} />
        </Row>
        <Row label={t("importAccount")} hint={t("importAccountHint")}>
          <FilePick disabled={busy || running} onPick={(files) => void upload("privacy", files)} />
        </Row>
        <Row label={t("requestExport")}>
          <a className="text-button" href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            spotify.com
          </a>
        </Row>
      </section>
      {(imports.data?.length ?? 0) > 0 && (
        <section>
          <h3>{t("imports")}</h3>
          <div className="settings-list">
            {imports.data!.map((i) => (
              <div key={i._id} className="settings-list-row">
                <div className="settings-list-main">
                  <span>
                    {t(i.type === "full-privacy" ? "importFull" : "importAccount")}
                    <span className={`badge${i.status === "success" ? " good" : ""}`}>{t(STATUS[i.status])}</span>
                  </span>
                  <span className="small muted">
                    {f.relative(i.createdAt, t)} · {t("importProgress", { current: f.number(i.current), total: f.number(i.total) })}
                  </span>
                  {i.status === "progress" && (
                    <div className="meter">
                      <div className="meter-fill" style={{ width: `${(i.current / Math.max(1, i.total)) * 100}%` }} />
                    </div>
                  )}
                </div>
                {i.status === "failure" && (
                  <div className="row-actions">
                    <button
                      className="text-button"
                      disabled={running}
                      onClick={async () => {
                        await api("/import/retry", { body: { existingStateId: i._id } }).catch((e: Error) => toast(e.message, "error"));
                        reload();
                      }}
                    >
                      {t("retry")}
                    </button>
                    <button
                      className="text-button"
                      onClick={async () => {
                        await api(`/import/clean/${i._id}`, { method: "DELETE" });
                        reload();
                      }}
                    >
                      {t("remove")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function FilePick({ onPick, disabled }: { onPick: (files: FileList | null) => void; disabled?: boolean }) {
  const { t } = useSettings();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <button className="text-button" disabled={disabled} onClick={() => ref.current?.click()}>
        <Upload size={14} />
        {t("chooseFiles")}
      </button>
    </>
  );
}

// --- Hidden artists ---

export function BlacklistPage() {
  const { t } = useSettings();
  const { me, reloadMe, navigate } = useApp();
  const toast = useToast();
  const ids = me.settings.blacklistedArtists;
  const artists = useApi<Artist[]>(ids.length ? `/artist/${ids.map(encodeURIComponent).join(",")}` : null);

  return (
    <>
      <PageHeader title={t("hiddenArtists")} hint={t("hiddenArtistsHint")} />
      {ids.length === 0 ? (
        <p className="settings-empty">{t("noHiddenArtists")}</p>
      ) : (
        <div className="settings-list">
          {(artists.data ?? []).map((a) => (
            <div key={a.id} className="settings-list-row">
              <button className="settings-list-main artist-line" onClick={() => navigate({ name: "artist", id: a.id })}>
                <Cover images={a.images} size={28} round kind="artist" />
                <span>{a.name}</span>
              </button>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await api(`/artist/unblacklist/${encodeURIComponent(a.id)}`, { method: "POST" });
                    invalidate();
                    reloadMe();
                    toast(t("artistShown"));
                  } catch (e) {
                    toast((e as Error).message, "error");
                  }
                }}
              >
                {t("show")}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// --- Sharing ---

export function SharingPage() {
  const { t } = useSettings();
  const { me, reloadMe } = useApp();
  const toast = useToast();
  const link = me.publicToken ? `${location.origin}/?token=${me.publicToken}` : null;
  const act = async (path: string, message: string) => {
    try {
      await api(path, { method: "POST" });
      reloadMe();
      toast(message);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <PageHeader title={t("sharing")} hint={t("sharingHint")} />
      <section className="settings-rows">
        <Row label={t("publicLink")} hint={link ? t("publicLinkOn") : t("publicLinkOff")}>
          {link ? (
            <button className="text-button danger" onClick={() => void act("/delete-public-token", t("publicLinkRemoved"))}>
              {t("turnOff")}
            </button>
          ) : (
            <button className="primary-button" onClick={() => void act("/generate-public-token", t("publicLinkCreated"))}>
              {t("createLink")}
            </button>
          )}
        </Row>
        {link && (
          <>
            <Row label={t("link")} stack>
              <div className="code-block">
                <code>{link}</code>
                <CopyButton text={link} className="icon-button small copy-button" />
              </div>
            </Row>
            <Row label={t("newLink")} hint={t("newLinkHint")}>
              <button className="text-button" onClick={() => void act("/generate-public-token", t("publicLinkCreated"))}>
                <Refresh size={14} />
                {t("newLink")}
              </button>
            </Row>
          </>
        )}
      </section>
    </>
  );
}

// --- Data ---

export function DataPage() {
  const { t } = useSettings();
  return (
    <>
      <PageHeader title={t("data")} hint={t("dataHint")} />
      <section className="settings-rows">
        <Row label={t("exportHistory")} hint={t("exportHint")}>
          <div className="row-actions">
            <a className="text-button" href="/api/app/export?format=csv">
              <Download size={14} />
              CSV
            </a>
            <a className="text-button" href="/api/app/export?format=json">
              <Download size={14} />
              JSON
            </a>
          </div>
        </Row>
      </section>
    </>
  );
}
