// Custom date pickers (replacing the browser's native ones), the same as Calendar's.
// Their dropdowns are portalled to <body> so a menu's or dialog's overflow can't clip them.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../lib/app";
import { addDays, addMonths, startOfWeek, today as todayIn } from "../lib/dates";
import { useSettings } from "../lib/settings";
import { ChevronLeft, ChevronRight } from "./icons";

const GAP = 4;
const MARGIN = 8;

/** Floating layer under (or above) `anchor`; closes on outside click and Esc. */
export function Dropdown({ anchor, onClose, children, className = "" }: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const below = a.bottom + GAP + el.offsetHeight <= window.innerHeight - MARGIN;
    setPos({
      left: Math.min(Math.max(MARGIN, a.right - el.offsetWidth), window.innerWidth - el.offsetWidth - MARGIN),
      top: below ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - el.offsetHeight),
    });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    const onScroll = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={ref} className={`picker ${className}`} style={pos ?? { left: -9999, top: 0, visibility: "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}

// --- Month grid ---

export interface DayRange {
  from: string;
  /** Inclusive. */
  to: string;
}

interface MonthGridProps {
  /** The highlighted range (or single day). */
  range: DayRange | null;
  /** Range mode: the first click picks the start, the second the end. */
  onPickRange?: (r: DayRange) => void;
  onPickDay?: (day: string) => void;
  /** Days after this can't be picked (the future has no coding time). */
  max?: string;
}

export function MonthGrid({ range, onPickRange, onPickDay, max }: MonthGridProps) {
  const { f } = useSettings();
  const { me } = useApp();
  const today = todayIn(me.timezone);
  const [month, setMonth] = useState(() => (range?.to ?? today).slice(0, 7) + "-01");
  // Follow the range when it changes elsewhere (prev/next, range menu).
  useEffect(() => {
    if (range) setMonth(range.to.slice(0, 7) + "-01");
  }, [range?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const [start, setStart] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const gridStart = startOfWeek(month, me.weekStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  // While picking a range, preview it from the first click to the hovered day.
  const shown: DayRange | null = start ? { from: start < (hover ?? start) ? start : (hover ?? start), to: start < (hover ?? start) ? (hover ?? start) : start } : range;
  const inRange = (d: string) => !!shown && d >= shown.from && d <= shown.to;

  const pick = (d: string) => {
    if (onPickDay) return onPickDay(d);
    if (!onPickRange) return;
    if (!start) {
      setStart(d);
      return;
    }
    const [a, b] = start <= d ? [start, d] : [d, start];
    setStart(null);
    onPickRange({ from: a, to: b });
  };


  return (
    <div className="mini-month" onPointerLeave={() => setHover(null)}>
      <div className="mini-month-head">
        <span className="mini-month-title">{f.monthYearLong(month)}</span>
        <button type="button" className="icon-button small" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft />
        </button>
        <button type="button" className="icon-button small" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight />
        </button>
      </div>
      <div className="mini-month-row">
        {cells.slice(0, 7).map((d) => (
          <span key={d} className="mini-weekday">
            {f.weekdayMini(d)}
          </span>
        ))}
      </div>
      {Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7)).map((week) => (
        <div key={week[0]} className="mini-month-row">
          {week.map((d, i) => {
            const on = inRange(d);
            const future = !!max && d > max;
            const classes = [
              "mini-day",
              d.slice(0, 7) !== month.slice(0, 7) && "outside",
              future && "future",
              on && "in-range",
              on && (i === 0 || !inRange(week[i - 1])) && "range-start",
              on && (i === 6 || !inRange(week[i + 1])) && "range-end",
              d === today && "today",
              d === start && "selected",
            ];
            return (
              <button
                type="button"
                key={d}
                className={classes.filter(Boolean).join(" ")}
                disabled={future}
                onPointerEnter={() => setHover(d)}
                onClick={() => pick(d)}
              >
                <span>{Number(d.slice(8))}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
