"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { connectWallet, hasInjectedWallet, onWalletChange, sendFromWallet, type WalletState } from "@/lib/wallet";

type Row = {
  token: Address;
  spender: Address;
  standard: "ERC20" | "ERC721";
  allowance: string;
  lastTxHash: Hex;
  lastVerdict: string | null;
  lastScore: number | null;
  lastCheckedAt: string | null;
  revocationRecommendedAt: string | null;
  revocationTxHash: string | null;
  revokeCalldata: Hex;
};
type Resp = { owner: Address; chainId: number; registered: boolean; autoRevokeEnabled: boolean; safeAddress: string | null; approvals: Row[] } | { error: string };

const COLOR: Record<string, string> = { ALLOW: "#22c55e", WARN: "#f59e0b", BLOCK: "#ef4444", INSUFFICIENT_SIGNAL: "#8a8a8a" };

export function ApprovalsView() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [manual, setManual] = useState("");
  const [chainId, setChainId] = useState(1);
  const [data, setData] = useState<Exclude<Resp, { error: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [safe, setSafe] = useState("");
  const [txs, setTxs] = useState<Record<string, string>>({});

  useEffect(() => onWalletChange((s) => setWallet((w) => (w ? { ...w, ...s } : w))), []);
  const address = wallet?.address ?? (manual.trim() as Address | "");

  async function load() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals?address=${address}&chainId=${chainId}`, { cache: "no-store" });
      const body = (await res.json()) as Resp;
      if ("error" in body) setError(body.error);
      else setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function post(action: "register" | "optInAutoRevoke" | "optOutAutoRevoke") {
    if (!address) return;
    const res = await fetch("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, chainId, action, safeAddress: safe || undefined }) });
    const body = (await res.json()) as { error?: string };
    if (body.error) setError(body.error);
    await load();
  }

  async function revoke(r: Row) {
    if (!wallet) {
      setError("Connect the wallet that owns the approval to revoke it.");
      return;
    }
    try {
      const hash = await sendFromWallet(wallet.address, r.token, r.revokeCalldata);
      setTxs((t) => ({ ...t, [`${r.token}:${r.spender}`]: hash }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 border border-[#1e1e1e] p-4">
        {wallet ? (
          <span className="font-mono text-xs text-[#22c55e]">● {wallet.address}</span>
        ) : (
          <>
            <button type="button" onClick={() => connectWallet().then((w) => { setWallet(w); setChainId(w.chainId); }).catch((e: Error) => setError(e.message))} disabled={!hasInjectedWallet()} className="border border-[#2196f3] bg-[#2196f3] px-4 py-2 font-mono text-xs tracking-[0.2em] text-[#050505] disabled:opacity-40">
              CONNECT WALLET
            </button>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="or paste an address to inspect (read-only)" className="min-w-[24rem] border border-[#2e2e2e] bg-[#0e0e0e] px-3 py-2 font-mono text-xs outline-none focus:border-[#2196f3]" />
          </>
        )}
        <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))} className="border border-[#2e2e2e] bg-[#0e0e0e] px-2 py-1 font-mono text-xs">
          <option value={1}>Ethereum</option>
          <option value={8453}>Base</option>
          <option value={84532}>Base Sepolia</option>
          <option value={42161}>Arbitrum</option>
          <option value={10}>Optimism</option>
          <option value={137}>Polygon</option>
        </select>
        <button type="button" onClick={load} disabled={!address || busy} className="border border-[#2e2e2e] px-4 py-2 font-mono text-xs tracking-[0.2em] hover:border-[#2196f3] disabled:opacity-40">
          {busy ? "SCANNING LOGS…" : "SCAN APPROVALS"}
        </button>
      </div>
      {error && <p className="border border-[#ef4444] p-3 font-mono text-xs text-[#ef4444]">{error}</p>}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3 border border-[#1e1e1e] p-4 font-mono text-xs">
            <span className="text-[#8a8a8a]">WATCHER:</span>
            {data.registered ? <span className="text-[#22c55e]">registered · re-scored every interval</span> : <button type="button" onClick={() => post("register")} className="border border-[#2196f3] px-3 py-1 text-[#2196f3]">REGISTER THIS ADDRESS FOR MONITORING</button>}
            <span className="ml-4 text-[#8a8a8a]">AUTO-REVOKE:</span>
            {data.autoRevokeEnabled ? (
              <>
                <span className="text-[#f59e0b]">ON via Safe {data.safeAddress}</span>
                <button type="button" onClick={() => post("optOutAutoRevoke")} className="border border-[#2e2e2e] px-3 py-1">TURN OFF</button>
              </>
            ) : (
              <>
                <span className="text-[#8a8a8a]">off (default)</span>
                {data.registered && (
                  <>
                    <input value={safe} onChange={(e) => setSafe(e.target.value)} placeholder="Safe address with ZengawdGuardModule enabled" className="min-w-[22rem] border border-[#2e2e2e] bg-[#0e0e0e] px-2 py-1 outline-none" />
                    <button type="button" onClick={() => post("optInAutoRevoke")} disabled={!safe} className="border border-[#f59e0b] px-3 py-1 text-[#f59e0b] disabled:opacity-40">
                      I EXPLICITLY OPT IN TO AUTO-REVOCATION
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          <div className="overflow-x-auto border border-[#1e1e1e]">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="border-b border-[#1e1e1e] text-[10px] tracking-widest text-[#8a8a8a]">
                <tr>
                  <th className="p-3">STANDARD</th>
                  <th className="p-3">TOKEN</th>
                  <th className="p-3">SPENDER</th>
                  <th className="p-3">ALLOWANCE</th>
                  <th className="p-3">RISK STATE</th>
                  <th className="p-3">LAST EVALUATED</th>
                  <th className="p-3">ACTION</th>
                </tr>
              </thead>
              <tbody>
                {data.approvals.length === 0 && <tr><td colSpan={7} className="p-3 text-[#5a5a5a]">No outstanding approvals found in the scanned block range.</td></tr>}
                {data.approvals.map((r) => {
                  const k = `${r.token}:${r.spender}`;
                  return (
                    <tr key={k} className="border-b border-[#141414] align-top">
                      <td className="p-3">{r.standard}</td>
                      <td className="p-3">{r.token}</td>
                      <td className="p-3">{r.spender}</td>
                      <td className="p-3">{r.allowance === "true" ? "all" : r.allowance.length > 30 ? "unlimited" : r.allowance}</td>
                      <td className="p-3">
                        {r.lastVerdict ? <span style={{ color: COLOR[r.lastVerdict] ?? "#f2ede6" }}>{r.lastVerdict} {r.lastScore?.toFixed(1)}</span> : <span className="text-[#5a5a5a]">not yet evaluated</span>}
                        {r.revocationRecommendedAt && <div className="text-[#ef4444]">REVOCATION RECOMMENDED {new Date(r.revocationRecommendedAt).toLocaleString()}</div>}
                        {r.revocationTxHash && <div className="text-[#22c55e]">auto-revoked {r.revocationTxHash.slice(0, 12)}…</div>}
                      </td>
                      <td className="p-3">{r.lastCheckedAt ? new Date(r.lastCheckedAt).toLocaleString() : "—"}</td>
                      <td className="p-3">
                        {txs[k] ? <span className="text-[#22c55e]">sent {txs[k]?.slice(0, 12)}…</span> : (
                          <button type="button" onClick={() => revoke(r)} className="border border-[#ef4444] px-3 py-1 text-[#ef4444] hover:bg-[#ef4444] hover:text-[#050505]">REVOKE</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
