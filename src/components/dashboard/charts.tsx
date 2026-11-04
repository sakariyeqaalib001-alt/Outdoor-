"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartAxis, chartGrid, palette } from "@/lib/brand";

/**
 * Dashboard charts (Phase 10) on Recharts, in brand-kit colours only. Every chart has a text alternative
 * (aria-label + the figures shown in cards or tables next to it), so colour is never the only signal.
 */

export type Series = { key: string; label: string; color: string };
export type Point = { label: string } & Record<string, number | string>;
type ValueKind = "units" | "usd";

const units = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const format = (kind: ValueKind) => (v: number) => (kind === "usd" ? usd.format(v) : units.format(v));

const tooltipStyle = {
  contentStyle: { borderRadius: 10, border: `1px solid ${palette.gray200}`, fontSize: 12, boxShadow: "0 4px 12px rgb(41 48 51 / 0.08)" },
  labelStyle: { color: palette.gray900, fontWeight: 600 },
};
const axis = { stroke: chartAxis, fontSize: 12, tickLine: false, axisLine: false } as const;

/** Line chart over months (one or more series). */
export function TrendChart({ data, series, kind = "units", height = 260, label }: { data: Point[]; series: Series[]; kind?: ValueKind; height?: number; label: string }) {
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chartGrid} vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={kind === "usd" ? 64 : 40} allowDecimals={false} tickFormatter={format(kind)} />
          <Tooltip {...tooltipStyle} formatter={(v) => format(kind)(Number(v))} />
          {series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.5} dot={{ r: 3, fill: s.color }} activeDot={{ r: 5 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bars over categories or months; stacked when asked. */
export function BarsChart({
  data,
  series,
  kind = "units",
  stacked = false,
  height = 260,
  label,
}: {
  data: Point[];
  series: Series[];
  kind?: ValueKind;
  stacked?: boolean;
  height?: number;
  label: string;
}) {
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chartGrid} vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={kind === "usd" ? 64 : 40} allowDecimals={false} tickFormatter={format(kind)} />
          <Tooltip {...tooltipStyle} cursor={{ fill: palette.gray100 }} formatter={(v) => format(kind)(Number(v))} />
          {series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={stacked ? "a" : undefined}
              radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
              maxBarSize={48}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One bar per category, each in its own colour (e.g. units by product). */
export function CategoryBars({ data, kind = "units", height = 240, label }: { data: { label: string; value: number; color: string }[]; kind?: ValueKind; height?: number; label: string }) {
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chartGrid} vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={kind === "usd" ? 64 : 40} allowDecimals={false} tickFormatter={format(kind)} />
          <Tooltip {...tooltipStyle} cursor={{ fill: palette.gray100 }} formatter={(v) => format(kind)(Number(v))} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut with the total in the middle and a legend with shares. */
export function DonutChart({
  data,
  center,
  centerLabel,
  label,
}: {
  data: { label: string; value: number; color: string }[];
  center: string;
  centerLabel: string;
  label: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const shown = total ? data : [{ label: "", value: 1, color: palette.gray100 }];
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row" role="img" aria-label={label}>
      <div className="relative size-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" paddingAngle={total ? 1.5 : 0} stroke="none" isAnimationActive={false}>
              {shown.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            {total ? <Tooltip {...tooltipStyle} formatter={(v) => units.format(Number(v))} /> : null}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="text-2xl font-semibold text-brand-link tabular-nums">{center}</span>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{centerLabel}</span>
        </div>
      </div>
      <ul className="grid w-full gap-2 text-sm">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden="true" />
            <span className="flex-1 font-semibold">{d.label}</span>
            <span className="tabular-nums text-muted-foreground">{units.format(d.value)}</span>
            <span className="w-11 text-right font-semibold text-brand-link tabular-nums">{total ? `${Math.round((d.value / total) * 100)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
