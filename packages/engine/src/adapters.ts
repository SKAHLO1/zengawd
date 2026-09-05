import { zeroAddress, type Address } from "viem";
import { chainName } from "./chains";
import { clamp01, collectText, findBoolean, findNumber, findString, keywordHits, normaliseRatio, numberNearKeyword } from "./extract";
import { hostOf } from "./target";
import type { ContractFacts, DecodedAction, GuardTarget } from "./types";

/** Everything an adapter may look at when phrasing its query and interpreting the answer. */
export type AdapterContext = {
  target: GuardTarget;
  decoded: DecodedAction;
  facts: ContractFacts | null;
  /** plain chain name for query phrasing */
  chain: string;
  /** the contract the transaction concerns (token or callee), null for URL-only targets */
  subject: Address | null;
  /** the wallet or contract that receives value / allowance */
  counterparty: Address | null;
  label: string;
  host: string | null;
};

export type Interpretation = { risk: number; rationale: string } | { unavailable: string };

export type Adapter = {
  id: string;
  intent: string;
  weight: number;
  stage: 1 | 2;
  advisory: boolean;
  /** Return a reason to skip when the target lacks a required input; null to run. */
  skip(ctx: AdapterContext): string | null;
  /** The intent-declaring query. Nothing here names a miner. */
  query(ctx: AdapterContext): { query: string; context?: Record<string, unknown> };
  interpret(data: unknown, ctx: AdapterContext): Interpretation;
  /**
   * Optional: read a *semantic* refusal out of a transport-level failure.
   *
   * Some miners answer a well-formed question with a meaningful "I do not cover this subject"
   * that the node surfaces as an HTTP error (e.g. CRYPTO_PRICE returning
   * `Unsupported asset. Use one of: BTC, ETH, ...`). That is a fact about the subject, not an
   * outage, and discarding it loses real signal. An adapter may claim such a reason here.
   * Anything not explicitly recognised must return null so the signal stays `unavailable`.
   */
  interpretError?(reason: string, ctx: AdapterContext): Interpretation | null;
};

export function buildContext(target: GuardTarget, decoded: DecodedAction, facts: ContractFacts | null): AdapterContext {
  const subject = decoded.token ?? (target.to !== zeroAddress ? target.to : null);
  /**
   * The counterparty is whoever would *receive* value or allowance. It exists only when the calldata
   * names one. A bare address target has no counterparty: scoring the callee's own native balance
   * would flag every legitimate token contract, since contracts hold no ETH.
   */
  const counterparty = decoded.spender ?? decoded.recipient ?? null;
  const host = hostOf(target.originUrl);
  const sym = facts?.symbol ? ` (${facts.symbol})` : "";
  const label = subject ? `${facts?.name ?? "contract"}${sym} ${subject}` : host ? host : "the target";
  return { target, decoded, facts, chain: chainName(target.chainId), subject, counterparty, label, host };
}

/**
 * Does this answer actually concern the subject we asked about?
 *
 * Observed on the live network: asking for the TVL of a token "on ethereum" was answered with
 * Ethereum-the-chain's own TVL (`kind: "chain"`, $49B), which read as deep liquidity for a
 * worthless token. An answer about a different subject is worse than no answer, so adapters whose
 * question names a specific token must confirm the response refers to it.
 */
function mentionsSubject(data: unknown, ctx: AdapterContext): boolean {
  const text = collectText(data).toLowerCase();
  if (!text) return false;
  const addr = ctx.subject?.toLowerCase();
  if (addr && text.includes(addr)) return true;
  const sym = ctx.facts?.symbol?.toLowerCase();
  if (sym && sym.length >= 3 && new RegExp(`\\b${sym.replace(/[^a-z0-9]/g, "")}\\b`).test(text)) return true;
  return false;
}

/** True when the miner answered about a whole chain rather than the token we named. */
function answeredAboutChain(data: unknown): boolean {
  const kind = findString(data, [/^kind$/i])?.value?.toLowerCase();
  return kind === "chain" || kind === "network";
}

