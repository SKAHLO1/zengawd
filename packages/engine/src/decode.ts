import { decodeFunctionData, getAddress, isAddress, maxUint256, parseAbi, slice, type Address, type Hex } from "viem";
import type { ActionKind, DecodedAction } from "./types";

/**
 * Local 4-byte selector table + ABI decoding. No external selector service is ever called.
 * Selectors are derived from the ABI at module load, so the table cannot drift from the signatures.
 */
const ABI = parseAbi([
  // ERC-20
  "function transfer(address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  // ERC-721 / ERC-1155
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  // Uniswap V2-style routers
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  // Uniswap V3
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params)",
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params)",
  // Universal router / multicall
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  "function execute(bytes commands, bytes[] inputs)",
  "function multicall(bytes[] data)",
  "function multicall(uint256 deadline, bytes[] data)",
]);

const SWAP_NAMES = new Set([
  "swapExactTokensForTokens",
  "swapTokensForExactTokens",
  "swapExactETHForTokens",
  "swapExactTokensForETH",
  "swapExactTokensForTokensSupportingFeeOnTransferTokens",
  "exactInputSingle",
  "exactInput",
  "execute",
]);

/** Allowances at or above this are treated as unlimited. */
const UNLIMITED_FLOOR = maxUint256 / 2n;

export function decodeCalldata(to: Address, calldata: Hex): DecodedAction {
  const empty: DecodedAction = {
    kind: "none",
    selector: "0x00000000",
    functionName: null,
    token: null,
    spender: null,
    recipient: null,
    amount: null,
    unlimited: false,
    args: null,
  };
  if (!calldata || calldata === "0x" || calldata.length < 10) return empty;
  const selector = slice(calldata, 0, 4) as Hex;
  let decoded: { functionName: string; args: readonly unknown[] | undefined };
  try {
    decoded = decodeFunctionData({ abi: ABI, data: calldata });
  } catch {
    return { ...empty, kind: "call", selector };
  }
  const args = decoded.args ?? [];
  const name = decoded.functionName;
  const base: DecodedAction = { ...empty, selector, functionName: name, args, kind: kindOf(name), token: null };

  switch (name) {
    case "transfer": {
      const [toArg, amount] = args as [Address, bigint];
      return { ...base, token: to, recipient: addr(toArg), amount };
    }
    case "transferFrom": {
      const [, toArg, amount] = args as [Address, Address, bigint];
      return { ...base, token: to, recipient: addr(toArg), amount };
    }
    case "approve":
    case "increaseAllowance": {
      const [spender, amount] = args as [Address, bigint];
      return { ...base, token: to, spender: addr(spender), amount, unlimited: amount >= UNLIMITED_FLOOR };
    }
    case "permit": {
      const [, spender, value] = args as [Address, Address, bigint];
      return { ...base, kind: "approve", token: to, spender: addr(spender), amount: value, unlimited: value >= UNLIMITED_FLOOR };
    }
    case "setApprovalForAll": {
      const [operator, approved] = args as [Address, boolean];
      return { ...base, token: to, spender: addr(operator), unlimited: approved === true };
    }
    case "safeTransferFrom": {
      const [, toArg] = args as [Address, Address];
      return { ...base, kind: "transfer", token: to, recipient: addr(toArg) };
    }
    case "swapExactTokensForTokens":
    case "swapExactTokensForTokensSupportingFeeOnTransferTokens":
    case "swapExactTokensForETH": {
      const [amountIn, , path, toArg] = args as [bigint, bigint, readonly Address[], Address];
      return { ...base, token: addr(path[0] ?? null), recipient: addr(toArg), amount: amountIn, spender: to };
    }
    case "swapTokensForExactTokens": {
      const [, amountInMax, path, toArg] = args as [bigint, bigint, readonly Address[], Address];
      return { ...base, token: addr(path[0] ?? null), recipient: addr(toArg), amount: amountInMax, spender: to };
    }
    case "swapExactETHForTokens": {
      const [, path, toArg] = args as [bigint, readonly Address[], Address];
      return { ...base, token: addr(path[path.length - 1] ?? null), recipient: addr(toArg), spender: to };
    }
    case "exactInputSingle": {
      const [p] = args as [{ tokenIn: Address; recipient: Address; amountIn: bigint }];
      return { ...base, token: addr(p.tokenIn), recipient: addr(p.recipient), amount: p.amountIn, spender: to };
    }
    case "exactInput": {
      const [p] = args as [{ path: Hex; recipient: Address; amountIn: bigint }];
      const tokenIn = p.path.length >= 42 ? (`0x${p.path.slice(2, 42)}` as Address) : null;
      return { ...base, token: addr(tokenIn), recipient: addr(p.recipient), amount: p.amountIn, spender: to };
    }
    default:
      return base;
  }
}

function kindOf(name: string): ActionKind {
  if (name === "transfer" || name === "transferFrom" || name === "safeTransferFrom") return "transfer";
  if (name === "approve" || name === "increaseAllowance" || name === "permit") return "approve";
  if (name === "setApprovalForAll") return "setApprovalForAll";
  if (SWAP_NAMES.has(name)) return "swap";
  return "call";
}

function addr(a: Address | null | undefined): Address | null {
  if (!a || !isAddress(a)) return null;
  return getAddress(a);
}

export function selectorOf(calldata: Hex): Hex {
  if (!calldata || calldata.length < 10) return "0x00000000";
  return slice(calldata, 0, 4) as Hex;
}
