// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ClankerIdentity} from "../src/ClankerIdentity.sol";

contract Deploy is Script {
    function run() external {
        uint256 operatorFee = vm.envUint("OPERATOR_FEE_WEI");
        uint256 botFee = vm.envUint("BOT_FEE_WEI");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");

        vm.startBroadcast();
        ClankerIdentity reg = new ClankerIdentity(operatorFee, botFee, feeRecipient);
        vm.stopBroadcast();

        console2.log("ClankerIdentity deployed at:", address(reg));
        console2.log("operatorFee:", operatorFee);
        console2.log("botFee:", botFee);
        console2.log("feeRecipient:", feeRecipient);
    }
}