const needsContract = (ctx: AdapterContext) => (ctx.subject ? null : "no contract address in target (URL-only input)");
const needsToken = (ctx: AdapterContext) =>
  ctx.subject ? (ctx.facts && (ctx.facts.isErc20 || ctx.facts.isErc721) ? null : "target is not an ERC-20/721 token, so holder and liquidity signals do not apply") : "no contract address in target";
const needsOrigin = (ctx: AdapterContext) => (ctx.host ? null : "no dApp origin URL supplied");
const needsLure = (ctx: AdapterContext) => (ctx.target.lureText ? null : "no lure text supplied");

/**
 * Terms that specifically accuse *this* project of wrongdoing. General crypto coverage rarely uses
 * these about a healthy asset.
 */
const STRONG_FLAGS = ["rug pull", "rugpull", "rugged", "honeypot", "drainer", "wallet drainer", "exit scam", "ponzi", "was exploited", "sec charges", "enforcement action", "indicted", "sued for fraud"];
/**
 * Terms that appear constantly in ordinary crypto reporting ("hack of another protocol", "scam
 * warning", ...). On their own they say nothing about the subject, so they only reinforce a strong flag.
 */
const WEAK_FLAGS = ["scam", "hack", "exploit", "stolen", "fraud", "phishing", "lawsuit", "breach"];
/** Phrases asserting the subject is clean. Treated as exculpatory. */
const NEGATIONS = ["no reports", "no evidence", "not been flagged", "no known", "no indication", "not a scam", "no results", "nothing found", "no articles", "legitimate", "no reported"];

// ─────────────────────────────── Stage 1 ───────────────────────────────

export const contractHistory: Adapter = {
  id: "contractHistory",
  intent: "ONCHAIN_TX_LOOKUP",
  weight: 0.18,
  stage: 1,
  advisory: false,
  skip: needsContract,
  /**
   * Phrased for the address-capable ONCHAIN_TX_LOOKUP miners. Several miners on this intent serve
   * only a 32-byte transaction hash and reject an address outright; when routing lands on one of
   * those the signal is recorded `unavailable` with the miner's own reason. See DECISIONS.md 2.7.
   */
  query: (ctx) => ({
    query: `For the contract address ${ctx.subject} on ${ctx.chain}, report its on-chain activity: the date it was deployed and the total number of transactions it has received.`,
    context: { chain: ctx.chain, address: ctx.subject },
  }),
  interpret: (data, ctx) => {
    const text = collectText(data);
    if (/not[_ ]found|does not exist|no such contract|unknown address/i.test(text) && !/deployed|created/i.test(text)) {
      return { unavailable: "miner could not locate the contract" };
    }
    // Some miners resolve this question to their balance endpoint and answer with a balance only.
    // That is a different question; it must not be read as contract history.
    const resolvedIntent = findString(data, [/^intent$/i])?.value;
    if (resolvedIntent && resolvedIntent.toUpperCase() !== "ONCHAIN_TX_LOOKUP") {
      return { unavailable: `miner answered the ${resolvedIntent} question instead of contract history` };
    }
    const txCount =
      findNumber(data, [/^tx_?count$/i, /transaction_?count/i, /^transactions$/i, /^txns?$/i, /interaction/i, /^nonce$/i])?.value ??
      numberNearKeyword(text, /transactions?|txns?|interactions?/);
    const ageDays = ageInDays(data, text);
    if (txCount === null && ageDays === null) return { unavailable: "response carries no deployment date or transaction count" };
    const parts: number[] = [];
    const why: string[] = [];
    if (ageDays !== null) {
      const r = ageDays < 7 ? 0.9 : ageDays < 30 ? 0.65 : ageDays < 180 ? 0.3 : 0.08;
      parts.push(r);
      why.push(`deployed about ${Math.round(ageDays)} days ago`);
    }
    if (txCount !== null) {
      const r = txCount < 10 ? 0.85 : txCount < 100 ? 0.55 : txCount < 1000 ? 0.3 : 0.08;
      parts.push(r);
      why.push(`${Math.round(txCount).toLocaleString()} recorded transactions`);
    }
    const risk = parts.reduce((a, b) => a + b, 0) / parts.length;
    return { risk, rationale: `Contract ${short(ctx.subject)} on ${ctx.chain}: ${why.join(", ")}.` };
  },
};

