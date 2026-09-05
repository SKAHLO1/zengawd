// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ZengawdPolicy} from "../src/ZengawdPolicy.sol";
import {ZengawdGuardModule, ISafe} from "../src/ZengawdGuardModule.sol";

/// @dev Minimal Safe stand-in: executes module calls and records them.
contract MockSafe is ISafe {
    address public lastTo;
    bytes public lastData;
    bool public shouldFail;

    function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8) external returns (bool) {
        if (shouldFail) return false;
        lastTo = to;
        lastData = data;
        (bool ok,) = to.call{value: value}(data);
        return ok;
    }

    function setFail(bool f) external {
        shouldFail = f;
    }

    receive() external payable {}
}

contract Target {
    uint256 public hits;

    function ping() external {
        hits++;
    }
}

contract ZengawdPolicyTest is Test {
    ZengawdPolicy policy;
    ZengawdGuardModule module;
    MockSafe safe;
    Target target;

    address attestor = address(0xA11E);
    address user = address(0xBEEF);
    bytes4 constant SEL = bytes4(keccak256("ping()"));

    function setUp() public {
        policy = new ZengawdPolicy(attestor);
        module = new ZengawdGuardModule(policy);
        safe = new MockSafe();
        target = new Target();
        vm.warp(1_800_000_000);
    }

    function _record(address u, address t, uint8 code, uint16 score, uint64 issuedAt) internal {
        vm.prank(attestor);
        policy.recordVerdict(u, t, SEL, ZengawdPolicy.StoredVerdict({verdictHash: keccak256("v"), verdictCode: code, score: score, issuedAt: issuedAt}));
    }

    function test_allowPath() public {
        _record(user, address(target), 0, 1200, uint64(block.timestamp));
        (bool allowed, uint8 code, uint16 score) = policy.checkAllowed(user, address(target), SEL);
        assertTrue(allowed);
        assertEq(code, 0);
        assertEq(score, 1200);
    }

    function test_warnIsAllowed() public {
        _record(user, address(target), 1, 3500, uint64(block.timestamp));
        (bool allowed,,) = policy.checkAllowed(user, address(target), SEL);
        assertTrue(allowed);
    }

    function test_blockPath() public {
        _record(user, address(target), 2, 8100, uint64(block.timestamp));
        (bool allowed, uint8 code,) = policy.checkAllowed(user, address(target), SEL);
        assertFalse(allowed);
        assertEq(code, 2);
    }

    function test_insufficientIsBlocked() public {
        _record(user, address(target), 3, 0, uint64(block.timestamp));
        (bool allowed,,) = policy.checkAllowed(user, address(target), SEL);
        assertFalse(allowed);
    }

    function test_absentVerdictIsBlocked() public view {
        (bool allowed, uint8 code, uint16 score) = policy.checkAllowed(user, address(target), SEL);
        assertFalse(allowed);
        assertEq(code, 3);
        assertEq(score, 0);
    }

    function test_staleVerdictIsBlocked() public {
        _record(user, address(target), 0, 500, uint64(block.timestamp));
        vm.warp(block.timestamp + 901);
        (bool allowed, uint8 code,) = policy.checkAllowed(user, address(target), SEL);
        assertFalse(allowed);
        assertEq(code, 0);
        // owner extends the window and it becomes valid again
        policy.setMaxVerdictAge(2000);
        (allowed,,) = policy.checkAllowed(user, address(target), SEL);
        assertTrue(allowed);
    }

    function test_unauthorizedAttestorReverts() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(ZengawdPolicy.NotAttestor.selector);
        policy.recordVerdict(user, address(target), SEL, ZengawdPolicy.StoredVerdict(keccak256("v"), 0, 0, uint64(block.timestamp)));
    }

    function test_onlyOwnerSetsMaxAge() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(ZengawdPolicy.NotOwner.selector);
        policy.setMaxVerdictAge(1);
    }

    function test_invalidCodeReverts() public {
        vm.prank(attestor);
        vm.expectRevert(ZengawdPolicy.InvalidCode.selector);
        policy.recordVerdict(user, address(target), SEL, ZengawdPolicy.StoredVerdict(keccak256("v"), 4, 0, uint64(block.timestamp)));
    }

    function test_safeModuleExecutesWhenAllowed() public {
        _record(address(safe), address(target), 0, 900, uint64(block.timestamp));
        vm.prank(address(safe));
        bool ok = module.execTransaction(safe, address(target), 0, abi.encodeWithSelector(SEL), 0);
        assertTrue(ok);
        assertEq(target.hits(), 1);
    }

    function test_safeModuleRevertsWithDecodableErrorOnBlock() public {
        _record(address(safe), address(target), 2, 7250, uint64(block.timestamp));
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ZengawdGuardModule.VerdictBlocked.selector, address(safe), address(target), SEL, uint8(2), uint16(7250)));
        module.execTransaction(safe, address(target), 0, abi.encodeWithSelector(SEL), 0);
        assertEq(target.hits(), 0);
    }

    function test_safeModuleRevertsOnStaleVerdict() public {
        _record(address(safe), address(target), 0, 100, uint64(block.timestamp));
        vm.warp(block.timestamp + 1000);
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ZengawdGuardModule.VerdictBlocked.selector, address(safe), address(target), SEL, uint8(0), uint16(100)));
        module.execTransaction(safe, address(target), 0, abi.encodeWithSelector(SEL), 0);
    }

    function test_safeModuleOperatorAllowlist() public {
        _record(address(safe), address(target), 0, 100, uint64(block.timestamp));
        address bot = address(0xB07);
        vm.prank(bot);
        vm.expectRevert(ZengawdGuardModule.NotAuthorized.selector);
        module.execTransaction(safe, address(target), 0, abi.encodeWithSelector(SEL), 0);
        vm.prank(address(safe));
        module.setOperator(bot, true);
        vm.prank(bot);
        assertTrue(module.execTransaction(safe, address(target), 0, abi.encodeWithSelector(SEL), 0));
    }

    function test_safeModuleSurfacesSafeFailure() public {
        _record(address(safe), address(target), 0, 100, uint64(block.timestamp));
        safe.setFail(true);
        vm.prank(address(safe));
        vm.expectRevert(ZengawdGuardModule.SafeExecutionFailed.selector);
        module.execTransaction(safe, address(target), 0, abi.encodeWithSelector(SEL), 0);
    }
}
