"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import type { CalibrationPoint } from "@/lib/server/telemetry";

const LEVELS = [0.5, 0.6, 0.7, 0.8, 0.9];
const INK = "#f2ede6";
const MUTED = "#8a8a8a";
const GRID = "#1e1e1e";
const SERIES = "#2196f3";

/**
 * Confidence threshold vs routing: one small multiple per intent. The line is observed p-average
 * latency at each requested confidence; the chips beneath are the distinct miners that served that level,
 * with availability and mean cost. Single series per panel, so identity needs no legend.
 */
export function RoutingChart({ points }: { points: CalibrationPoint[] }) {
  const byIntent = new Map<string, CalibrationPoint[]>();
  for (const p of points) byIntent.set(p.intent, [...(byIntent.get(p.intent) ?? []), p]);
  if (byIntent.size === 0) {
    return (
      <p className="border border-[#1e1e1e] p-4 font-mono text-xs text-[#8a8a8a]">
        No calibration runs recorded yet. Run <code>pnpm calibrate</code> (issues the same benchmark payload at confidence 0.5, 0.6, 0.7, 0.8 and 0.9 for every intent) to populate this chart from live routing data.
      </p>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[...byIntent.entries()].map(([intent, pts]) => {
        const data = LEVELS.map((c) => {
          const p = pts.find((x) => Math.abs(x.confidence - c) < 1e-9);
          return { confidence: c, latency: p?.avgLatencyMs ?? null, availability: p?.availability ?? null, cost: p?.avgCostUsd ?? null, miners: p?.miners ?? [], runs: p?.runs ?? 0 };
        });
        return (
          <div key={intent} className="border border-[#1e1e1e] p-4">
            <p className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">{intent}</p>
            <p className="font-mono text-[10px] text-[#5a5a5a]">mean latency (ms) by requested confidence</p>
            <div className="mt-2 h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="confidence" tick={{ fill: MUTED, fontSize: 10, fontFamily: "monospace" }} axisLine={{ stroke: GRID }} tickLine={false} />
                  <YAxis tick={{ fill: MUTED, fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    cursor={{ stroke: MUTED, strokeWidth: 1 }}
                    contentStyle={{ background: "#0e0e0e", border: `1px solid ${GRID}`, fontFamily: "monospace", fontSize: 11, color: INK }}
                    formatter={(v) => [`${Array.isArray(v) ? v.join(",") : (v ?? "n/a")} ms`, "latency"]}
                    labelFormatter={(l) => `confidence ${l}`}
                  />
                  <Line type="monotone" dataKey="latency" stroke={SERIES} strokeWidth={2} dot={{ r: 4, fill: SERIES, stroke: "#050505", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <table className="mt-2 w-full font-mono text-[10px]">
              <thead className="text-[#5a5a5a]">
                <tr>
                  <th className="text-left font-normal">conf</th>
                  <th className="text-left font-normal">avail</th>
                  <th className="text-left font-normal">cost</th>
                  <th className="text-left font-normal">miners served</th>
                </tr>
              </thead>
              <tbody className="text-[#b5b0a8]">
                {data.map((d) => (
                  <tr key={d.confidence} className="border-t border-[#141414] align-top">
                    <td className="py-1">{d.confidence.toFixed(1)}</td>
                    <td className="py-1">{d.availability === null ? "—" : `${Math.round(d.availability * 100)}% (${d.runs})`}</td>
                    <td className="py-1">{d.cost === null ? "—" : `$${d.cost.toFixed(3)}`}</td>
                    <td className="py-1">
                      {d.miners.length === 0 ? "—" : d.miners.map((m) => (
                        <span key={m} className="mr-1 inline-block border border-[#2e2e2e] px-1 text-[#f2ede6]">#{m}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
