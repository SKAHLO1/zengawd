import { createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv } from "@zengawd/telegraph";
import { publicClient, revocationCalldata, rpcUrl } from "@zengawd/engine";

const MODULE_ABI = parseAbi([
  "function execTransaction(address safe, address to, uint256 value, bytes data, uint8 operation) returns (bool)",
]);

/**
 * Submit `approve(spender, 0)` / `setApprovalForAll(spender, false)` from the user's Safe through
 * ZengawdGuardModule. Runs only when the user opted in and delegated; the operator key is server-side.
 * Note: the module itself re-checks ZengawdPolicy for (safe, token, selector) and the revocation
 * selector needs an ALLOW/WARN verdict of its own, which the watcher attests before calling.
 */
export async function submitAutoRevocation(chainId: number, safe: Address, token: Address, spender: Address, standard: "ERC20" | "ERC721"): Promise<{ txHash: Hex | null; error: string | null }> {
  loadEnv();
  const pk = process.env.ZENGAWD_OPERATOR_PRIVATE_KEY?.trim() ?? process.env.ZENGAWD_ATTESTOR_PRIVATE_KEY?.trim();
  const module = process.env.ZENGAWD_GUARD_MODULE_ADDRESS?.trim();
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk) || !module) return { txHash: null, error: "operator key or ZENGAWD_GUARD_MODULE_ADDRESS not configured" };
  const account = privateKeyToAccount(pk as Hex);
  const pc = publicClient(chainId);
  const wallet = createWalletClient({ account, chain: pc.chain, transport: http(rpcUrl(chainId), { timeout: 15_000 }) });
  try {
    const hash = await wallet.writeContract({
      address: module as Address,
      abi: MODULE_ABI,
      functionName: "execTransaction",
      args: [safe, token, 0n, revocationCalldata(standard, spender), 0],
      chain: pc.chain ?? null,
    });
    return { txHash: hash, error: null };
  } catch (e) {
    return { txHash: null, error: e instanceof Error ? (e.message.split("\n")[0] ?? e.message) : String(e) };
  }
}
