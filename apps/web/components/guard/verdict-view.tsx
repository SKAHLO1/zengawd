"use client";

import { useState } from "react";
import type { AttestationResult, VerdictJson } from "@zengawd/engine";

const COLORS: Record<VerdictJson["verdict"], string> = {
  ALLOW: "#22c55e",
  WARN: "#f59e0b",
  BLOCK: "#ef4444",
  INSUFFICIENT_SIGNAL: "#8a8a8a",
};

const SETTLEMENT_EXPLORER = "https://sepolia.basescan.org/tx/";

export function VerdictView({ verdict: v, attestation, parsed }: { verdict: VerdictJson; attestation: AttestationResult; parsed: string }) {
  const color = COLORS[v.verdict];
  const scorable = v.signals.filter((s) => s.status === "ok" && s.risk !== null && !s.advisory && s.weight > 0);
  const denom = scorable.reduce((a, s) => a + s.weight, 0);
  const contribution = (s: VerdictJson["signals"][number]) => (s.status === "ok" && s.risk !== null && !s.advisory && denom > 0 ? (100 * s.risk * s.weight) / denom : 0);
  const reasons = [...scorable].sort((a, b) => contribution(b) - contribution(a)).filter((s) => (s.risk ?? 0) >= 0.3);
  const ordered = [...v.signals].sort((a, b) => a.stage - b.stage || contribution(b) - contribution(a));

  return (
    <div className="space-y-6">
      <section className="border p-6" style={{ borderColor: color }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.3em]" style={{ color }}>
              VERDICT · {parsed.toUpperCase()} INPUT · CHAIN {v.target.chainId}
            </p>
            <h2 className="font-display mt-1 text-6xl uppercase" style={{ color }}>
              {v.verdict.replace("_", " ")}
            </h2>
            <p className="mt-2 font-mono text-xs text-[#b5b0a8]">
              score {v.score.toFixed(1)} / 100 · {v.escalated ? `escalated (stage 1 scored ${v.stage1Score?.toFixed(1)})` : "resolved at stage 1"} · stage 1 {v.stage1LatencyMs} ms
              {v.stage2LatencyMs !== null ? ` · stage 2 ${v.stage2LatencyMs} ms` : ""} · cost {v.totalCostUsd !== null ? `$${v.totalCostUsd.toFixed(4)}` : "n/a"}
            </p>
          </div>
          <dl className="grid gap-1 font-mono text-[10px] text-[#8a8a8a]">
            <div><dt className="inline text-[#5a5a5a]">target </dt><dd className="inline text-[#f2ede6]">{v.target.to}</dd></div>
            <div><dt className="inline text-[#5a5a5a]">action </dt><dd className="inline text-[#f2ede6]">{v.decoded.functionName ?? v.decoded.kind} {v.decoded.unlimited ? "(unlimited)" : ""} {v.decoded.spender ? `→ spender ${v.decoded.spender}` : ""}</dd></div>
            {v.facts?.symbol && <div><dt className="inline text-[#5a5a5a]">token </dt><dd className="inline text-[#f2ede6]">{v.facts.name} ({v.facts.symbol})</dd></div>}
            <div><dt className="inline text-[#5a5a5a]">verdict hash </dt><dd className="inline text-[#f2ede6]">{v.verdictHash}</dd></div>
            <div>
              <dt className="inline text-[#5a5a5a]">onchain </dt>
              <dd className="inline text-[#f2ede6]">
                {attestation.txHash ? <a className="underline" href={`https://sepolia.basescan.org/tx/${attestation.txHash}`} target="_blank" rel="noreferrer">{attestation.txHash}</a> : attestation.skipped ?? attestation.error ?? "not recorded"}
              </dd>
            </div>
          </dl>
        </div>
        {v.verdict === "INSUFFICIENT_SIGNAL" && (
          <p className="mt-4 border border-[#8a8a8a] p-3 font-mono text-xs text-[#b5b0a8]">
            The Telegraph network returned fewer than four Stage 1 signals, so no risk score can be trusted. This is treated as BLOCK for execution. Each unavailable signal below carries the reason the network gave.
          </p>
        )}
        {(v.verdict === "BLOCK" || v.verdict === "WARN") && reasons.length > 0 && (
          <div className="mt-4">
            <p className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">WHY, IN ORDER OF WEIGHTED CONTRIBUTION</p>
            <ol className="mt-2 space-y-1">
              {reasons.map((s) => (
                <li key={s.id} className="text-sm text-[#f2ede6]">
                  <span className="font-mono text-[10px] text-[#8a8a8a]">+{contribution(s).toFixed(1)} </span>
                  {s.rationale}
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className="overflow-x-auto border border-[#1e1e1e]">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="border-b border-[#1e1e1e] text-[10px] tracking-widest text-[#8a8a8a]">
            <tr>
              <th className="p-3">STAGE</th>
              <th className="p-3">INTENT</th>
              <th className="p-3">RISK</th>
              <th className="p-3">WEIGHT</th>
              <th className="p-3">CONTRIB</th>
              <th className="p-3">RATIONALE</th>
              <th className="p-3">MINER</th>
              <th className="p-3">LATENCY</th>
              <th className="p-3">SETTLEMENT</th>
              <th className="p-3">EVIDENCE</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((s) => (
              <SignalRow key={s.id} s={s} contribution={contribution(s)} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SignalRow({ s, contribution }: { s: VerdictJson["signals"][number]; contribution: number }) {
  const [open, setOpen] = useState(false);
  const muted = s.status !== "ok";
  const cls = muted ? "text-[#5a5a5a]" : "text-[#f2ede6]";
  return (
    <>
      <tr className={`border-b border-[#141414] align-top ${cls}`}>
        <td className="p-3">{s.stage}</td>
        <td className="p-3">
          {s.intent}
          {s.advisory && <span className="ml-2 border border-[#5a5a5a] px-1 text-[9px] text-[#8a8a8a]">ADVISORY · 0 WEIGHT</span>}
          <div className="text-[9px] text-[#5a5a5a]">{s.id}</div>
        </td>
        <td className="p-3">{s.risk === null ? "—" : s.risk.toFixed(2)}</td>
        <td className="p-3">{s.weight.toFixed(2)}</td>
        <td className="p-3">{s.status === "ok" && !s.advisory ? `+${contribution.toFixed(1)}` : "—"}</td>
        <td className="max-w-md p-3 font-sans text-xs">
          {s.status === "ok" ? s.rationale : <span className="italic">{s.status.toUpperCase()}: {s.reason}</span>}
          {s.confidence !== null && <span className="ml-1 text-[9px] text-[#8a8a8a]">conf {s.confidence.toFixed(2)}</span>}
        </td>
        <td className="p-3">{s.minerId ? `${s.minerName ?? ""} #${s.minerId}` : "—"}</td>
        <td className="p-3">{s.latencyMs ? `${s.latencyMs} ms` : "—"}</td>
        <td className="p-3">
          {s.txHash ? (
            <a className="underline" href={`${SETTLEMENT_EXPLORER}${s.txHash}`} target="_blank" rel="noreferrer">
              {s.txHash.slice(0, 10)}…
            </a>
          ) : (
            "—"
          )}
        </td>
        <td className="p-3">
          {s.evidence !== null && s.evidence !== undefined ? (
            <button type="button" onClick={() => setOpen(!open)} className="underline">
              {open ? "hide" : "show"}
            </button>
          ) : (
            "—"
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[#141414]">
          <td colSpan={10} className="bg-[#0a0a0a] p-3">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[10px] text-[#b5b0a8]">{JSON.stringify(s.evidence, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}
