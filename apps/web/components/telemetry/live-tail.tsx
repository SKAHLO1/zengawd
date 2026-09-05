"use client";

import { useEffect, useState } from "react";
import type { TailRow } from "@/lib/server/telemetry";

const EXPLORER = "https://sepolia.basescan.org/tx/";

/** Polls /api/telemetry?tail=1 every 4 s. Server state only; nothing is kept in browser storage. */
export function LiveTail({ initial }: { initial: TailRow[] }) {
  const [rows, setRows] = useState(initial);
  const [updated, setUpdated] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/telemetry?tail=1", { cache: "no-store" });
        const body = (await res.json()) as { tail: TailRow[]; generatedAt: string };
        if (alive) {
          setRows(body.tail);
          setUpdated(body.generatedAt);
        }
      } catch {
        /* keep last rows */
      }
    };
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return (
    <div className="border border-[#1e1e1e]">
      <div className="flex items-center justify-between border-b border-[#1e1e1e] px-3 py-2 font-mono text-[10px] tracking-widest text-[#8a8a8a]">
        <span>LAST 100 INTENT REQUESTS · LIVE</span>
        <span>{updated ? `refreshed ${new Date(updated).toLocaleTimeString()}` : "polling every 4 s"}</span>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="sticky top-0 bg-[#050505] text-[10px] tracking-widest text-[#8a8a8a]">
            <tr>
              <th className="p-2">TIME</th>
              <th className="p-2">INTENT</th>
              <th className="p-2">REQ CONF</th>
              <th className="p-2">STATUS</th>
              <th className="p-2">MINER</th>
              <th className="p-2">LATENCY</th>
              <th className="p-2">COST</th>
              <th className="p-2">SETTLEMENT TX</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="p-3 text-[#5a5a5a]">No requests recorded yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-[#141414] ${r.status === "ok" ? "text-[#f2ede6]" : "text-[#5a5a5a]"}`}>
                <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleTimeString()}</td>
                <td className="p-2">{r.intent}</td>
                <td className="p-2">{r.requestedConfidence.toFixed(2)}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{r.minerId ? `${r.minerName ?? ""} #${r.minerId}` : "—"}</td>
                <td className="p-2">{r.latencyMs} ms</td>
                <td className="p-2">{r.costUsd === null ? "—" : `$${r.costUsd.toFixed(3)}`}</td>
                <td className="p-2">{r.settlementTxHash ? <a className="underline" href={`${EXPLORER}${r.settlementTxHash}`} target="_blank" rel="noreferrer">{r.settlementTxHash.slice(0, 12)}…</a> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
