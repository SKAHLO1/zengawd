"use client";

import { useEffect, useState } from "react";
import type { VerdictJson, AttestationResult } from "@zengawd/engine";
import { connectWallet, hasInjectedWallet, onWalletChange, type WalletState } from "@/lib/wallet";
import { VerdictView } from "./verdict-view";

type GuardResponse = { verdict: VerdictJson; parsed: string; attestation: AttestationResult } | { error: string };

const EXAMPLES = [
  { label: "USDC (Ethereum)", value: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", chainId: 1 },
  { label: "Uniswap V2 Router", value: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", chainId: 1 },
  { label: "Origin URL", value: "https://app.uniswap.org", chainId: 1 },
];

export function GuardForm() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [manualFrom, setManualFrom] = useState("");
  const [chainId, setChainId] = useState(1);
  const [input, setInput] = useState("");
  const [lure, setLure] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Exclude<GuardResponse, { error: string }> | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => onWalletChange((s) => setWallet((w) => (w ? { ...w, ...s } : w))), []);
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 200);
    return () => clearInterval(t);
  }, [startedAt]);

  async function connect() {
    setError(null);
    try {
      const w = await connectWallet();
      setWallet(w);
      setChainId(w.chainId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const from = wallet?.address ?? (manualFrom.trim() || null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!from) {
      setError("Connect a wallet (or enter an address) first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setStartedAt(Date.now());
    try {
      const res = await fetch("/api/guard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId, from, input, lureText: lure || undefined }),
      });
      const body = (await res.json()) as GuardResponse;
      if ("error" in body) setError(body.error);
      else setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStartedAt(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 border border-[#1e1e1e] p-4">
        {wallet ? (
          <span className="font-mono text-xs text-[#22c55e]">
            ● {wallet.address} · chain {wallet.chainId}
          </span>
        ) : (
          <>
            <button type="button" onClick={connect} disabled={!hasInjectedWallet()} className="border border-[#2196f3] bg-[#2196f3] px-4 py-2 font-mono text-xs tracking-[0.2em] text-[#050505] disabled:opacity-40">
              CONNECT WALLET
            </button>
            <span className="font-mono text-[10px] text-[#5a5a5a]">or enter the signing address</span>
            <input value={manualFrom} onChange={(e) => setManualFrom(e.target.value)} placeholder="0x… signing address" className="min-w-[24rem] border border-[#2e2e2e] bg-[#0e0e0e] px-3 py-2 font-mono text-xs text-[#f2ede6] outline-none focus:border-[#2196f3]" />
          </>
        )}
        <label className="ml-auto flex items-center gap-2 font-mono text-[10px] tracking-widest text-[#8a8a8a]">
          CHAIN
          <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))} className="border border-[#2e2e2e] bg-[#0e0e0e] px-2 py-1 font-mono text-xs text-[#f2ede6]">
            <option value={1}>Ethereum (1)</option>
            <option value={8453}>Base (8453)</option>
            <option value={84532}>Base Sepolia (84532)</option>
            <option value={42161}>Arbitrum (42161)</option>
            <option value={10}>Optimism (10)</option>
            <option value={137}>Polygon (137)</option>
            <option value={56}>BNB Chain (56)</option>
          </select>
        </label>
      </div>

      <form onSubmit={submit} className="space-y-4 border border-[#1e1e1e] p-4">
        <label className="block">
          <span className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">TOKEN ADDRESS · CONTRACT ADDRESS · DAPP URL · RAW TRANSACTION (HEX OR JSON)</span>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            required
            placeholder='0x… or https://… or {"to":"0x…","data":"0x…","value":"0","chainId":1}'
            className="mt-2 w-full border border-[#2e2e2e] bg-[#0e0e0e] px-3 py-2 font-mono text-xs text-[#f2ede6] outline-none focus:border-[#2196f3]"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex.label} type="button" onClick={() => { setInput(ex.value); setChainId(ex.chainId); }} className="border border-[#2e2e2e] px-2 py-1 font-mono text-[10px] text-[#8a8a8a] hover:border-[#2196f3] hover:text-[#f2ede6]">
              {ex.label}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">LURE MESSAGE (OPTIONAL) · DM, AIRDROP OR SUPPORT TEXT THAT LED YOU HERE</span>
          <textarea value={lure} onChange={(e) => setLure(e.target.value)} rows={3} className="mt-2 w-full border border-[#2e2e2e] bg-[#0e0e0e] px-3 py-2 font-mono text-xs text-[#f2ede6] outline-none focus:border-[#2196f3]" />
        </label>
        <div className="flex items-center gap-4">
          <button type="submit" disabled={busy || !input.trim()} className="border border-[#2196f3] bg-[#2196f3] px-5 py-3 font-mono text-xs tracking-[0.2em] text-[#050505] disabled:opacity-40">
            {busy ? "ROUTING INTENTS…" : "RUN GUARD"}
          </button>
          {busy && <span className="font-mono text-[10px] text-[#8a8a8a]">Stage 1 fans out seven intents in parallel (4 s deadline each). Stage 2 runs only in the ambiguous band (12 s). {(elapsed / 1000).toFixed(1)} s</span>}
        </div>
        {error && <p className="border border-[#ef4444] p-3 font-mono text-xs text-[#ef4444]">{error}</p>}
      </form>

      {result && <VerdictView verdict={result.verdict} attestation={result.attestation} parsed={result.parsed} />}
    </div>
  );
}
