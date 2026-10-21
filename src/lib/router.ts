// Address-bar routing: the path picks the page, the query string holds the range,
// so every view can be bookmarked and shared. Paths match YourSpotify's.

import { useCallback, useEffect, useState } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "all" }
  | { name: "tracks" }
  | { name: "artists" }
  | { name: "albums" }
  | { name: "history" }
  | { name: "sessions" }
  | { name: "affinity" }
  | { name: "artist"; id: string }
  | { name: "album"; id: string }
  | { name: "track"; id: string };

export function parseRoute(path: string): Route {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").map(decodeURIComponent);
  const [a, b] = parts;
  if (a === "top" && b === "songs") return { name: "tracks" };
  if (a === "top" && b === "artists") return { name: "artists" };
  if (a === "top" && b === "albums") return { name: "albums" };
  if (a === "history") return { name: "history" };
  if (a === "all") return { name: "all" };
  if (a === "sessions") return { name: "sessions" };
  if (a === "affinity" || (a === "collaborative" && b === "affinity")) return { name: "affinity" };
  if (a === "artist" && b) return { name: "artist", id: b };
  if (a === "album" && b) return { name: "album", id: b };
  if (a === "song" && b) return { name: "track", id: b };
  return { name: "dashboard" };
}

export function routePath(r: Route): string {
  switch (r.name) {
    case "tracks":
      return "/top/songs";
    case "artists":
      return "/top/artists";
    case "albums":
      return "/top/albums";
    case "history":
      return "/history";
    case "all":
      return "/all";
    case "sessions":
      return "/sessions";
    case "affinity":
      return "/affinity";
    case "artist":
      return `/artist/${encodeURIComponent(r.id)}`;
    case "album":
      return `/album/${encodeURIComponent(r.id)}`;
    case "track":
      return `/song/${encodeURIComponent(r.id)}`;
    default:
      return "/";
  }
}

const readQuery = () => Object.fromEntries(new URLSearchParams(location.search));

/** Query keys that follow you from page to page: the range, and a public link's token. */
const KEPT = ["range", "from", "to", "token"];

export function useRouter() {
  const [state, setState] = useState(() => ({ route: parseRoute(location.pathname), query: readQuery() }));

  useEffect(() => {
    const onPop = () => setState({ route: parseRoute(location.pathname), query: readQuery() });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Goes to a page; the range carries over unless `query` says otherwise. */
  const navigate = useCallback((route: Route, query?: Record<string, string>) => {
    setState((s) => {
      const q = { ...(s.query.token ? { token: s.query.token } : {}), ...(query ?? pick(s.query, KEPT)) };
      const search = new URLSearchParams(q).toString();
      history.pushState(null, "", routePath(route) + (search ? `?${search}` : ""));
      return { route, query: q };
    });
    document.querySelector(".content")?.scrollTo(0, 0);
  }, []);

  /** Changes the query string of the current page without a new history entry per keystroke. */
  const setQuery = useCallback((patch: Record<string, string | undefined>, replace = false) => {
    setState((s) => {
      const q = { ...s.query };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete q[k];
        else q[k] = v;
      }
      const search = new URLSearchParams(q).toString();
      history[replace ? "replaceState" : "pushState"](null, "", location.pathname + (search ? `?${search}` : ""));
      return { ...s, query: q };
    });
  }, []);

  return { route: state.route, query: state.query, navigate, setQuery };
}

function pick(q: Record<string, string>, keys: string[]) {
  return Object.fromEntries(Object.entries(q).filter(([k]) => keys.includes(k)));
}
