import { useEffect, useState, type ReactNode } from "react";
import { useApp, type SettingsPage } from "../lib/app";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { Ban, BarChart, Database, Info, Keyboard, Link, Shield, Sliders, SpotifyLogo, Upload, UserIcon, Users, X } from "./icons";
import { PreferencesPage, ProfilePage, SecurityPage } from "./settings/AccountPages";
import { BlacklistPage, DataPage, ImportPage, SharingPage, SpotifyPage } from "./settings/MusicPages";
import { AboutPage, UsersPage } from "./settings/AdminPages";
import { StatisticsPage } from "./settings/StatisticsPage";
import { PageHeader } from "./settings/common";
import { ShortcutList } from "./Shortcuts";
import { useUpdateCheck } from "../lib/updates";

export function SettingsDialog({ page: initialPage, onClose }: { page: SettingsPage; onClose: () => void }) {
  const { t } = useSettings();
  const { me, guest } = useApp();
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const updates = useUpdateCheck(!guest);
  const version = updates.status?.current ?? __APP_VERSION__;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".dialog") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  type Item = { id: SettingsPage; label: StringKey; icon: ReactNode; page: () => ReactNode };
  const groups: { label: StringKey; items: Item[] }[] = guest
    ? [
        {
          label: "settings",
          items: [
            { id: "preferences", label: "preferences", icon: <Sliders />, page: () => <PreferencesPage /> },
            { id: "shortcuts", label: "shortcuts", icon: <Keyboard />, page: () => <ShortcutsPage /> },
          ],
        },
      ]
    : [
        {
          label: "settings",
          items: [
            { id: "profile", label: "profile", icon: <UserIcon />, page: () => <ProfilePage /> },
            { id: "preferences", label: "preferences", icon: <Sliders />, page: () => <PreferencesPage /> },
            { id: "security", label: "security", icon: <Shield />, page: () => <SecurityPage /> },
            { id: "spotify", label: "spotify", icon: <SpotifyLogo />, page: () => <SpotifyPage /> },
            { id: "import", label: "importHistory", icon: <Upload />, page: () => <ImportPage /> },
            { id: "blacklist", label: "hiddenArtists", icon: <Ban />, page: () => <BlacklistPage /> },
            { id: "sharing", label: "sharing", icon: <Link />, page: () => <SharingPage /> },
            { id: "data", label: "data", icon: <Database />, page: () => <DataPage /> },
          ],
        },
        {
          label: "appName",
          items: [
            { id: "statistics", label: "statistics", icon: <BarChart />, page: () => <StatisticsPage /> },
            { id: "shortcuts", label: "shortcuts", icon: <Keyboard />, page: () => <ShortcutsPage /> },
            ...(me.admin ? [{ id: "users" as const, label: "users" as const, icon: <Users />, page: () => <UsersPage /> }] : []),
            { id: "about", label: "about", icon: <Info />, page: () => <AboutPage updates={updates} /> },
          ],
        },
      ];
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => i.id === page) ?? all[0];

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal" role="dialog" aria-label={t("settings")}>
        <nav className="settings-nav">
          {groups.map((g, i) => (
            <div key={g.label} style={{ display: "contents" }}>
              <div className={`settings-nav-label${i > 0 ? " spaced" : ""}`}>{t(g.label)}</div>
              {g.items.map((item) => (
                <button key={item.id} className={`settings-nav-item${current.id === item.id ? " active" : ""}`} onClick={() => setPage(item.id)}>
                  {item.icon}
                  <span>{t(item.label)}</span>
                </button>
              ))}
            </div>
          ))}
          {!guest && (
            <button className="settings-version" onClick={() => setPage("about")}>
              {t("version", { version })}
              {updates.status?.available && <span className="settings-version-update">{t("updateShort")}</span>}
            </button>
          )}
        </nav>
        <div className="settings-content">
          <button className="icon-button small settings-close" aria-label={t("close")} onClick={onClose}>
            <X />
          </button>
          <div className="settings-page" key={current.id}>
            {current.page()}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutsPage() {
  const { t } = useSettings();
  return (
    <>
      <PageHeader title={t("shortcuts")} />
      <ShortcutList />
    </>
  );
}