export const holderConcentration: Adapter = {
  id: "holderConcentration",
  intent: "TOKEN_HOLDER_COUNT",
  weight: 0.16,
  stage: 1,
  advisory: false,
  skip: needsToken,
  query: (ctx) => ({
    query: `How many distinct addresses hold the ${ctx.facts?.isErc721 ? "ERC-721" : "ERC-20"} token ${ctx.subject}${ctx.facts?.symbol ? ` (${ctx.facts.symbol})` : ""} on ${ctx.chain}?`,
    context: { chain: ctx.chain, token: ctx.subject },
  }),
  interpret: (data, ctx) => {
    const text = collectText(data);
    if (!mentionsSubject(data, ctx)) return { unavailable: "response does not reference the token that was asked about" };
    const holders =
      findNumber(data, [/^holders?$/i, /holders?_?count/i, /holder_?total/i, /^count$/i, /^total_?holders$/i])?.value ??
      numberNearKeyword(text, /holders?/);
    if (holders === null) return { unavailable: "response carries no holder count" };
    const risk = holders < 50 ? 0.95 : holders < 200 ? 0.8 : holders < 1000 ? 0.55 : holders < 5000 ? 0.3 : holders < 50000 ? 0.12 : 0.03;
    return { risk, rationale: `${ctx.facts?.symbol ?? "The token"} has ${Math.round(holders).toLocaleString()} holders on ${ctx.chain}.` };
  },
};

export const liquidityDepth: Adapter = {
  id: "liquidityDepth",
  intent: "TVL_LOOKUP",
  weight: 0.16,
  stage: 1,
  advisory: false,
  skip: needsToken,
  /**
   * Phrasing is load-bearing and was tuned against the live router:
   *  - naming the chain ("on ethereum") made miners answer with the chain's own TVL;
   *  - leading with "ERC-20 token at contract address" made the router classify it as
   *    TOKEN_HOLDER_COUNT.
   * Leading with DeFi liquidity keeps the classification on TVL_LOOKUP.
   */
  query: (ctx) => ({
    query: `How much liquidity, in US dollars, is locked in DeFi pools for ${ctx.facts?.symbol ?? "the token"} (${ctx.subject})?`,
  }),
  interpret: (data, ctx) => {
    const text = collectText(data);
    if (answeredAboutChain(data)) {
      return { unavailable: "miner answered with the chain's total TVL, not this token's liquidity" };
    }
    if (!mentionsSubject(data, ctx)) {
      return { unavailable: "response does not reference the token that was asked about" };
    }
    const tvl =
      findNumber(data, [/^tvl(_usd)?$/i, /total_?value_?locked/i, /liquidity(_usd)?/i, /^value_?usd$/i])?.value ??
      numberNearKeyword(text, /tvl|total value locked|liquidity/);
    if (tvl === null) return { unavailable: "response carries no TVL or liquidity figure" };
    const risk = tvl < 10_000 ? 0.9 : tvl < 100_000 ? 0.6 : tvl < 1_000_000 ? 0.35 : tvl < 10_000_000 ? 0.15 : 0.05;
    return { risk, rationale: `Liquidity for ${ctx.facts?.symbol ?? short(ctx.subject)} is about $${Math.round(tvl).toLocaleString()} on ${ctx.chain}.` };
  },
  interpretError: (reason, ctx) => {
    /**
     * A TVL source that has no record of the token is weak evidence of thin liquidity: DeFi
     * aggregators index protocols and pooled assets, so an asset absent from them usually has no
     * meaningful pool. It is only weak evidence, because plenty of legitimate tokens are also
     * unindexed, so this scores mid-band rather than as a finding.
     */
    if (/from defillama|not found|unknown protocol|no data for|unsupported/i.test(reason)) {
      return { risk: 0.55, rationale: `No DeFi liquidity record exists for ${ctx.facts?.symbol ?? short(ctx.subject)}, which is consistent with a thin or absent pool.` };
    }
    return null;
  },
};

