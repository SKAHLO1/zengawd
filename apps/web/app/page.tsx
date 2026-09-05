import Link from "next/link";

const cards = [
  { href: "/guard", title: "Guard a transaction", body: "Paste a token, contract, dApp URL or raw transaction. Zengawd fans it out across up to thirteen Telegraph intents and returns ALLOW, WARN or BLOCK with every signal, miner and settlement hash shown." },
  { href: "/approvals", title: "Watch your approvals", body: "Outstanding ERC-20 and ERC-721 approvals are re-scored on a schedule. A pair that flips from ALLOW to BLOCK gets a revocation recommendation, and auto-revocation only if you opted in." },
  { href: "/telemetry", title: "Routing telemetry", body: "Public. Every intent request ever made: which miners served it, latency percentiles, availability, cost, and how routing changes with the requested confidence." },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="border border-[#1e1e1e] p-8">
        <p className="font-mono text-[10px] tracking-[0.3em] text-[#2196f3]">ONCHAIN TRANSACTION GUARD</p>
        <h1 className="font-display mt-3 text-5xl uppercase tracking-tight md:text-7xl">
          A verdict is not a label.
          <br />
          It is an onchain action.
        </h1>
        <p className="mt-6 max-w-3xl text-lg text-[#b5b0a8]">
          Zengawd decomposes the transaction you are about to sign into parallel intelligence queries, declares each as an
          intent to Telegraph Protocol, lets the network route to ranked miners, pays per answer with x402, and turns the
          composite score into a policy check your wallet or Safe enforces.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/guard" className="border border-[#2196f3] bg-[#2196f3] px-5 py-3 font-mono text-xs tracking-[0.2em] text-[#050505] hover:bg-[#1976d2]">
            OPEN GUARD
          </Link>
          <Link href="/telemetry" className="border border-[#2e2e2e] px-5 py-3 font-mono text-xs tracking-[0.2em] text-[#f2ede6] hover:border-[#2196f3]">
            VIEW TELEMETRY
          </Link>
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="group border border-[#1e1e1e] p-6 transition-colors hover:border-[#2196f3]">
            <h2 className="font-display text-2xl uppercase tracking-wide group-hover:text-[#2196f3]">{c.title}</h2>
            <p className="mt-3 text-sm text-[#b5b0a8]">{c.body}</p>
          </Link>
        ))}
      </section>
      <section className="grid gap-4 border border-[#1e1e1e] p-6 md:grid-cols-3">
        {[
          ["01", "Intent-declared routing", "Zengawd never names a miner. It declares an intent, a confidence floor and a deadline; Telegraph routes probabilistically to its leaderboard. The miner that answered is recorded for telemetry only."],
          ["02", "Multi-intent fan-out", "Seven deterministic Stage 1 intents run in parallel. Only an ambiguous score escalates to six LLM-judged Stage 2 intents. FRAUD_DETECTION is shown but never scored."],
          ["03", "Onchain termination", "The verdict hash, code and score are attested into ZengawdPolicy on Base. A Safe module refuses transactions whose verdict is BLOCK, missing, or stale."],
        ].map(([n, t, b]) => (
          <div key={n}>
            <p className="font-mono text-[10px] tracking-widest text-[#2196f3]">{n}</p>
            <h3 className="font-display mt-1 text-xl uppercase">{t}</h3>
            <p className="mt-2 text-sm text-[#b5b0a8]">{b}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
