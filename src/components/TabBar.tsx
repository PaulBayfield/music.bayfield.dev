// The tab bar at the bottom of the screen on phones: the main pages within thumb's reach.
// The sidebar (☰ in the toolbar) still has everything else. Hidden from tablet width up.

import type { ReactNode } from "react";
import { useApp } from "../lib/app";
import type { Route } from "../lib/router";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { BarChart, History, Home, Mic, Music } from "./icons";

const TABS: { route: Route; label: StringKey; icon: ReactNode }[] = [
  { route: { name: "dashboard" }, label: "tabHome", icon: <Home size={20} /> },
  { route: { name: "all" }, label: "tabStats", icon: <BarChart size={20} /> },
  { route: { name: "tracks" }, label: "tracks", icon: <Music size={20} /> },
  { route: { name: "artists" }, label: "artists", icon: <Mic size={20} /> },
  { route: { name: "history" }, label: "history", icon: <History size={20} /> },
];

export function TabBar() {
  const { t } = useSettings();
  const { route, navigate } = useApp();
  return (
    <nav className="tab-bar" aria-label={t("pages")}>
      {TABS.map((tab) => {
        const on = route.name === tab.route.name;
        return (
          <button key={tab.route.name} className={`tab${on ? " active" : ""}`} aria-current={on ? "page" : undefined} onClick={() => navigate(tab.route)}>
            {tab.icon}
            <span>{t(tab.label)}</span>
          </button>
        );
      })}
    </nav>
  );
}