export const counterpartyWallet: Adapter = {
  id: "counterpartyWallet",
  intent: "WALLET_BALANCE_CHECK",
  weight: 0.1,
  stage: 1,
  advisory: false,
  skip: (ctx) => (ctx.counterparty ? null : "the transaction names no counterparty (spender or recipient) to profile"),
  query: (ctx) => ({
    query: `What is the native coin balance of the address ${ctx.counterparty} on ${ctx.chain}?`,
    context: { chain: ctx.chain, address: ctx.counterparty },
  }),
  interpret: (data, ctx) => {
    const text = collectText(data);
    if (/unavailable|could not read|provider error/i.test(text) && !/balance/i.test(text)) return { unavailable: "miner reported the balance as unreadable" };
    const bal =
      findNumber(data, [/^native_?balance$/i, /balance_?(eth|native|human|formatted)/i, /^balance$/i, /^amount$/i, /^native$/i])?.value ??
      numberNearKeyword(text, /balance/);
    if (bal === null) return { unavailable: "response carries no balance figure" };
    // Raw base units (wei) are normalised when the value is implausibly large for a human amount.
    const human = bal > 1e12 ? bal / 1e18 : bal;
    const risk = human === 0 ? 0.75 : human < 0.01 ? 0.55 : human < 0.1 ? 0.35 : human < 1 ? 0.2 : 0.08;
    return { risk, rationale: `Counterparty ${short(ctx.counterparty)} holds ${human.toLocaleString(undefined, { maximumFractionDigits: 4 })} native coin on ${ctx.chain}.` };
  },
};

export const priceSanity: Adapter = {
  id: "priceSanity",
  intent: "CRYPTO_PRICE",
  weight: 0.08,
  stage: 1,
  advisory: false,
  skip: (ctx) => (ctx.facts?.isErc20 && ctx.facts.symbol ? null : "target has no token symbol to price"),
  query: (ctx) => ({
    query: `What is the current price in US dollars of the cryptocurrency ${ctx.facts?.symbol} (token contract ${ctx.subject} on ${ctx.chain})?`,
  }),
  interpret: (data, ctx) => {
    const text = collectText(data);
    const price = findNumber(data, [/^price(_usd)?$/i, /^usd$/i, /current_?price/i, /price_?in_?usd/i])?.value ?? numberNearKeyword(text, /\$|usd|price/);
    if (price !== null && price > 0) {
      return { risk: 0.1, rationale: `${ctx.facts?.symbol} has a quoted market price of $${price.toLocaleString(undefined, { maximumFractionDigits: 6 })}.` };
    }
    if (/not found|unknown|no (price|data)|unsupported|could not/i.test(text)) {
      return { risk: 0.65, rationale: `No market price is available for ${ctx.facts?.symbol}, which is typical of unlisted or freshly minted tokens.` };
    }
    return { unavailable: "response carries no price" };
  },
  interpretError: (reason, ctx) => {
    // A price miner that answers "unsupported asset" has told us the token is not listed on its
    // venues. For a token the user is about to transact with, that is the signal, not an outage.
    if (/unsupported asset|unknown asset|not supported|invalid_pair|no such coin|asset not found/i.test(reason)) {
      return { risk: 0.65, rationale: `${ctx.facts?.symbol ?? "The token"} is not listed on the price miner's venues, which is typical of unlisted or freshly minted tokens.` };
    }
    return null;
  },
};

