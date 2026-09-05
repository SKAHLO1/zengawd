import { LiveTail } from "@/components/telemetry/live-tail";
import { RoutingChart } from "@/components/telemetry/routing-chart";
import { readTelemetry } from "@/lib/server/telemetry";

export const dynamic = "force-dynamic";

export default async function TelemetryPage() {
  const t = await readTelemetry();
  const stat = (label: string, value: string) => (
    <div className="border border-[#1e1e1e] p-4">
      <p className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">{label}</p>
      <p className="font-display mt-1 text-3xl">{value}</p>
    </div>
  );
  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[10px] tracking-[0.3em] text-[#2196f3]">TELEMETRY · PUBLIC</p>
        <h1 className="font-display text-4xl uppercase">Routing observed, not assumed</h1>
        <p className="mt-2 max-w-3xl text-sm text-[#b5b0a8]">
          Every row comes from the <code>intent_requests</code> table, written once per Telegraph call whether it succeeded or not. Miner IDs appear here and nowhere else in the application.
        </p>
      </div>

      <section className="grid gap-3 md:grid-cols-5">
        {stat("TOTAL REQUESTS", String(t.totals.requests))}
        {stat("SUCCESSFUL", String(t.totals.ok))}
        {stat("DISTINCT MINERS", String(t.totals.distinctMiners))}
        {stat("SETTLED ONCHAIN", String(t.totals.settled))}
        {stat("TOTAL COST", `$${t.totals.totalCostUsd.toFixed(3)}`)}
      </section>

      <section>
        <h2 className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">REQUESTS BY INTENT · MINERS · LATENCY · AVAILABILITY</h2>
        <div className="mt-2 overflow-x-auto border border-[#1e1e1e]">
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="border-b border-[#1e1e1e] text-[10px] tracking-widest text-[#8a8a8a]">
              <tr>
                <th className="p-3">INTENT</th>
                <th className="p-3">REQUESTS</th>
                <th className="p-3">AVAILABILITY</th>
                <th className="p-3">P50</th>
                <th className="p-3">P95</th>
                <th className="p-3">MINERS (REQUESTS · P50 · MEAN COST)</th>
              </tr>
            </thead>
            <tbody>
              {t.intents.length === 0 && <tr><td colSpan={6} className="p-3 text-[#5a5a5a]">No requests yet.</td></tr>}
              {t.intents.map((i) => (
                <tr key={i.intent} className="border-b border-[#141414] align-top text-[#f2ede6]">
                  <td className="p-3">{i.intent}</td>
                  <td className="p-3">{i.total}</td>
                  <td className="p-3">{Math.round(i.availability * 100)}%</td>
                  <td className="p-3">{i.p50 ?? "—"} ms</td>
                  <td className="p-3">{i.p95 ?? "—"} ms</td>
                  <td className="p-3">
                    {i.miners.length === 0 ? <span className="text-[#5a5a5a]">none served</span> : i.miners.map((m) => (
                      <span key={m.minerId} className="mr-2 mb-1 inline-block border border-[#2e2e2e] px-2 py-0.5 text-[10px]">
                        {m.minerName ?? "miner"} #{m.minerId} · {m.count} · {m.p50 ?? "—"} ms · {m.avgCostUsd === null ? "—" : `$${m.avgCostUsd.toFixed(3)}`}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">CONFIDENCE THRESHOLD VS ROUTING · CALIBRATION RUNS</h2>
        <p className="mb-2 mt-1 max-w-3xl text-xs text-[#b5b0a8]">
          The calibration job sends the same benchmark payload for each intent at requested confidence 0.5, 0.6, 0.7, 0.8 and 0.9 and records which miner served it, the latency, the cost and whether the answer cleared the threshold. The live API carries no server-side confidence parameter (see DECISIONS.md), so what changes with the threshold is client-side acceptance and, if the network honours the hint, routing.
        </p>
        <RoutingChart points={t.calibration} />
      </section>

      <LiveTail initial={t.tail} />
    </div>
  );
}
