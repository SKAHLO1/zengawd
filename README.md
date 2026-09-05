# Zengawd

Onchain transaction guard. A transaction about to be signed is decomposed into parallel intelligence queries, each
declared as an **intent** to [Telegraph Protocol](https://docs.telegraphprotocol.com), routed by the network to ranked
miners, paid per answer with **x402**, scored into a composite verdict, and enforced onchain through `ZengawdPolicy`
and a Gnosis Safe module. Granted approvals are re-scored continuously and revoked when the asset trips a threshold.

Read [DECISIONS.md](./DECISIONS.md) first: it records every API detail resolved from the live docs and every place
the live platform differs from the original brief.

## Layout

```
apps/web              Next.js 16 app: /guard, /approvals, /telemetry (public), API routes
packages/telegraph    Telegraph client: requestIntent(), x402 challenge/settle/retry, telemetry rows
packages/engine       Calldata decoding, 13 signal adapters, scoring + escalation, attestation, bench, calibration
packages/contracts    Foundry: ZengawdPolicy.sol, ZengawdGuardModule.sol, 14 tests
packages/db           Drizzle schema + migrations (SQLite driver; see DECISIONS.md)
services/watcher      Approval monitoring loop with opt-in auto-revocation
```

## Quick start

```bash
pnpm install
cp .env.example .env          # fill TELEGRAPH_EVM_PRIVATE_KEY with a burner funded with Base Sepolia USDC
pnpm db:migrate
pnpm dev                      # http://localhost:3000
```

Other commands:

| Command | What it does |
|---|---|
| `pnpm test` | Vitest for db, telegraph, engine (30 tests; mocks exist only in `*.test.ts`) |
| `pnpm forge:test` | Foundry suite (needs `forge` on PATH) |
| `pnpm --filter @zengawd/telegraph live-check` | One real intent end to end, prints the `intent_requests` row |
| `pnpm calibrate [--loop]` | Same benchmark payload per intent at confidence 0.5 to 0.9, feeds the `/telemetry` chart |
| `pnpm bench` | Full live pipeline over the labeled fixtures, prints precision / recall / FPR / escalation / cost |
| `pnpm watcher` / `pnpm watcher:once` | Approval monitor loop / single pass |
| `pnpm --filter @zengawd/contracts deploy:base-sepolia` | Deploy policy + Safe module (needs `--private-key`) |

## How a verdict is produced

1. **Target**: address, dApp URL, raw signed tx, or JSON tx. Calldata is decoded with a local selector table
   (`transfer`, `approve`, `setApprovalForAll`, swaps, arbitrary call). Local RPC facts (is contract, ERC-20/721,
   symbol) decide which adapters apply.
2. **Stage 1** (7 intents, `minConfidence 0.6`, `deadline 4 s`, parallel): `ONCHAIN_TX_LOOKUP`,
   `TOKEN_HOLDER_COUNT`, `TVL_LOOKUP`, `WALLET_BALANCE_CHECK`, `CRYPTO_PRICE`, `URL_SCAN`, `SSL_VERIFICATION`.
3. **Score** `= 100 * sum(risk_i * w_i) / sum(w_i)` over returned signals. `< 25` ALLOW, `> 65` BLOCK, fewer than four
   returned signals INSUFFICIENT_SIGNAL (treated as BLOCK), otherwise escalate.
4. **Stage 2** (6 intents, `0.8`, `12 s`): `TWITTER_SEARCH`, `NEWS_SEARCH`, `FACT_CHECK`, `AI_TEXT_DETECTION`,
   `CONTENT_MODERATION`, and `FRAUD_DETECTION` at **zero weight** (displayed, never scored). Combined score `< 40`
   WARN, else BLOCK. Every threshold lives in `THRESHOLDS` (`packages/engine/src/thresholds.ts`).
5. **Attest**: `keccak256` of the canonical `{calldata, chainId, createdAt, from, score, to, verdict}` JSON is
   written to `ZengawdPolicy.recordVerdict` by the server-held attestor. `checkAllowed` is false for BLOCK,
   INSUFFICIENT, absent, or older than `maxVerdictAge` (900 s). `ZengawdGuardModule.execTransaction` reverts with
   `VerdictBlocked(safe, to, selector, code, score)`.

Miner IDs are never inputs anywhere. They are recorded from responses and shown only on `/telemetry` and in signal rows.

## Deployed contracts (Base Sepolia, chain 84532)

| Contract | Address |
|---|---|
| `ZengawdPolicy` | [`0xAEA254c656DFEa37b9C97A61221e42f1AdE8588C`](https://sepolia.basescan.org/address/0xAEA254c656DFEa37b9C97A61221e42f1AdE8588C) |
| `ZengawdGuardModule` | [`0x3A89426505aA88C4D9df47dECF29924ffAd6178d`](https://sepolia.basescan.org/address/0x3A89426505aA88C4D9df47dECF29924ffAd6178d) |
| Attestor | `0xC295c1F28CCE600c8bE30087220c374A102B9097` |
| x402 payer (burner) | `0xB94F38FdAa0e7836772355dB8187884c73Cf28Fe` |

## Verification status (2026-09-05)

Proven against the live network, with transactions anyone can check:

- **Real paid inference.** First settled call: miner `7302` (ChainWire) answered `TOKEN_HOLDER_COUNT`, `$0.01`,
  settlement [`0x89a91f10…`](https://sepolia.basescan.org/tx/0x89a91f1012c42bb4c0a165e95f23d82c7064bb2ba3df713fe7e1fdc07b340d5e)
  (status 1, block 46403547). The payer balance moved exactly 10.000000 → 9.990000 USDC.
- **Probabilistic routing, not pinned miners.** 10 distinct miners have served intents so far
  (`7302, 900, 302, 7322, 209, 10001, 5001, 10002, 10, 717190`), and the same intent is demonstrably served by
  different miners across attempts. Visible on `/telemetry`.
- **Verdicts terminate on chain.** Every acceptance run writes its hash, code and score to `ZengawdPolicy` via
  `recordVerdict`, e.g. [`0xe1d14b1e…`](https://sepolia.basescan.org/tx/0xe1d14b1e84024d047d8387d02ee729d2b9b005831da0a2d818c0726b80e85312).
- Discovery probed: 45 canonical intents, 129 active miners; every engine intent has live miners except
  `TWITTER_SEARCH` (0), which is gated before spending.
- Tests: 28 unit (db 2, telegraph 8, engine 20) and 14 Foundry, including the Safe module revert and stale-verdict
  paths.
- `pnpm dev` serves `/`, `/guard`, `/approvals`, `/telemetry`; `/api/approvals` scans chain logs live.

What running against the live network changed, in short (full detail in DECISIONS.md sections 2.6 to 2.11):

| Finding | Consequence |
|---|---|
| x402 settlement costs ~11.7 s per call, dwarfing the miner's ~0.5 s | Deadlines are enforced against the miner's own serve time; the payment rail gets a separate named budget. Otherwise every verdict is `INSUFFICIENT_SIGNAL`. |
| A `TVL_LOOKUP` miner answered with the **chain's** $49bn TVL instead of the token's | Adapters now verify the answer refers to the subject asked about. A confident, well-formed, wrong-subject answer is the worst failure mode there is. |
| `context` is forwarded to miners, whose schemas reject unknown keys | No `context` is sent; hints were destroying good signals with `422 Unrecognized keys`. |
| Per-call usable-signal rate is ~40-60% | Each adapter re-declares its intent once, which reaches a different miner. |
| "Four Stage 1 signals" is unreachable for a bare address | The floor counts adapters that were *applicable*, never below two. |

Still open:

| Acceptance item | Status |
|---|---|
| `pnpm bench` precision / recall published below | running |
| Confidence-vs-routing chart populated from calibration | running |
| Watcher flipping a live approval ALLOW -> BLOCK | needs a registered address holding approvals that degrade; the flip path is exercised by the watcher on every pass |

## Latest bench run

Not yet run (see above). `pnpm bench` writes `packages/engine/bench-results/latest.json` and prints:

```
precision / recall / false-positive rate / escalation rate / mean cost per verdict / mean latency / confusion matrix
```

Fixture provenance: [packages/engine/fixtures/README.md](./packages/engine/fixtures/README.md) (22 malicious contracts,
23 benign contracts, each with a cited source).

## Hard constraints, where they are enforced

| Constraint | Enforcement |
|---|---|
| No mocked miner data outside tests | `requestIntent` returns `unavailable` on any failure; grep for `MOCK` finds nothing in `src/` |
| No hardcoded miner IDs | Only `POST /engine/v1/ask` (auto-routed) is called; `/ask/{minerId}` is never used |
| No private keys client-side | Payment key in `packages/telegraph/src/config.ts`, attestor in `packages/engine/src/attest.ts`, both server-only |
| `FRAUD_DETECTION` zero weight | `fraudCorroboration.weight = 0`, `advisory = true`, excluded by `scorableSignals()`; tested |
| No personal data | Only wallet addresses are stored |
| No browser storage for state | Wallet state is React state; all history is server-side |
| Every external call has a timeout | AbortController deadlines in the client, `http(..., { timeout })` on all RPC clients |