export const originScan: Adapter = {
  id: "originScan",
  intent: "URL_SCAN",
  weight: 0.16,
  stage: 1,
  advisory: false,
  skip: needsOrigin,
  query: (ctx) => ({ query: `Scan the URL ${ctx.target.originUrl} for malware or phishing. Is this link malicious?`, context: { url: ctx.target.originUrl } }),
  interpret: (data, ctx) => {
    const text = collectText(data);
    const flag = findBoolean(data, [/^(is_)?malicious$/i, /^(is_)?phishing$/i, /^unsafe$/i, /^(is_)?threat$/i, /^flagged$/i, /^in_database$/i]);
    if (flag?.value === true) return { risk: 0.95, rationale: `${ctx.host} is flagged as malicious by the URL scan.` };
    const counts = findNumber(data, [/^malicious$/i, /malicious_?count/i, /^positives$/i, /^detections$/i]);
    if (counts && counts.value > 0) return { risk: 0.9, rationale: `${ctx.host} has ${counts.value} malicious detections.` };
    const verdict = findString(data, [/^verdict$/i, /^threat(_?status)?$/i, /^status$/i, /^label$/i, /^classification$/i, /^query_status$/i, /^url_status$/i]);
    const v = (verdict?.value ?? "").toLowerCase();
    if (/malicious|phishing|malware|online|listed/.test(v)) return { risk: 0.95, rationale: `${ctx.host} is classified as "${verdict?.value}" by the URL scan.` };
    if (/suspicious|medium|unknown/.test(v)) return { risk: 0.55, rationale: `${ctx.host} is classified as "${verdict?.value}" by the URL scan.` };
    const score = findNumber(data, [/risk_?score/i, /^score$/i, /threat_?score/i]);
    if (score) return { risk: normaliseRatio(score.value), rationale: `${ctx.host} has a URL risk score of ${score.value}.` };
    if (flag?.value === false || /no_results|not found|clean|safe|benign|harmless|no threat/i.test(v || text)) {
      return { risk: 0.05, rationale: `${ctx.host} is not on the scanner's threat lists.` };
    }
    return { unavailable: "response carries no verdict or score" };
  },
};

export const originCert: Adapter = {
  id: "originCert",
  intent: "SSL_VERIFICATION",
  weight: 0.06,
  stage: 1,
  advisory: false,
  skip: needsOrigin,
  query: (ctx) => ({ query: `Verify the SSL/TLS certificate of the domain ${ctx.host}: is it valid and trusted, when was it issued, and does it match the hostname?`, context: { domain: ctx.host } }),
  interpret: (data, ctx) => {
    const text = collectText(data);
    // Certificate-transparency miners answer with the issuance list. An empty list means no
    // certificate for this hostname has ever been logged, which for a live HTTPS origin is itself
    // a finding: lookalike and throwaway phishing domains routinely have no CT history.
    if (Array.isArray(data)) {
      if (data.length === 0) {
        return { risk: 0.6, rationale: `No certificate for ${ctx.host} appears in the certificate transparency logs.` };
      }
      const issued = ageInDays(data, text, [/not_?before/i, /issued(_at)?/i, /valid_?from/i, /^issuance/i]);
      if (issued !== null) {
        return issued < 30
          ? { risk: 0.5, rationale: `The most recent certificate for ${ctx.host} was issued only ${Math.round(issued)} days ago.` }
          : { risk: 0.05, rationale: `${ctx.host} has an established certificate transparency history (${Math.round(issued)} days).` };
      }
      return { risk: 0.15, rationale: `${ctx.host} has ${data.length} logged certificate issuance(s).` };
    }
    const valid = findBoolean(data, [/^(is_)?valid$/i, /^trusted$/i, /^hostname_?match(es)?$/i, /^ok$/i]);
    const verdict = (findString(data, [/^verdict$/i, /^status$/i, /^label$/i, /^result$/i])?.value ?? "").toLowerCase();
    if (valid?.value === false || /expired|self.?signed|untrusted|mismatch|invalid|revoked/.test(verdict)) {
      return { risk: 0.7, rationale: `The certificate for ${ctx.host} is not valid (${verdict || "failed verification"}).` };
    }
    const issued = ageInDays(data, text, [/not_?before/i, /issued(_at)?/i, /valid_?from/i, /^issuance/i]);
    const daysLeft = findNumber(data, [/days_?(remaining|left|until_?expiry)/i])?.value ?? null;
    if (issued !== null && issued < 30) return { risk: 0.5, rationale: `The certificate for ${ctx.host} was issued only ${Math.round(issued)} days ago.` };
    if (daysLeft !== null && daysLeft < 7) return { risk: 0.4, rationale: `The certificate for ${ctx.host} expires in ${Math.round(daysLeft)} days.` };
    if (valid?.value === true || /valid|trusted|ok|good/.test(verdict) || /is valid|valid certificate/i.test(text)) {
      return { risk: 0.05, rationale: `The certificate for ${ctx.host} is valid and trusted.` };
    }
    return { unavailable: "response carries no certificate verdict" };
  },
};

