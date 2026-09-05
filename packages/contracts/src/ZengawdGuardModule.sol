// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ZengawdPolicy} from "./ZengawdPolicy.sol";

/// @dev Minimal Gnosis Safe interface (module execution entry point).
interface ISafe {
    function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation) external returns (bool success);
}

/// @title ZengawdGuardModule
/// @notice Safe module: executes a Safe transaction only when ZengawdPolicy currently allows it for
///         (safe, to, selector). Reverts with a decodable custom error carrying the verdict code and score.
contract ZengawdGuardModule {
    ZengawdPolicy public immutable policy;

    /// @notice Zengawd verdict does not permit this call.
    /// @param code 0 ALLOW, 1 WARN, 2 BLOCK, 3 INSUFFICIENT (also returned for absent or stale verdicts)
    /// @param score verdict score * 100
    error VerdictBlocked(address safe, address to, bytes4 selector, uint8 code, uint16 score);
    error SafeExecutionFailed();
    error NotAuthorized();

    /// @dev Optional per-Safe allowlist of callers permitted to trigger execution through the module.
    mapping(address => mapping(address => bool)) public operators;

    event OperatorSet(address indexed safe, address indexed operator, bool allowed);
    event GuardedExecution(address indexed safe, address indexed to, bytes4 indexed selector, uint8 code, uint16 score);

    constructor(ZengawdPolicy policy_) {
        policy = policy_;
    }

    /// @notice Called by the Safe itself (via a normal Safe tx) to authorise an operator address.
    function setOperator(address operator, bool allowed) external {
        operators[msg.sender][operator] = allowed;
        emit OperatorSet(msg.sender, operator, allowed);
    }

    /// @notice Execute `to.call{value}(data)` from `safe` if and only if the policy allows it.
    function execTransaction(ISafe safe, address to, uint256 value, bytes calldata data, uint8 operation) external returns (bool) {
        if (msg.sender != address(safe) && !operators[address(safe)][msg.sender]) revert NotAuthorized();
        bytes4 selector = data.length >= 4 ? bytes4(data[:4]) : bytes4(0);
        (bool allowed, uint8 code, uint16 score) = policy.checkAllowed(address(safe), to, selector);
        if (!allowed) revert VerdictBlocked(address(safe), to, selector, code, score);
        bool ok = safe.execTransactionFromModule(to, value, data, operation);
        if (!ok) revert SafeExecutionFailed();
        emit GuardedExecution(address(safe), to, selector, code, score);
        return ok;
    }
}
