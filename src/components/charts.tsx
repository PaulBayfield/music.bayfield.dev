// Charts, hand-drawn in SVG/CSS.
//
// Specs: bars ≤ 24px thick with a 4px rounded data end, 2px surface gaps between stacked segments,
// hairline recessive grid, a legend for 2+ series, hover tooltips, and a table view for every chart.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
/** A named amount of time, in seconds. */
export interface Item {
  name: string;
  seconds: number;
}
import { useSettings } from "../lib/settings";

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

// --- Time chart (stacked by artist) ---

export interface Bucket {
  /** First day (inclusive). */
  from: string;
  /** Last day (inclusive). */
  to: string;
  total: number;
  series: Record<string, number>;
}

export type Granularity = "day" | "week" | "month";

/** Days → days, weeks or months depending on how many there are. */
export function bucketize(days: { date: string; total: number; series: Record<string, number> }[], weekStart: number): { granularity: Granularity; buckets: Bucket[] } {
  const granularity: Granularity = days.length <= 62 ? "day" : days.length <= 400 ? "week" : "month";
  const keyOf = (day: string) =>
    granularity === "day" ? day : granularity === "week" ? addDays(day, -((weekdayOf(day) - weekStart + 7) % 7)) : day.slice(0, 7);
  const map = new Map<string, Bucket>();
  for (const d of days) {
    const key = keyOf(d.date);
    const b = map.get(key) ?? { from: d.date, to: d.date, total: 0, series: {} };
    b.to = d.date;
    b.total += d.total;
    for (const [p, s] of Object.entries(d.series)) b.series[p] = (b.series[p] ?? 0) + s;
    map.set(key, b);
  }
  return { granularity, buckets: [...map.values()] };
}

const NICE_STEPS = [300, 900, 1800, 3600, 7200, 4 * 3600, 6 * 3600, 8 * 3600, 12 * 3600, 24 * 3600, 48 * 3600, 100 * 3600, 200 * 3600, 500 * 3600];