// ─────────────────────────────── Stage 2 ───────────────────────────────

export const socialFlags: Adapter = {
  id: "socialFlags",
  intent: "TWITTER_SEARCH",
  weight: 0.14,
  stage: 2,
  advisory: false,
  skip: (ctx) => (ctx.subject || ctx.host ? null : "nothing to search for"),
  query: (ctx) => ({ query: `Search Twitter/X for posts flagging ${ctx.label} as a scam, rug pull, honeypot, drainer, or impersonation.` }),
  interpret: (data, ctx) => flagInterpretation(data, `Social posts about ${ctx.label}`),
};

export const newsFlags: Adapter = {
  id: "newsFlags",
  intent: "NEWS_SEARCH",
  weight: 0.1,
  stage: 2,
  advisory: false,
  skip: (ctx) => (ctx.subject || ctx.host ? null : "nothing to search for"),
  query: (ctx) => ({ query: `Search recent news for ${ctx.label} related to an exploit, hack, rug pull, or enforcement action.` }),
  interpret: (data, ctx) => flagInterpretation(data, `News coverage of ${ctx.label}`),
};

export const claimCheck: Adapter = {
  id: "claimCheck",
  intent: "FACT_CHECK",
  weight: 0.1,
  stage: 2,
  advisory: false,
  skip: (ctx) => (ctx.subject || ctx.host ? null : "nothing to fact-check"),
  /** No raw address here: including one pulls the router towards the on-chain intents. */
  query: (ctx) => ({
    query: `Fact check the following claim and state whether it is true or false: "The cryptocurrency project ${ctx.facts?.name ?? ctx.facts?.symbol ?? ctx.host ?? "under review"} is legitimate and has never been the subject of a reported rug pull, exit scam, or enforcement action."`,
  }),
  interpret: (data, ctx) => {
    const verdict = (findString(data, [/^verdict$/i, /^rating$/i, /^label$/i, /^result$/i, /^conclusion$/i, /^answer$/i])?.value ?? "").toLowerCase();
    const text = collectText(data).toLowerCase();
    const v = verdict || text.slice(0, 400);
    if (/\b(false|refuted|unsupported|misleading|debunked|fraud|scam)\b/.test(v)) return { risk: 0.85, rationale: `The legitimacy claim for ${ctx.label} is contradicted (${verdict || "rated false"}).` };
    if (/\b(true|supported|verified|accurate|legitimate)\b/.test(v) && !/not (true|supported|verified)/.test(v)) return { risk: 0.1, rationale: `The legitimacy claim for ${ctx.label} is supported (${verdict || "rated true"}).` };
    if (/unverifiable|insufficient|unknown|uncertain|mixed|cannot/.test(v)) return { risk: 0.5, rationale: `The legitimacy claim for ${ctx.label} could not be verified either way.` };
    return { unavailable: "response carries no fact-check verdict" };
  },
};

