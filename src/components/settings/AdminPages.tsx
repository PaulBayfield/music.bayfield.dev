import { useState } from "react";
import { api, type AdminUser, type GlobalPreferences } from "../../lib/api";
import { useApp } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import type { UpdateCheck } from "../../lib/updates";
import { ConfirmDialog, Dropdown, useToast } from "../common";
import { ExternalLink, MoreHorizontal } from "../icons";
import { PageHeader, Row, Switch } from "./common";

export function UsersPage() {
  const { t, f } = useSettings();
  const { me } = useApp();
  const toast = useToast();
  const users = useApi<AdminUser[]>("/app/admin/users");
  const prefs = useApi<GlobalPreferences>("/global/preferences");
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const reload = () => {
    invalidate("/app/admin/users");
    users.reload();
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      reload();
      toast(t("saved"));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const setPref = (patch: Partial<GlobalPreferences>) =>
    run(async () => {
      await api("/global/preferences", { body: patch });
      invalidate("/global/");
      prefs.reload();
    });

  return (
    <>
      <PageHeader title={t("users")} hint={t("usersHint")} />
      <section className="settings-rows">
        <Row label={t("allowRegistrations")} hint={t("allowRegistrationsHint")}>
          <Switch checked={prefs.data?.allowRegistrations ?? true} disabled={!prefs.data} onChange={(on) => void setPref({ allowRegistrations: on })} />
        </Row>
        <Row label={t("allowAffinity")} hint={t("allowAffinityHint")}>
          <Switch checked={prefs.data?.allowAffinity ?? true} disabled={!prefs.data} onChange={(on) => void setPref({ allowAffinity: on })} />
        </Row>
      </section>
      <section>
        <div className="settings-list">
          {(users.data ?? []).map((u) => (
            <div key={u.id} className="settings-list-row">
              <div className="settings-list-main">
                <span>
                  {u.username}
                  {u.id === me.id && <span className="badge">{t("you")}</span>}
                  {u.isAdmin && <span className="badge good">{t("admin")}</span>}
                  {!u.collecting && <span className="badge" title={t("notCollectingHint")}>{t("notCollecting")}</span>}
                </span>
                <span className="small muted">
                  {t("playsN", { n: f.number(u.plays) })}
                  {u.lastPlayAt && ` · ${t("lastPlay", { when: f.relative(u.lastPlayAt, t) })}`}
                  {` · ${u.lastSeenAt ? t("lastSeen", { when: f.relative(u.lastSeenAt, t) }) : t("neverSeen")}`}
                </span>
                {u.pollError && <span className="small error-text">{u.pollError}</span>}
              </div>
              {u.id !== me.id && (
                <Dropdown button={(_, toggle) => <button className="icon-button small" aria-label={t("more")} onClick={toggle}><MoreHorizontal size={14} /></button>}>
                  {(close) => (
                    <>
                      <button
                        onClick={() => {
                          close();
                          void run(() => api(`/admin/${u.id}`, { method: "PUT", body: { status: !u.isAdmin } }));
                        }}
                      >
                        {u.isAdmin ? t("removeAdmin") : t("makeAdmin")}
                      </button>
                      <button
                        onClick={() => {
                          close();
                          void run(() => api(`/app/admin/users/${u.id}/sign-out`, { method: "POST" }));
                        }}
                      >
                        {t("signOutEverywhere")}
                      </button>
                      <div className="menu-separator" />
                      <button
                        className="danger"
                        onClick={() => {
                          close();
                          setDeleting(u);
                        }}
                      >
                        {t("deleteUser")}
                      </button>
                    </>
                  )}
                </Dropdown>
              )}
            </div>
          ))}
        </div>
      </section>
      {deleting && (
        <ConfirmDialog
          title={t("deleteUser")}
          text={t("deleteUserConfirm", { name: deleting.username })}
          word={deleting.username}
          action={t("delete")}
          onConfirm={async () => {
            await api(`/account/${deleting.id}`, { method: "DELETE" });
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** The version, whether a newer one is out, and where to find the source. */
export function AboutPage({ updates }: { updates: UpdateCheck }) {
  const { t, f } = useSettings();
  const { server } = useApp();
  const { status, checking, error, check } = updates;
  const version = status?.current ?? (server?.version && server.version !== "dev" ? server.version : __APP_VERSION__);
  const latest = status?.available ? status.latest : null;

  const hint = status?.disabled
    ? t("updateCheckOff")
    : checking
      ? t("checkingUpdates")
      : latest
        ? t("updateAvailable", { version: latest.version })
        : error
          ? t("updateCheckFailed")
          : status?.latest
            ? t("upToDate")
            : t("noReleases");

  return (
    <>
      <PageHeader title={t("about")} />
      <section className="settings-rows">
        <Row label={t("appName")} hint={t("aboutText")}>
          <span className="muted small tabular">{t("version", { version })}</span>
        </Row>
        <Row
          label={t("updates")}
          hint={
            <>
              {hint}
              {latest && <> {t("updateHowTo")}</>}
              {!latest && status?.checkedAt && !checking && !status.disabled && <> · {t("lastChecked", { when: f.relative(status.checkedAt, t) })}</>}
            </>
          }
        >
          {latest ? (
            <a className="primary-button" href={latest.url} target="_blank" rel="noreferrer">
              {t("whatsNew")}
            </a>
          ) : (
            !status?.disabled && (
              <button className="text-button" disabled={checking} onClick={() => void check()}>
                {t("checkForUpdates")}
              </button>
            )
          )}
        </Row>
        <Row label={t("allVersions")}>
          <a className="text-button" href={status?.releasesUrl ?? "https://github.com/PaulBayfield/music.bayfield.dev/releases"} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            {t("releaseNotes")}
          </a>
        </Row>
        <Row label={t("sourceCode")}>
          <a className="text-button" href="https://github.com/PaulBayfield/music.bayfield.dev" target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            GitHub
          </a>
        </Row>
      </section>
    </>
  );
}
