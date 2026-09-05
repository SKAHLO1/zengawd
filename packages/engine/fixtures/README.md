# Labeled fixture set

Two files, each a JSON array of `{ address, chainId, label, name, source, sourceUrl }`:

- `malicious.json` (22 contracts): documented rugs, scam tokens and wallet-drainer contracts on Ethereum mainnet.
  - 10 carry an Etherscan public name tag identifying them as a rug or scam (`Scam Inu`, `SushiSwap: RUG`,
    `RUG.WTF`, `This is Fine: an announced rug`, `PoorRug`, three `Scam ALERT` audits by Q DeFi Rating, ...).
    Taken from the `brianleect/etherscan-labels` snapshot at commit `923aba72c7e2d0682f7ae6194b6140bd90668dc9`.
  - 12 are contracts on the ScamSniffer blacklist (`scamsniffer/scam-database`, `blacklist/address.json`,
    commit `591e981264cc8e0abb6541c186a8fb7b69f15b59`, 2026-09-04), which lists drainer and phishing infrastructure.
  - Every address was confirmed to hold bytecode on Ethereum mainnet (`eth_getCode`) on 2026-09-05; EOAs from the
    same sources were discarded.
- `benign.json` (23 contracts): blue-chip tokens and protocol contracts (USDC, WETH, DAI, USDT, WBTC, UNI, LINK,
  AAVE, stETH, wstETH, Uniswap V2/V3/Universal routers, Permit2, Aave V3 Pool, Compound cUSDC, Seaport, Curve 3pool,
  Balancer Vault, 1inch router, Maker Vat, ENS Registry, Safe factory). Each entry cites the project's own
  deployment documentation.

`pnpm bench` runs the full live pipeline over both sets and prints precision, recall, false-positive rate, mean
escalation rate and mean cost per verdict. A malicious fixture counts as a true positive when the verdict is `BLOCK`
or `WARN`; a benign fixture counts as a false positive under the same rule. `INSUFFICIENT_SIGNAL` verdicts are
reported separately and excluded from precision/recall (the network, not the classifier, failed to answer).
