"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  formatRupiah,
  formatRupiahCompact,
  formatTrendDate,
  formatTrendTick,
} from "./format";

// =========================================================
// Revenue trend chart island — Recharts v3 via the shadcn ChartContainer.
// Renders one revenue series over the 30 WIB calendar-day trend window.
// An accessible fallback table (analytics-trend-table) accompanies the SVG
// so the data is readable by screen readers and renders without JS graphics.
// =========================================================

export interface RevenueTrendChartProps {
  trend: { date: string; revenue: number; orders: number }[];
}

const chartConfig = {
  revenue: {
    label: "Pendapatan",
    // Tailwind 3 tokens keep raw HSL components, so wrap them explicitly.
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export default function RevenueTrendChart({ trend }: RevenueTrendChartProps) {
  return (
    <div>
      <ChartContainer config={chartConfig} className="h-72 w-full">
        <AreaChart
          accessibilityLayer
          data={trend}
          margin={{ left: 4, right: 12, top: 8 }}
        >
          <defs>
            <linearGradient id="analyticsRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-revenue)"
                stopOpacity={0.35}
              />
              <stop
                offset="95%"
                stopColor="var(--color-revenue)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={28}
            tickFormatter={(value: string) => formatTrendTick(value)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(value: number) => formatRupiahCompact(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  formatTrendDate(
                    (payload?.[0]?.payload as { date: string } | undefined)
                      ?.date ?? ""
                  )
                }
                formatter={(value) => (
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatRupiah(Number(value))}
                  </span>
                )}
              />
            }
          />
          <Area
            dataKey="revenue"
            type="monotone"
            stroke="var(--color-revenue)"
            strokeWidth={2}
            fill="url(#analyticsRevenueFill)"
          />
        </AreaChart>
      </ChartContainer>

      {/* Accessible fallback: the full 30-day series as a screen-reader
          table (visually hidden — the chart above is the visual form). */}
      <table data-testid="analytics-trend-table" className="sr-only">
        <caption>Tren pendapatan 30 hari terakhir (kalender WIB)</caption>
        <thead>
          <tr>
            <th scope="col">Tanggal</th>
            <th scope="col">Pendapatan</th>
            <th scope="col">Pesanan</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((point) => (
            <tr key={point.date}>
              <th scope="row">{formatTrendDate(point.date)}</th>
              <td>{formatRupiah(point.revenue)}</td>
              <td>{point.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}