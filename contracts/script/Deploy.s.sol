// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {VendoVault} from "../src/VendoVault.sol";

/// forge script script/Deploy.s.sol --rpc-url $XLAYER_RPC --private-key $DEPLOYER_KEY --broadcast
contract Deploy is Script {
    function run() external {
        address token = vm.envAddress("VAULT_TOKEN");       // USDT0 on the chosen X Layer network
        address owner_ = vm.envAddress("VAULT_OWNER");      // the business wallet
        address operator_ = vm.envAddress("VAULT_OPERATOR"); // Vendo automation wallet
        uint256 buffer_ = vm.envOr("VAULT_BUFFER", uint256(50e6));
        uint256 daily_ = vm.envOr("VAULT_DAILY_LIMIT", uint256(500e6));
        vm.startBroadcast();
        VendoVault v = new VendoVault(token, owner_, operator_, buffer_, daily_);
        vm.stopBroadcast();
        console.log("VendoVault", address(v));
    }
}
