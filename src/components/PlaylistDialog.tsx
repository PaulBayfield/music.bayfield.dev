// "Save as a playlist": a new playlist, or added to one of yours (YourSpotify's /spotify/playlist/create).

import { useState } from "react";
import { api, type Playlist } from "../lib/api";
import type { PlaylistSource } from "../lib/app";
import { useApi } from "../lib/hooks";
import { useSettings } from "../lib/settings";
import { Dialog, useToast } from "./common";

export function PlaylistDialog({ source, name: initialName, onClose }: { source: PlaylistSource; name?: string; onClose: () => void }) {
  const { t } = useSettings();
  const toast = useToast();
  const playlists = useApi<Playlist[]>("/spotify/playlists");
  const [target, setTarget] = useState<string>("new");
  const [name, setName] = useState(initialName ?? "");
  const [nb, setNb] = useState("nb" in source ? source.nb : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title={t("saveAsPlaylist")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/spotify/playlist/create", {
              body: { ...source, ...("nb" in source ? { nb } : {}), ...(target === "new" ? { name: name.trim() || undefined } : { playlistId: target }) },
            });
            toast(target === "new" ? t("playlistCreated") : t("playlistUpdated"));
            onClose();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <label className="field">
          {t("playlist")}
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">{t("newPlaylist")}</option>
            {(playlists.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {target === "new" && (
          <label className="field">
            {t("nameLabel")}
            <input className="text-field" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={t("playlistNameHint")} autoFocus />
          </label>
        )}
        {"nb" in source && (
          <label className="field">
            {t("numberOfTracks")}
            <input className="text-field" type="number" min={1} max={500} value={nb} onChange={(e) => setNb(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} />
          </label>
        )}
        {playlists.error && <p className="small muted">{playlists.error}</p>}
        {target !== "new" && <p className="small muted">{t("addsToPlaylist")}</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="primary-button" disabled={busy}>
            {target === "new" ? t("create") : t("add")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
