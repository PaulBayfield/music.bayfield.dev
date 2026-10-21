import { useMemo, useState } from "react";
import { api, type Session } from "../../lib/api";
import { useApp } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings, type Settings, type Theme } from "../../lib/settings";
import type { StringKey } from "../../lib/i18n";
import { ConfirmDialog, useToast } from "../common";
import { PageHeader, Row, useSaveSettings } from "./common";

// --- Profile ---

export function ProfilePage() {
  const { t } = useSettings();
  const { me, signOut, reloadMe, server } = useApp();
  const { save } = useSaveSettings();
  const toast = useToast();
  const [name, setName] = useState(me.username);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [me.timezone];
    }
  }, [me.timezone]);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <>
      <PageHeader title={t("profile")} hint={t("profileHint")} />
      <section className="settings-rows">
        <Row label={t("nameLabel")} hint={t("nameHint")}>
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/rename", { method: "PUT", body: { newName: name.trim() } });
                reloadMe();
                toast(t("saved"));
              } catch (err) {
                toast((err as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <input className="text-field" value={name} minLength={2} maxLength={64} onChange={(e) => setName(e.target.value)} />
            <button className="primary-button" disabled={busy || name.trim() === me.username || name.trim().length < 2}>
              {t("save")}
            </button>
          </form>
        </Row>
        {me.email && (
          <Row label={t("emailLabel")} hint={t("emailHint")}>
            <span className="muted">{me.email}</span>
          </Row>
        )}
      </section>
      <section className="settings-rows">
        <Row label={t("timezone")} hint={t("timezoneHint")}>
          <select value={me.settings.timezone ?? ""} onChange={(e) => void save({ timezone: e.target.value || null }, { stats: true })}>
            <option value="">{t("serverDefault", { zone: (server?.defaultTimezone ?? me.timezone).replace(/_/g, " ") })}</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
                {z === browserZone ? " ✓" : ""}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("weekStart")}>
          <select value={me.weekStart} onChange={(e) => void save({ weekStart: Number(e.target.value) }, { stats: true })}>
            <option value={1}>{t("monday")}</option>
            <option value={0}>{t("sunday")}</option>
          </select>
        </Row>
      </section>
      <section className="settings-rows">
        <Row label={t("deleteAccount")} hint={t("deleteAccountHint")}>
          <button className="text-button danger" onClick={() => setDeleting(true)}>
            {t("deleteAccount")}
          </button>
        </Row>
      </section>
      {deleting && (
        <ConfirmDialog
          title={t("deleteAccount")}
          text={t("deleteAccountHint")}
          word={me.username}
          action={t("deleteAccount")}
          onConfirm={async () => {
            await api("/app/profile/delete-account", { body: { confirm: me.username } });
            signOut();
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

// --- Preferences ---

const THEMES: { id: Theme; label: StringKey }[] = [
  { id: "system", label: "themeSystem" },
  { id: "light", label: "themeLight" },
  { id: "dark", label: "themeDark" },
  { id: "rosepine", label: "themeRosepine" },
  { id: "rosepine-dawn", label: "themeRosepineDawn" },
];

export function PreferencesPage() {
  const { t, settings, update } = useSettings();
  const { me, guest } = useApp();
  const { save } = useSaveSettings();
  const select = <K extends keyof Settings>(key: K, options: [Settings[K], string][]) => (
    <select
      value={String(settings[key])}
      onChange={(e) => update({ [key]: options.find(([v]) => String(v) === e.target.value)![0] } as Partial<Settings>)}
    >
      {options.map(([value, label]) => (
        <option key={String(value)} value={String(value)}>
          {label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader title={t("preferences")} hint={t("preferencesHint")} />
      <section>
        <h3>{t("appearance")}</h3>
        <div className="theme-picker">
          {THEMES.map(({ id, label }) => (
            <button key={id} className={`theme-card${settings.theme === id ? " active" : ""}`} onClick={() => update({ theme: id })}>
              <span className={`theme-preview ${id}`}>
                <span />
                <span />
                <span />
              </span>
              {t(label)}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-rows">
        <Row label={t("languageLabel")}>
          {select("language", [
            ["auto", t("automatic")],
            ["fr", "Français"],
            ["en", "English"],
          ])}
        </Row>
        <Row label={t("durationFormat")}>
          {select("durationStyle", [
            ["long", t("durationLong")],
            ["short", t("durationShort")],
            ["decimal", t("durationDecimal")],
          ])}
        </Row>
        <Row label={t("timeFormat")}>
          {select("timeFormat", [
            ["auto", t("automatic")],
            ["24h", "24h"],
            ["12h", "12h"],
          ])}
        </Row>
      </section>
      {!guest && (
        <section className="settings-rows">
          <h3>{t("statsSection")}</h3>
          <Row label={t("rankBy")} hint={t("rankByHint")}>
            <select value={me.settings.metricUsed} onChange={(e) => void save({ metricUsed: e.target.value }, { stats: true })}>
              <option value="number">{t("rankByPlays")}</option>
              <option value="duration">{t("rankByTime")}</option>
            </select>
          </Row>
          <Row label={t("elementsPerPeriod")} hint={t("elementsPerPeriodHint")}>
            <select value={me.settings.nbElements} onChange={(e) => void save({ nbElements: Number(e.target.value) }, { stats: true })}>
              {[5, 10, 15, 20, 30, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Row>
        </section>
      )}
    </>
  );
}

// --- Security ---

export function SecurityPage() {
  const { t, f } = useSettings();
  const sessions = useApi<Session[]>("/app/sessions");
  const reload = () => {
    invalidate("/app/sessions");
    sessions.reload();
  };

  return (
    <>
      <PageHeader title={t("security")} hint={t("securityHint")} />
      <section>
        <h3>{t("sessions_devices")}</h3>
        <div className="settings-list">
          {(sessions.data ?? []).map((s) => (
            <div key={s.id} className="settings-list-row">
              <div className="settings-list-main">
                <span>
                  {describeAgent(s.userAgent)}
                  {s.current && <span className="badge good">{t("thisDevice")}</span>}
                </span>
                <span className="small muted">
                  {t("lastActiveAt", { when: f.relative(s.lastSeenAt, t) })} · {s.ip}
                </span>
              </div>
              {!s.current && (
                <button
                  className="text-button"
                  onClick={async () => {
                    await api(`/app/sessions/${s.id}`, { method: "DELETE" });
                    reload();
                  }}
                >
                  {t("signOutDevice")}
                </button>
              )}
            </div>
          ))}
        </div>
        {(sessions.data?.length ?? 0) > 1 && (
          <button
            className="text-button"
            style={{ marginTop: 10 }}
            onClick={async () => {
              await api("/app/sessions/revoke-others", { method: "POST" });
              reload();
            }}
          >
            {t("signOutOthers")}
          </button>
        )}
      </section>
    </>
  );
}

/** "Chrome · Windows" from a user agent, roughly. */
function describeAgent(ua: string): string {
  const browser = /edg\//i.test(ua) ? "Edge" : /firefox\//i.test(ua) ? "Firefox" : /chrome\//i.test(ua) ? "Chrome" : /safari\//i.test(ua) ? "Safari" : ua.split(" ")[0] || "?";
  const os = /windows/i.test(ua) ? "Windows" : /android/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iOS" : /mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}
