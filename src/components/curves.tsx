// Curves and the other charts of the "All stats" page, hand-drawn in SVG/CSS with the same specs as
// charts.tsx: hairline recessive grid, 2px lines, a light area under them, hover tooltips.

import { useState, type CSSProperties, type ReactNode } from "react";
import { useSettings } from "../lib/settings";
import { useWidth } from "./charts";
import { Cover } from "./music";
import type { Image } from "../lib/api";

/** A round step for about four ticks between 0 and `span`. */
function niceStep(span: number, steps?: number[]) {
  if (steps) return steps.find((s) => span / s <= 4) ?? steps[steps.length - 1];
  const raw = span / 4 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
}

const LEFT = 48;
const BOTTOM = 22;
const TOP = 8;

function tooltipLeft(x: number, width: number, w = 200) {
  return x + 12 + w <= width ? x + 12 : Math.max(0, x - 12 - w);
}

// --- Line ---

export interface Point {
  /** Under the axis. */
  label: string;
  /** In the tooltip. */
  title: string;
  value: number | null;
}

export function LineChart({
  points,
  format,
  tick = format,
  steps,
  fromZero = true,
  color = "var(--seq)",
  height = 200,
  label,
}: {
  points: Point[];
  format: (v: number) => string;
  tick?: (v: number, step: number) => string;
  steps?: number[];
  /** Counts start at 0; averages (years) zoom on their range. */
  fromZero?: boolean;
  color?: string;
  height?: number;
  label: string;
}) {
  const { t } = useSettings();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (!values.length) return <p className="empty-card">{t("noData")}</p>;

  let min = fromZero ? 0 : Math.min(...values);
  let max = Math.max(...values, fromZero ? 1e-9 : -Infinity);
  if (max === min) {
    max += 1;
    if (!fromZero) min -= 1;
  }
  const step = niceStep(max - min, steps);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);

  const plotW = Math.max(0, width - LEFT - 8);
  const plotH = height - BOTTOM - TOP;
  const x = (i: number) => LEFT + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => TOP + plotH - ((v - lo) / (hi - lo)) * plotH;

  // Lines break where there's no value (no plays to average).
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push([x(i), y(p.value)]);
  });
  if (current.length) segments.push(current);
  const line = (s: [number, number][]) => s.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 64))));

  const hovered = hover !== null ? points[hover] : null;
  return (
    <div
      className="chart"
      ref={ref}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const i = Math.round(((e.clientX - r.left - LEFT) / Math.max(1, plotW)) * (points.length - 1));
        setHover(Math.min(points.length - 1, Math.max(0, i)));
      }}
    >
      {width > 0 && (
        <svg height={height} role="img" aria-label={label}>
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === lo ? "axis-line" : "grid-line"} x1={LEFT} x2={width} y1={y(v)} y2={y(v)} />
              <text className="tick" x={LEFT - 8} y={y(v) + 4} textAnchor="end">
                {tick(v, step)}
              </text>
            </g>
          ))}
          {fromZero &&
            segments.map((s, i) =>
              s.length > 1 ? <path key={`a${i}`} d={`${line(s)}L${s[s.length - 1][0]},${y(lo)}L${s[0][0]},${y(lo)}Z`} fill={color} opacity={0.12} /> : null,
            )}
          {segments.map((s, i) =>
            s.length > 1 ? (
              <path key={i} d={line(s)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ) : (
              <circle key={i} cx={s[0][0]} cy={s[0][1]} r={2.5} fill={color} />
            ),
          )}
          {points.map((p, i) =>
            i % every === 0 ? (
              <text key={i} className="tick" x={x(i)} y={height - 6} textAnchor="middle">
                {p.label}
              </text>
            ) : null,
          )}
          {hovered && (
            <g pointerEvents="none">
              <line className="hover-line" x1={x(hover!)} x2={x(hover!)} y1={TOP} y2={TOP + plotH} />
              {hovered.value !== null && <circle cx={x(hover!)} cy={y(hovered.value)} r={4} fill={color} stroke="var(--bg)" strokeWidth={2} />}
            </g>
          )}
        </svg>
      )}
      {hovered && (
        <div className="chart-tooltip" style={{ left: tooltipLeft(x(hover!), width), top: 8, width: 200 }}>
          <div className="chart-tooltip-title">
            <span>{hovered.title}</span>
            <span className="tabular">{hovered.value === null ? "—" : format(hovered.value)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Shares (100% stacked area) ---

export interface ShareBucket {
  label: string;
  title: string;
  total: number;
  values: Record<string, number>;
}

/** Each series' share of every period, stacked to 100% ("Other" on top). */
export function ShareChart({
  buckets,
  series,
  colorOf,
  nameOf,
  height = 220,
  label,
}: {
  buckets: ShareBucket[];
  series: string[];
  colorOf: (id: string) => string;
  nameOf: (id: string) => string;
  height?: number;
  label: string;
}) {
  const { t, f } = useSettings();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!buckets.some((b) => b.total > 0)) return <p className="empty-card">{t("noData")}</p>;

  const plotW = Math.max(0, width - LEFT - 8);
  const plotH = height - BOTTOM - TOP;
  const x = (i: number) => LEFT + (buckets.length === 1 ? plotW / 2 : (i / (buckets.length - 1)) * plotW);
  const y = (share: number) => TOP + plotH - share * plotH;
  const share = (b: ShareBucket, id: string) => (b.total > 0 ? (b.values[id] ?? 0) / b.total : 0);
  // Cumulated shares, bottom up: each series, then everything else.
  const layers = [...series, "\0other"];
  const cum = buckets.map((b) => {
    let acc = 0;
    return layers.map((id) => {
      const v = id === "\0other" ? (b.total > 0 ? Math.max(0, 1 - acc) : 0) : share(b, id);
      const from = acc;
      acc += v;
      return [from, acc] as const;
    });
  });
  const area = (k: number) => {
    const top = buckets.map((_, i) => `${x(i).toFixed(1)},${y(cum[i][k][1]).toFixed(1)}`);
    const bottom = buckets.map((_, i) => `${x(i).toFixed(1)},${y(cum[i][k][0]).toFixed(1)}`).reverse();
    return `M${top.join("L")}L${bottom.join("L")}Z`;
  };
  const every = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotW / 64))));
  const hovered = hover !== null ? buckets[hover] : null;

  return (
    <div
      className="chart"
      ref={ref}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const i = Math.round(((e.clientX - r.left - LEFT) / Math.max(1, plotW)) * (buckets.length - 1));
        setHover(Math.min(buckets.length - 1, Math.max(0, i)));
      }}
    >
      {width > 0 && buckets.length > 1 && (
        <svg height={height} role="img" aria-label={label}>
          {layers.map((id, k) => (
            <path key={id} d={area(k)} fill={id === "\0other" ? "var(--text-faint)" : colorOf(id)} opacity={id === "\0other" ? 0.35 : 0.85} />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line className="grid-line" x1={LEFT} x2={width} y1={y(v)} y2={y(v)} />
              <text className="tick" x={LEFT - 8} y={y(v) + 4} textAnchor="end">
                {f.percent(v)}
              </text>
            </g>
          ))}
          {buckets.map((b, i) =>
            i % every === 0 ? (
              <text key={i} className="tick" x={x(i)} y={height - 6} textAnchor="middle">
                {b.label}
              </text>
            ) : null,
          )}
          {hovered && <line className="hover-line" x1={x(hover!)} x2={x(hover!)} y1={TOP} y2={TOP + plotH} pointerEvents="none" />}
        </svg>
      )}
      {hovered && (
        <div className="chart-tooltip" style={{ left: tooltipLeft(x(hover!), width, 230), top: 8, width: 230 }}>
          <div className="chart-tooltip-title">
            <span>{hovered.title}</span>
          </div>
          {layers
            .map((id) => ({ id, v: id === "\0other" ? Math.max(0, 1 - series.reduce((s, x2) => s + share(hovered, x2), 0)) : share(hovered, id) }))
            .filter((r) => r.v > 0.004)
            .sort((a, b) => (a.id === "\0other" ? 1 : b.id === "\0other" ? -1 : b.v - a.v))
            .map((r) => (
              <div className="tooltip-row" key={r.id}>
                <span className="swatch" style={{ "--c": r.id === "\0other" ? "var(--text-faint)" : colorOf(r.id) } as CSSProperties} />
                <span>{r.id === "\0other" ? t("other") : nameOf(r.id)}</span>
                <span>{f.percent(r.v)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// --- Bars with pictures (best artists) ---

export function PictureBars({
  items,
  onPick,
}: {
  items: { id: string; name: string; images: Image[]; value: number; text: string; color?: string }[];
  onPick?: (id: string) => void;
}) {
  const { t } = useSettings();
  if (!items.length) return <p className="empty-card">{t("noData")}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="picture-bars" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((i) => (
        <button key={i.id} className="picture-bar" title={`${i.name}: ${i.text}`} onClick={() => onPick?.(i.id)}>
          <span className="picture-bar-value">{i.text}</span>
          <span className="picture-bar-track">
            <span className="picture-bar-fill" style={{ height: `${Math.max(2, (i.value / max) * 100)}%`, "--c": i.color ?? "var(--seq)" } as CSSProperties} />
          </span>
          <Cover images={i.images} size={32} round kind="artist" />
          <span className="picture-bar-name">{i.name}</span>
        </button>
      ))}
    </div>
  );
}

// --- Hours, stacked by item ---

export interface HourItems {
  hour: number;
  total: number;
  items: { id: string; name: string; value: number }[];
}

/** For each hour of the day, its top items as a share of the hour (the rest as "Other"). */
export function HourStack({ hours, colorOf, onPick }: { hours: HourItems[]; colorOf: (id: string) => string; onPick?: (id: string) => void }) {
  const { t, f } = useSettings();
  const [hover, setHover] = useState<number | null>(null);
  const byHour = new Map(hours.map((h) => [h.hour, h]));
  if (!hours.length) return <p className="empty-card">{t("noData")}</p>;
  const shown = hover !== null ? byHour.get(hover) : undefined;
  const rows: ReactNode = shown && (
    <div className="hour-stack-detail">
      <div className="chart-tooltip-title">
        <span>{f.hour(shown.hour)}</span>
        <span className="tabular">{t("playsN", { n: f.number(shown.total) })}</span>
      </div>
      {shown.items.slice(0, 5).map((i) => (
        <button className="tooltip-row" key={i.id} onClick={() => onPick?.(i.id)}>
          <span className="swatch" style={{ "--c": colorOf(i.id) } as CSSProperties} />
          <span>{i.name}</span>
          <span>{f.percent(i.value / shown.total)}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="hour-stack-wrap" onPointerLeave={() => setHover(null)}>
      <div className="hour-chart hour-stack">
        {Array.from({ length: 24 }, (_, h) => {
          const data = byHour.get(h);
          return (
            <div key={h} className={`hour-col${hover === h ? " active" : ""}`} onPointerEnter={() => setHover(h)}>
              <span className="hour-stack-col">
                {data?.items.slice(0, 5).map((i) => (
                  <span key={i.id} style={{ height: `${(i.value / data.total) * 100}%`, background: colorOf(i.id) }} />
                ))}
              </span>
              <span className="hour-label">{h % 3 === 0 ? f.hour(h) : ""}</span>
            </div>
          );
        })}
      </div>
      <div className="hour-stack-info">{rows ?? <span className="card-hint">{t("hoverAnHour")}</span>}</div>
    </div>
  );
}
