// The top bar. On phones (the base layout) it has two rows: the title and account, then the page's
// controls (range, ‹ ›…). From tablet width up it's one row, laid out like Calendar's and Notes':
// title on the left; account, range and navigation on the right; then the side panel toggle.

import { useRef, useState, type ReactNode } from "react";
import { useApp } from "../lib/app";
import { today } from "../lib/dates";
import { RANGES, rangeDays, rangeLabel, rangeParams, shiftRange } from "../lib/range";
import { useSettings } from "../lib/settings";
import { Dropdown as Floating, MonthGrid } from "./pickers";
import { Check, ChevronDown, ChevronLeft, ChevronRight, PanelLeft, PanelRight } from "./icons";

interface Props {
  title: ReactNode;
  loading?: boolean;
  /** Pages that show a date range get the range menu, Today and ‹ ›. */
  range?: boolean;
  children?: ReactNode;
}

export function Toolbar({ title, loading, range, children }: Props) {
  const { t } = useSettings();
  const { sidebarVisible, toggleSidebar, panelVisible, togglePanel } = useApp();
  const panelToggle = (className: string) => (
    <button
      className={`icon-button panel-toggle ${className}${panelVisible ? " active" : ""}`}
      title={`${t("togglePanel")} (.)`}
      aria-label={t("togglePanel")}
      aria-pressed={panelVisible}
      onClick={togglePanel}
    >
      <PanelRight />
    </button>
  );
  // Only a range needs the second row on phones; a page's own buttons fit next to the title.
  const controls = !!range;
  return (
    <header className={`toolbar${controls ? " has-controls" : ""}`}>
      <div className="toolbar-row">
        {!sidebarVisible && (
          <button className="icon-button" title={`${t("toggleSidebar")} (Ctrl+B)`} aria-label={t("toggleSidebar")} onClick={toggleSidebar}>
            <PanelLeft />
          </button>
        )}
        <h1 className="toolbar-title">{title}</h1>
        {loading && <span className="spinner" aria-label={t("loading")} />}
        <div className="toolbar-spacer" />
        {!range && children}
        <AccountMenu />
        {panelToggle("phone-only")}
      </div>
      <div className="toolbar-controls">
        {range && children}
        {range && (
          <>
            <RangeMenu />
            <TodayButton />
            <PrevNext />
          </>
        )}
        {panelToggle("wide-only")}
      </div>
    </header>
  );
}

function AccountMenu() {
  const { t } = useSettings();
  const { me, openSettings, signOut, guest } = useApp();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div className="menu-anchor">
      <button ref={anchor} className="avatar" title={me.username} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        {(me.username.trim()[0] ?? "?").toUpperCase()}
      </button>
      {open && (
        <Floating anchor={anchor} onClose={() => setOpen(false)} className="menu-floating">
          <div className="menu" role="menu">
            <div className="menu-label">{guest ? t("publicViewOf", { name: me.username }) : (me.email ?? me.username)}</div>
            <button
              onClick={() => {
                setOpen(false);
                openSettings(guest ? "preferences" : "profile");
              }}
            >
              <span>{t("settings")}</span>
              <span className="keys">
                <kbd>Ctrl</kbd> <kbd>,</kbd>
              </span>
            </button>
            {guest ? (
              <a className="menu-link" href="/">
                {t("signIn")}
              </a>
            ) : (
              <button onClick={signOut}>{t("signOut")}</button>
            )}
          </div>
        </Floating>
      )}
    </div>
  );
}

function RangeMenu() {
  const { t, f } = useSettings();
  const { query, setQuery, me } = useApp();
  const current = rangeParams(query);
  const [open, setOpen] = useState<"menu" | "custom" | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const days = rangeDays(query, me);

  return (
    <div className="menu-anchor range-menu">
      <button ref={anchor} className={`text-button${open ? " active" : ""}`} onClick={() => setOpen(open ? null : "menu")} aria-haspopup="menu">
        {rangeLabel(query, t, f)} <ChevronDown size={14} />
      </button>
      {open === "menu" && (
        <Floating anchor={anchor} onClose={() => setOpen(null)} className="menu-floating">
          <div className="menu" role="menu">
            {RANGES.map((r) => (
              <button
                key={r.id}
                role="menuitemradio"
                aria-checked={current.range === r.id}
                className={current.range === r.id ? "active" : ""}
                onClick={() => {
                  setQuery({ range: r.id, from: undefined, to: undefined });
                  setOpen(null);
                }}
              >
                <span>{t(r.label)}</span>
                {current.range === r.id ? <Check size={14} /> : r.key ? <kbd>{r.key}</kbd> : null}
              </button>
            ))}
            <div className="menu-separator" />
            <button className={current.from ? "active" : ""} onClick={() => setOpen("custom")}>
              <span>{t("customRange")}</span>
              {current.from && <Check size={14} />}
            </button>
          </div>
        </Floating>
      )}
      {open === "custom" && (
        <Floating anchor={anchor} onClose={() => setOpen(null)} className="picker-month">
          <div className="picker-hint">{t("pickRange")}</div>
          <MonthGrid
            range={days.from ? { from: days.from, to: days.to } : null}
            max={today(me.timezone)}
            onPickRange={(r) => {
              setQuery({ range: undefined, from: r.from, to: r.to });
              setOpen(null);
            }}
          />
        </Floating>
      )}
    </div>
  );
}

function TodayButton() {
  const { t } = useSettings();
  const { setQuery } = useApp();
  return (
    <button className="text-button wide-only" title={`${t("today")} (T)`} onClick={() => setQuery({ range: "today", from: undefined, to: undefined })}>
      {t("today")}
    </button>
  );
}

function PrevNext() {
  const { t } = useSettings();
  const { query, setQuery, me } = useApp();
  const prev = shiftRange(query, me, -1);
  const next = shiftRange(query, me, 1);
  return (
    <div className="button-group">
      <button className="icon-button" aria-label={t("previous")} title={`${t("previous")} (K)`} disabled={!prev} onClick={() => prev && setQuery({ range: undefined, ...prev })}>
        <ChevronLeft />
      </button>
      <button className="icon-button" aria-label={t("next")} title={`${t("next")} (J)`} disabled={!next} onClick={() => next && setQuery({ range: undefined, ...next })}>
        <ChevronRight />
      </button>
    </div>
  );
}