export function TimeChart({
  buckets,
  granularity,
  series,
  colorOf,
  onPick,
  nameOf = (n) => n,
  height = 220,
}: {
  buckets: Bucket[];
  granularity: Granularity;
  /** Stacking order, bottom first; anything else is grouped as "other". */
  series: string[];
  colorOf: (name: string) => string;
  onPick?: (b: Bucket) => void;
  /** The label of a series. */
  nameOf?: (name: string) => string;
  height?: number;
}) {
  const { f, t } = useSettings();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(...buckets.map((b) => b.total), 1);
  const step = NICE_STEPS.find((s) => max / s <= 4) ?? Math.ceil(max / 4 / 3600) * 3600;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const left = 44;
  const bottom = 22;
  const plotW = Math.max(0, width - left);
  const plotH = height - bottom - 8;
  const slot = buckets.length ? plotW / buckets.length : 0;
  const barW = Math.max(2, Math.min(24, slot * 0.66));
  const y = (s: number) => 8 + plotH - (s / top) * plotH;

  const label = (b: Bucket) =>
    granularity === "day" ? f.shortDate(b.from) : granularity === "week" ? `${f.shortDate(b.from)} – ${f.shortDate(b.to)}` : f.monthYear(b.from);
  // Enough room for each x label: show every n-th.
  const every = Math.max(1, Math.ceil(70 / Math.max(slot, 1)));
  const xLabel = (b: Bucket) => (granularity === "day" ? (buckets.length > 14 ? f.shortDate(b.from) : f.weekdayShort(b.from)) : granularity === "week" ? f.shortDate(b.from) : f.monthShort(b.from));

  const stackOf = (b: Bucket) => {
    const known = series.map((name) => ({ name, value: b.series[name] ?? 0 }));
    const other = b.total - known.reduce((s, k) => s + k.value, 0);
    return [...known, { name: "", value: Math.max(0, other) }].filter((s) => s.value > 0.5);
  };

  const hovered = hover !== null ? buckets[hover] : null;
  // Beside the hovered bar (right of it, or left near the edge) so it never covers it.
  const barCenter = hover !== null ? left + slot * hover + slot / 2 : 0;
  const tooltipLeft = barCenter + barW / 2 + 12 + 220 <= width ? barCenter + barW / 2 + 12 : Math.max(0, barCenter - barW / 2 - 12 - 220);

  return (
    <div className="chart" ref={ref} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg height={height} role="img" aria-label={t("timePerDay")}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line className={tick === 0 ? "axis-line" : "grid-line"} x1={left} x2={width} y1={y(tick)} y2={y(tick)} />
              <text className="tick" x={left - 8} y={y(tick) + 4} textAnchor="end">
                {f.axisDuration(tick, step)}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x = left + slot * i + (slot - barW) / 2;
            let acc = 0;
            const stack = stackOf(b);
            return (
              <g key={b.from}>
                <rect
                  className={`bar-hit${hover === i ? " hover" : ""}`}
                  x={left + slot * i}
                  y={8}
                  width={slot}
                  height={plotH}
                  rx={4}
                  onPointerEnter={() => setHover(i)}
                  onClick={() => onPick?.(b)}
                />
                {stack.map((s, j) => {
                  const y0 = y(acc);
                  acc += s.value;
                  const y1 = y(acc);
                  const isTop = j === stack.length - 1;
                  // 2px surface gap between segments: shave it off every segment but the top one.
                  const h = Math.max(0, y0 - y1 - (isTop ? 0 : 2));
                  if (h <= 0) return null;
                  const color = s.name ? colorOf(s.name) : "var(--text-faint)";
                  return isTop ? (
                    <path key={s.name || "other"} d={roundedTop(x, y1, barW, h, Math.min(4, h, barW / 2))} fill={color} pointerEvents="none" />
                  ) : (
                    <rect key={s.name || "other"} x={x} y={y1 + 2} width={barW} height={h} fill={color} pointerEvents="none" />
                  );
                })}
                {i % every === 0 && (
                  <text className="tick" x={left + slot * i + slot / 2} y={height - 6} textAnchor="middle">
                    {xLabel(b)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hovered && (
        <div className="chart-tooltip" style={{ left: tooltipLeft, top: 8, width: 220 }}>
          <div className="chart-tooltip-title">
            <span>{label(hovered)}</span>
            <span className="tabular">{f.duration(hovered.total)}</span>
          </div>
          {stackOf(hovered)
            .slice()
            .reverse()
            .map((s) => (
              <div className="tooltip-row" key={s.name || "other"}>
                <span className="swatch" style={{ "--c": s.name ? colorOf(s.name) : "var(--text-faint)" } as CSSProperties} />
                <span>{s.name ? nameOf(s.name) : t("other")}</span>
                <span>{f.duration(s.value)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** A bar with rounded top corners and a square base. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** The time chart's table view. */
export function TimeTable({ buckets, granularity }: { buckets: Bucket[]; granularity: Granularity }) {
  const { f, t } = useSettings();
  const label = (b: Bucket) =>
    granularity === "day" ? f.longDate(b.from) : granularity === "week" ? `${f.mediumDate(b.from)} – ${f.mediumDate(b.to)}` : f.monthYear(b.from);
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("period")}</th>
            <th className="num">{t("total")}</th>
          </tr>
        </thead>
        <tbody>
          {[...buckets].reverse().map((b) => (
            <tr key={b.from}>
              <td>{label(b)}</td>
              <td className="num">{f.duration(b.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Legend({
  items,
  colorOf,
  onPick,
  nameOf = (n) => n,
}: {
  items: { name: string; seconds: number }[];
  colorOf: (name: string) => string;
  onPick?: (name: string) => void;
  nameOf?: (name: string) => string;
}) {
  const { f, t } = useSettings();
  return (
    <div className="legend">
      {items.map((i) => {
        const inner = (
          <>
            <span className="swatch" style={{ "--c": i.name === "\0other" ? "var(--text-faint)" : colorOf(i.name) } as CSSProperties} />
            <span>{i.name === "\0other" ? t("other") : nameOf(i.name) || t("unknown")}</span>
            <b>{f.duration(i.seconds)}</b>
          </>
        );
        return onPick && i.name !== "\0other" ? (
          <button key={i.name} className="legend-item" onClick={() => onPick(i.name)} title={nameOf(i.name)}>
            {inner}
          </button>
        ) : (
          <span key={i.name} className="legend-item">
            {inner}
          </span>
        );
      })}
    </div>
  );
}

// --- Breakdown list ---

export function Breakdown({
  items,
  colorOf,
  onPick,
  limit = 8,
  format,
}: {
  items: Item[];
  colorOf?: (name: string) => string;
  onPick?: (name: string) => void;
  limit?: number;
  format?: (name: string) => ReactNode;
}) {
  const { f, t } = useSettings();
  const [all, setAll] = useState(false);
  const total = items.reduce((s, i) => s + i.seconds, 0);
  const max = items[0]?.seconds ?? 1;
  const shown = all ? items : items.slice(0, limit);
  if (items.length === 0) return <p className="empty-card">{t("noData")}</p>;
  return (
    <div className="breakdown">
      {shown.map((i) => {
        const name = i.name || t("unknown");
        const body = (
          <>
            <span className="breakdown-name">
              {colorOf && <span className="project-dot" style={{ "--c": colorOf(i.name) } as CSSProperties} />}
              <span title={name}>{format ? format(i.name) : name}</span>
            </span>
            <span className="breakdown-value">
              <b>{f.duration(i.seconds)}</b>
              {f.percent(total ? i.seconds / total : 0)}
            </span>
            <span className="breakdown-track">
              <span className="breakdown-fill" style={{ width: `${(i.seconds / max) * 100}%`, display: "block", "--c": colorOf ? colorOf(i.name) : "var(--text-muted)" } as CSSProperties} />
            </span>
          </>
        );
        return onPick ? (
          <button key={i.name} className="breakdown-row" onClick={() => onPick(i.name)}>
            {body}
          </button>
        ) : (
          <div key={i.name} className="breakdown-row">
            {body}
          </div>
        );
      })}
      {items.length > limit && (
        <button className="link-button breakdown-more" onClick={() => setAll((a) => !a)}>
          {all ? t("showLess") : t("showAll", { n: items.length })}
        </button>
      )}
    </div>
  );
}

// --- Calendar heatmap ---

/** 0–4 for a value, scaled to the 95th percentile so one huge day doesn't wash out the rest. */
function levels(values: number[]) {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  const p95 = nonZero[Math.floor(nonZero.length * 0.95)] ?? 1;
  return (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / p95) * 4)));
}

export function Heatmap({ days, weekStart, onPick }: { days: { date: string; seconds: number }[]; weekStart: number; onPick?: (day: string) => void }) {
  const { f, t } = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const level = useMemo(() => levels(days.map((d) => d.seconds)), [days]);
  // Scroll to the most recent weeks on narrow screens.
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [days]);
  if (!days.length) return null;

  const offset = (weekdayOf(days[0].date) - weekStart + 7) % 7;
  const cells: ReactNode[] = [];
  let month = "";
  days.forEach((d, i) => {
    const index = i + offset;
    const col = Math.floor(index / 7) + 1;
    const row = (index % 7) + 2;
    const m = d.date.slice(0, 7);
    if (m !== month && row <= 3) {
      month = m;
      cells.push(
        <span key={`m${m}`} className="heatmap-month" style={{ gridColumn: `${col} / span 4` }}>
          {f.monthShort(d.date)}
        </span>,
      );
    } else if (m !== month) {
      month = m;
    }
    const label = `${f.longDate(d.date)}: ${d.seconds > 0 ? f.duration(d.seconds) : "—"}`;
    cells.push(
      <span
        key={d.date}
        className={`heat-cell heat-${level(d.seconds)}`}
        style={{ gridColumn: col, gridRow: row, cursor: onPick ? "pointer" : undefined }}
        title={label}
        aria-label={label}
        onClick={() => onPick?.(d.date)}
      />,
    );
  });

  return (
    <>
      <div className="heatmap" ref={ref}>
        <div className="heatmap-grid">{cells}</div>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>{t("less")}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat-cell heat-${l}`} />
        ))}
        <span>{t("more")}</span>
      </div>
    </>
  );
}

// --- Weekly rhythm (weekday × hour) ---

export function RhythmGrid({ grid, weekStart }: { grid: number[][]; weekStart: number }) {
  const { f } = useSettings();
  const level = useMemo(() => levels(grid.flat()), [grid]);
  const order = Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7);
  // 2001-01-07 was a Sunday: weekday names without depending on the current date.
  const dayName = (dow: number) => f.weekdayShort(`2001-01-${String(7 + dow).padStart(2, "0")}`);
  return (
    <div className="rhythm-grid">
      <span />
      {Array.from({ length: 24 }, (_, h) => (
        <span key={h} className="rhythm-hour">
          {h % 6 === 0 ? f.hour(h) : ""}
        </span>
      ))}
      {order.map((dow) => (
        <RhythmRow key={dow} label={dayName(dow)} values={grid[dow]} level={level} format={(h, v) => `${dayName(dow)} ${f.hour(h)}: ${f.duration(v)}`} />
      ))}
    </div>
  );
}

function RhythmRow({ label, values, level, format }: { label: string; values: number[]; level: (v: number) => number; format: (h: number, v: number) => string }) {
  return (
    <>
      <span>{label}</span>
      {values.map((v, h) => (
        <span key={h} className={`heat-cell heat-${level(v)}`} title={format(h, v)} />
      ))}
    </>
  );
}

// --- Hours of the day ---

/** 24 bars: listening by hour of the day (seconds, unless `format` says otherwise). */
export function HourChart({ values, format }: { values: number[]; format?: (v: number) => string }) {
  const { f } = useSettings();
  const fmt = format ?? ((v: number) => f.duration(v));
  const max = Math.max(...values, 1);
  return (
    <div className="hour-chart">
      {values.map((v, h) => (
        <div key={h} className="hour-col" title={`${f.hour(h)}: ${fmt(v)}`}>
          <span className="hour-bar" style={{ height: `${Math.max(v > 0 ? 3 : 0, (v / max) * 100)}%` }} />
          <span className="hour-label">{h % 3 === 0 ? f.hour(h) : ""}</span>
        </div>
      ))}
    </div>
  );
}
