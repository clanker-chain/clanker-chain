// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ClankerIdentity} from "../src/ClankerIdentity.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        ClankerIdentity reg = new ClankerIdentity();
        vm.stopBroadcast();
        console2.log("ClankerIdentity deployed at:", address(reg));
    }
}