export const lureAuthorship: Adapter = {
  id: "lureAuthorship",
  intent: "AI_TEXT_DETECTION",
  weight: 0.08,
  stage: 2,
  advisory: false,
  skip: needsLure,
  query: (ctx) => ({ query: `Was the following text written by an AI or a human? Text: """${ctx.target.lureText?.slice(0, 4000)}"""`, context: { text: ctx.target.lureText?.slice(0, 4000) } }),
  interpret: (data) => {
    const prob = findNumber(data, [/ai_?prob/i, /^probability$/i, /ai_?score/i, /^score$/i, /fake_?prob/i, /^confidence$/i]);
    const label = (findString(data, [/^label$/i, /^verdict$/i, /^prediction$/i, /^classification$/i, /^result$/i])?.value ?? "").toLowerCase();
    const answer = findNumber(data, [/^answer$/i]);
    if (answer && (answer.value === 0 || answer.value === 1)) {
      return answer.value === 1 ? { risk: 0.7, rationale: "The lure text is classified as AI-generated." } : { risk: 0.1, rationale: "The lure text is classified as human-written." };
    }
    if (/\b(ai|machine|generated|synthetic)\b/.test(label)) return { risk: 0.7, rationale: `The lure text is labelled "${label}".` };
    if (/human/.test(label)) return { risk: 0.1, rationale: `The lure text is labelled "${label}".` };
    if (prob) {
      const p = normaliseRatio(prob.value);
      return { risk: clamp01(0.1 + 0.6 * p), rationale: `AI-authorship probability for the lure text is ${(p * 100).toFixed(0)}%.` };
    }
    return { unavailable: "response carries no AI-detection label or probability" };
  },
};

export const lureContent: Adapter = {
  id: "lureContent",
  intent: "CONTENT_MODERATION",
  weight: 0.08,
  stage: 2,
  advisory: false,
  skip: needsLure,
  query: (ctx) => ({ query: `Moderate and classify the following message for phishing, urgency pressure, impersonation, or scam patterns: """${ctx.target.lureText?.slice(0, 4000)}"""`, context: { content: ctx.target.lureText?.slice(0, 4000) } }),
  interpret: (data) => {
    const score = findNumber(data, [/risk_?score/i, /^score$/i, /^severity$/i, /^probability$/i]);
    const level = (findString(data, [/risk_?level/i, /^level$/i, /^label$/i, /^verdict$/i, /^category$/i, /^band$/i])?.value ?? "").toLowerCase();
    const flagged = findBoolean(data, [/^flagged$/i, /^is_?(phishing|scam|malicious)$/i, /^blocked$/i, /^detected$/i]);
    if (/critical|high|phishing|scam|malicious|injection/.test(level)) return { risk: 0.9, rationale: `The lure text is rated "${level}" by content moderation.` };
    if (flagged?.value === true) return { risk: 0.8, rationale: "The lure text is flagged by content moderation." };
    if (/medium|moderate|suspicious/.test(level)) return { risk: 0.5, rationale: `The lure text is rated "${level}" by content moderation.` };
    if (score) return { risk: normaliseRatio(score.value), rationale: `The lure text has a moderation risk score of ${score.value}.` };
    if (/low|safe|clean|benign|none/.test(level) || flagged?.value === false) return { risk: 0.1, rationale: "The lure text shows no phishing or scam patterns." };
    return { unavailable: "response carries no moderation score or label" };
  },
};

export const fraudCorroboration: Adapter = {
  id: "fraudCorroboration",
  intent: "FRAUD_DETECTION",
  weight: 0,
  stage: 2,
  advisory: true,
  skip: (ctx) => (ctx.counterparty ?? ctx.subject ? null : "no address to assess"),
  query: (ctx) => ({
    query: `Perform a fraud and anomaly risk assessment of the blockchain address ${ctx.counterparty ?? ctx.subject} on ${ctx.chain}. Return a risk tier and the evidence behind it.`,
    context: { chain: ctx.chain, address: ctx.counterparty ?? ctx.subject },
  }),
  interpret: (data) => {
    const score = findNumber(data, [/risk_?score/i, /fraud_?score/i, /^score$/i, /^probability$/i]);
    const tier = (findString(data, [/risk_?tier/i, /^tier$/i, /risk_?level/i, /^verdict$/i, /^label$/i, /^decision$/i])?.value ?? "").toLowerCase();
    if (/critical|high|block|fraud|malicious/.test(tier)) return { risk: 0.9, rationale: `Advisory: fraud screen rates the address "${tier}".` };
    if (/medium|recheck|elevated|suspicious/.test(tier)) return { risk: 0.5, rationale: `Advisory: fraud screen rates the address "${tier}".` };
    if (/low|allow|clean|minimal/.test(tier)) return { risk: 0.1, rationale: `Advisory: fraud screen rates the address "${tier}".` };
    if (score) return { risk: normaliseRatio(score.value), rationale: `Advisory: fraud screen risk score ${score.value}.` };
    return { unavailable: "response carries no fraud tier or score" };
  },
};

