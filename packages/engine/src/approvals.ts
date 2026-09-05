import { encodeFunctionData, getAddress, parseAbi, parseAbiItem, type Address, type Hex } from "viem";
import { publicClient } from "./chains";
import { loadEnv } from "@zengawd/telegraph";

export type OutstandingApproval = {
  chainId: number;
  owner: Address;
  token: Address;
  spender: Address;
  standard: "ERC20" | "ERC721";
  /** decimal string allowance, or "true" for ApprovalForAll */
  allowance: string;
  lastTxHash: Hex;
  lastBlock: bigint;
};

const APPROVAL = parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)");
const APPROVAL_FOR_ALL = parseAbiItem("event ApprovalForAll(address indexed owner, address indexed operator, bool approved)");
const ERC20 = parseAbi(["function allowance(address owner, address spender) view returns (uint256)", "function approve(address spender, uint256 amount)"]);
const ERC721 = parseAbi(["function isApprovedForAll(address owner, address operator) view returns (bool)", "function setApprovalForAll(address operator, bool approved)"]);

/** Public RPCs cap eth_getLogs ranges; scan in chunks. */
const DEFAULT_CHUNK = 5_000n;

/**
 * Enumerate outstanding approvals for `owner` by scanning Approval / ApprovalForAll logs over the last
 * `lookbackBlocks` blocks and filtering to pairs whose current allowance is non-zero (read live).
 */
export async function scanApprovals(chainId: number, owner: Address, lookbackBlocks?: number, chunk = DEFAULT_CHUNK): Promise<OutstandingApproval[]> {
  loadEnv();
  const client = publicClient(chainId, 20_000);
  const head = await client.getBlockNumber();
  const lookback = BigInt(lookbackBlocks ?? Number(process.env.WATCHER_LOOKBACK_BLOCKS ?? "200000"));
  const from = head > lookback ? head - lookback : 0n;

  const pairs = new Map<string, { token: Address; spender: Address; standard: "ERC20" | "ERC721"; txHash: Hex; block: bigint }>();
  for (let start = from; start <= head; start += chunk) {
    const end = start + chunk - 1n > head ? head : start + chunk - 1n;
    const [erc20Logs, allLogs] = await Promise.all([
      client.getLogs({ event: APPROVAL, args: { owner }, fromBlock: start, toBlock: end }),
      client.getLogs({ event: APPROVAL_FOR_ALL, args: { owner }, fromBlock: start, toBlock: end }),
    ]);
    for (const l of erc20Logs) {
      if (!l.args.spender) continue;
      const token = getAddress(l.address);
      const spender = getAddress(l.args.spender);
      pairs.set(`20:${token}:${spender}`, { token, spender, standard: "ERC20", txHash: l.transactionHash, block: l.blockNumber });
    }
    for (const l of allLogs) {
      if (!l.args.operator) continue;
      const token = getAddress(l.address);
      const spender = getAddress(l.args.operator);
      pairs.set(`721:${token}:${spender}`, { token, spender, standard: "ERC721", txHash: l.transactionHash, block: l.blockNumber });
    }
  }

  const out: OutstandingApproval[] = [];
  await Promise.all(
    [...pairs.values()].map(async (p) => {
      try {
        if (p.standard === "ERC20") {
          const a = await client.readContract({ address: p.token, abi: ERC20, functionName: "allowance", args: [owner, p.spender] });
          if (a > 0n) out.push({ chainId, owner, token: p.token, spender: p.spender, standard: "ERC20", allowance: a.toString(), lastTxHash: p.txHash, lastBlock: p.block });
        } else {
          const ok = await client.readContract({ address: p.token, abi: ERC721, functionName: "isApprovedForAll", args: [owner, p.spender] });
          if (ok) out.push({ chainId, owner, token: p.token, spender: p.spender, standard: "ERC721", allowance: "true", lastTxHash: p.txHash, lastBlock: p.block });
        }
      } catch {
        /* token does not answer the standard read: not an outstanding approval we can act on */
      }
    }),
  );
  return out.sort((a, b) => Number(b.lastBlock - a.lastBlock));
}

/** Calldata that revokes the approval: approve(spender, 0) or setApprovalForAll(spender, false). */
export function revocationCalldata(standard: "ERC20" | "ERC721", spender: Address): Hex {
  return standard === "ERC20"
    ? encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, 0n] })
    : encodeFunctionData({ abi: ERC721, functionName: "setApprovalForAll", args: [spender, false] });
}

/** The calldata a guard target uses to represent the existing approval (what the user once signed). */
export function approvalCalldata(standard: "ERC20" | "ERC721", spender: Address, allowance: string): Hex {
  return standard === "ERC20"
    ? encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, BigInt(allowance)] })
    : encodeFunctionData({ abi: ERC721, functionName: "setApprovalForAll", args: [spender, true] });
}
