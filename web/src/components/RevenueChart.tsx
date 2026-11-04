"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, moneyShort } from "@/lib/format";

type Point = { date: string; revenue: number; count: number };

const label = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function RevenueChart({ data }: { data: Point[] }) {
  return (
    <div className="h-56 w-full md:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b7bff" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#8b7bff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="date"
            tickFormatter={label}
            tick={{ fill: "#5d6270", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v: number) => moneyShort(v)}
            tick={{ fill: "#5d6270", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.15)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as Point;
              return (
                <div className="rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-xl">
                  <div className="text-muted">{label(p.date)}</div>
                  <div className="mt-0.5 text-sm font-medium tabular">{money(p.revenue)}</div>
                  <div className="text-faint">{p.count} paid</div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#8b7bff"
            strokeWidth={2}
            fill="url(#rev)"
            animationDuration={600}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