export const STAGE1_ADAPTERS: Adapter[] = [contractHistory, holderConcentration, liquidityDepth, counterpartyWallet, priceSanity, originScan, originCert];
export const STAGE2_ADAPTERS: Adapter[] = [socialFlags, newsFlags, claimCheck, lureAuthorship, lureContent, fraudCorroboration];
export const ALL_ADAPTERS: Adapter[] = [...STAGE1_ADAPTERS, ...STAGE2_ADAPTERS];

// ─────────────────────────────── helpers ───────────────────────────────

/**
 * Judge a search answer about the subject.
 *
 * Ordinary crypto reporting is saturated with "hack" and "scam" as background vocabulary, so a bare
 * keyword count marks every blue chip as malicious. Risk is therefore driven by *specific*
 * accusations (STRONG_FLAGS), with generic terms only reinforcing them, and explicit "no reports"
 * language read as exculpatory.
 */
function flagInterpretation(data: unknown, subject: string): Interpretation {
  const text = collectText(data);
  if (!text.trim()) return { unavailable: "response carries no searchable text" };
  const items = findNumber(data, [/^(total_?)?(results|count|articles|posts|tweets|hits)$/i])?.value ?? null;
  const strong = keywordHits(text, STRONG_FLAGS);
  const weak = keywordHits(text, WEAK_FLAGS);
  const negated = keywordHits(text, NEGATIONS).hits > 0;

  if (strong.hits >= 2) return { risk: 0.9, rationale: `${subject} specifically allege ${strong.matched.slice(0, 3).join(", ")}.` };
  if (strong.hits === 1) {
    const m = strong.matched[0] ?? "wrongdoing";
    return negated
      ? { risk: 0.35, rationale: `${subject} mention ${m}, but also state there are no confirmed reports.` }
      : { risk: 0.75, rationale: `${subject} allege ${m}.` };
  }
  if (negated || items === 0 || /no (results|articles|posts|tweets)|nothing found/i.test(text)) {
    return { risk: 0.1, rationale: `${subject}: no reports of wrongdoing found.` };
  }
  // Only generic vocabulary. Slightly elevated when unusually dense, otherwise unremarkable.
  if (weak.hits >= 3) return { risk: 0.4, rationale: `${subject} carry general risk vocabulary (${weak.matched.slice(0, 3).join(", ")}) without a specific allegation.` };
  return { risk: 0.1, rationale: `${subject} contain no specific allegation of a rug pull, drainer, or enforcement action.` };
}

function ageInDays(data: unknown, text: string, keys: RegExp[] = [/deploy(ed|ment)?_?(at|date|time)?/i, /creat(ed|ion)_?(at|date|time)?/i, /first_?seen/i, /^timestamp$/i, /age_?days/i]): number | null {
  const direct = findNumber(data, [/age_?days/i, /days_?old/i, /days_?since/i]);
  if (direct) return direct.value;
  const s = findString(data, keys)?.value ?? findNumber(data, keys)?.value?.toString();
  const parsed = s ? parseDate(s) : null;
  if (parsed) return (Date.now() - parsed) / 86_400_000;
  const m = /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (m?.[1] && /deploy|creat|first/i.test(text)) {
    const d = Date.parse(m[1]);
    if (Number.isFinite(d)) return (Date.now() - d) / 86_400_000;
  }
  return null;
}

function parseDate(s: string): number | null {
  if (/^\d{9,10}$/.test(s)) return Number(s) * 1000;
  if (/^\d{12,13}$/.test(s)) return Number(s);
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : null;
}

function short(a: Address | null): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "unknown";
}
