// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ZengawdPolicy} from "../src/ZengawdPolicy.sol";
import {ZengawdGuardModule} from "../src/ZengawdGuardModule.sol";

/// @dev Deploys ZengawdPolicy (attestor = ZENGAWD_ATTESTOR_ADDRESS or the deployer) and the Safe module.
///      Run: forge script script/Deploy.s.sol --rpc-url $RPC_URL_84532 --broadcast --private-key $DEPLOYER_KEY
contract Deploy is Script {
    function run() external {
        address attestor = vm.envOr("ZENGAWD_ATTESTOR_ADDRESS", msg.sender);
        vm.startBroadcast();
        ZengawdPolicy policy = new ZengawdPolicy(attestor);
        ZengawdGuardModule module = new ZengawdGuardModule(policy);
        vm.stopBroadcast();
        console.log("ZengawdPolicy", address(policy));
        console.log("ZengawdGuardModule", address(module));
        console.log("attestor", attestor);
    }
}
