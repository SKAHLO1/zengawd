import { parseAbi, type Address } from "viem";
import { publicClient } from "./chains";
import type { ContractFacts } from "./types";

const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const ERC165 = parseAbi(["function supportsInterface(bytes4) view returns (bool)"]);
const ERC721_IID = "0x80ac58cd";

/**
 * Local, deterministic facts about the callee read from the chain RPC. These are not signals
 * and carry no weight; they decide which adapters apply (a holder count only makes sense for a token).
 */
export async function readContractFacts(chainId: number, address: Address): Promise<ContractFacts> {
  const client = publicClient(chainId);
  const none: ContractFacts = { isContract: false, codeSize: 0, isErc20: false, isErc721: false, symbol: null, name: null, decimals: null };
  let code: `0x${string}` | undefined;
  try {
    code = await client.getCode({ address });
  } catch {
    return none;
  }
  if (!code || code === "0x") return none;
  const facts: ContractFacts = { ...none, isContract: true, codeSize: (code.length - 2) / 2 };

  const [symbol, name, decimals, totalSupply, is721] = await Promise.all([
    tryRead(() => client.readContract({ address, abi: ERC20, functionName: "symbol" })),
    tryRead(() => client.readContract({ address, abi: ERC20, functionName: "name" })),
    tryRead(() => client.readContract({ address, abi: ERC20, functionName: "decimals" })),
    tryRead(() => client.readContract({ address, abi: ERC20, functionName: "totalSupply" })),
    tryRead(() => client.readContract({ address, abi: ERC165, functionName: "supportsInterface", args: [ERC721_IID] })),
  ]);
  facts.symbol = typeof symbol === "string" ? symbol : null;
  facts.name = typeof name === "string" ? name : null;
  facts.decimals = typeof decimals === "number" ? decimals : null;
  facts.isErc721 = is721 === true;
  facts.isErc20 = !facts.isErc721 && typeof totalSupply === "bigint" && typeof decimals === "number";
  return facts;
}

async function tryRead<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
