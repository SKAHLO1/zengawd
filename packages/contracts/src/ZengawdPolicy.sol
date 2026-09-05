// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ZengawdPolicy
/// @notice Stores attested risk verdicts (hash, code, score) per (user, target, selector) and answers
///         whether execution is currently allowed. The full verdict payload never touches the chain.
contract ZengawdPolicy {
    struct StoredVerdict {
        bytes32 verdictHash;
        uint8 verdictCode; // 0 ALLOW, 1 WARN, 2 BLOCK, 3 INSUFFICIENT
        uint16 score; // score * 100 (0..10000)
        uint64 issuedAt; // unix seconds
    }

    uint8 public constant CODE_ALLOW = 0;
    uint8 public constant CODE_WARN = 1;
    uint8 public constant CODE_BLOCK = 2;
    uint8 public constant CODE_INSUFFICIENT = 3;

    address public owner;
    address public attestor;
    uint64 public maxVerdictAge = 900;

    mapping(bytes32 => StoredVerdict) private verdicts;

    event VerdictRecorded(address indexed user, address indexed target, bytes4 indexed selector, bytes32 verdictHash, uint8 verdictCode, uint16 score, uint64 issuedAt);
    event AttestorChanged(address indexed previous, address indexed next);
    event MaxVerdictAgeChanged(uint64 seconds_);
    event OwnershipTransferred(address indexed previous, address indexed next);

    error NotOwner();
    error NotAttestor();
    error InvalidCode();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttestor() {
        if (msg.sender != attestor) revert NotAttestor();
        _;
    }

    constructor(address attestor_) {
        if (attestor_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        attestor = attestor_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit AttestorChanged(address(0), attestor_);
    }

    function key(address user, address target, bytes4 selector) public pure returns (bytes32) {
        return keccak256(abi.encode(user, target, selector));
    }

    function recordVerdict(address user, address target, bytes4 selector, StoredVerdict calldata v) external onlyAttestor {
        if (v.verdictCode > CODE_INSUFFICIENT) revert InvalidCode();
        verdicts[key(user, target, selector)] = v;
        emit VerdictRecorded(user, target, selector, v.verdictHash, v.verdictCode, v.score, v.issuedAt);
    }

    /// @return allowed false when the stored verdict is BLOCK, INSUFFICIENT, absent, or older than maxVerdictAge.
    function checkAllowed(address user, address target, bytes4 selector) external view returns (bool allowed, uint8 code, uint16 score) {
        StoredVerdict memory v = verdicts[key(user, target, selector)];
        if (v.issuedAt == 0) return (false, CODE_INSUFFICIENT, 0);
        bool fresh = v.issuedAt <= block.timestamp && block.timestamp - v.issuedAt <= maxVerdictAge;
        bool okCode = v.verdictCode == CODE_ALLOW || v.verdictCode == CODE_WARN;
        return (fresh && okCode, v.verdictCode, v.score);
    }

    function getVerdict(address user, address target, bytes4 selector) external view returns (StoredVerdict memory) {
        return verdicts[key(user, target, selector)];
    }

    function setMaxVerdictAge(uint64 seconds_) external onlyOwner {
        maxVerdictAge = seconds_;
        emit MaxVerdictAgeChanged(seconds_);
    }

    function setAttestor(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit AttestorChanged(attestor, next);
        attestor = next;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }
}
