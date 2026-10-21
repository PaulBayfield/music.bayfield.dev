// What every page of the signed-in app can reach: the user, navigation, the range, colours, actions.

import { createContext, useContext } from "react";
import type { Me, ServerInfo } from "./api";
import type { Route } from "./router";

export type SettingsPage =
  | "profile"
  | "preferences"
  | "security"
  | "spotify"
  | "import"
  | "blacklist"
  | "sharing"
  | "data"
  | "statistics"
  | "shortcuts"
  | "users"
  | "about";

/** What a playlist is made from (YourSpotify's /spotify/playlist/create bodies). */
export type PlaylistSource =
  | { type: "top"; interval: { start: string; end: string }; nb: number }
  | { type: "top-artist"; artistId: string; nb: number }
  | { type: "affinity"; interval: { start: string; end: string }; nb: number; userIds: string[]; mode: "average" | "minima" }
  | { type: "specific"; songIds: string[] };

export interface AppContextValue {
  me: Me;
  reloadMe: () => void;
  server: ServerInfo | undefined;
  /** Opened through a public link: read-only, someone else's stats. */
  guest: boolean;
  route: Route;
  query: Record<string, string>;
  navigate: (route: Route, query?: Record<string, string>) => void;
  setQuery: (patch: Record<string, string | undefined>, replace?: boolean) => void;
  /** The range in the address bar, as local days and as instants. */
  range: { start: string; end: string; from: string; to: string };
  /** A colour for each of the range's top artists. */
  artistColor: (id: string) => string;
  openSettings: (page?: SettingsPage) => void;
  signOut: () => void;
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  /** The recently played panel on the right. */
  panelVisible: boolean;
  togglePanel: () => void;
  openSearch: () => void;
  /** Plays a track on the user's active Spotify device. */
  play: (trackId: string) => void;
  /** Opens the "save as a playlist" dialog. */
  savePlaylist: (source: PlaylistSource, name?: string) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside the app");
  return v;
}
