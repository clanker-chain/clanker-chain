// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClankerIdentity} from "../src/ClankerIdentity.sol";

contract ClankerIdentityTest is Test {
    ClankerIdentity internal reg;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA801);

    function setUp() public {
        reg = new ClankerIdentity();
    }

    function _opId(string memory label) internal pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function testRegisterOperatorHappy() public {
        vm.prank(alice);
        bytes32 id = reg.registerOperator("org.openclaw.alice");
        assertEq(id, _opId("org.openclaw.alice"));
        (address owner, uint64 ra, uint64 rv) = reg.operators(id);
        assertEq(owner, alice);
        assertGt(ra, uint64(0));
        assertEq(rv, uint64(0));
    }

    function testRegisterOperatorDuplicateReverts() public {
        vm.prank(alice);
        reg.registerOperator("org.openclaw.alice");
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.OperatorTaken.selector);
        reg.registerOperator("org.openclaw.alice");
    }

    function testProposeAndAcceptTransferHappy() public {
        vm.prank(alice);
        bytes32 id = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        reg.proposeOperatorTransfer(id, bob);
        vm.prank(bob);
        reg.acceptOperatorTransfer(id);
        (address owner,,) = reg.operators(id);
        assertEq(owner, bob);
        assertEq(reg.pendingOperatorOwner(id), address(0));
    }

    function testAcceptTransferWrongAddressReverts() public {
        vm.prank(alice);
        bytes32 id = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        reg.proposeOperatorTransfer(id, bob);
        vm.prank(carol);
        vm.expectRevert(ClankerIdentity.NotProposedOwner.selector);
        reg.acceptOperatorTransfer(id);
    }

    function testRevokeOperatorHappy() public {
        vm.prank(alice);
        bytes32 id = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        reg.revokeOperator(id);
        (,, uint64 rv) = reg.operators(id);
        assertGt(rv, uint64(0));
    }

    function testRevokeOperatorNonOwnerReverts() public {
        vm.prank(alice);
        bytes32 id = reg.registerOperator("org.openclaw.alice");
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.NotOperatorOwner.selector);
        reg.revokeOperator(id);
    }

    function testRegisteredAtUsesBlockTimestamp() public {
        vm.warp(1_700_000_000);
        vm.prank(alice);
        bytes32 id = reg.registerOperator("org.openclaw.alice");
        (, uint64 ra,) = reg.operators(id);
        assertEq(ra, uint64(1_700_000_000));
    }

    function testRegisterBotHappy() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        address botKey = address(0xB07);
        vm.prank(alice);
        bytes32 botId = reg.registerBot(opId, "openclaw.france.prod-1", botKey);
        assertEq(botId, keccak256(bytes("openclaw.france.prod-1")));
        (bytes32 oid, address bk, uint64 bra, uint64 brv) = reg.bots(botId);
        assertEq(oid, opId);
        assertEq(bk, botKey);
        assertGt(bra, uint64(0));
        assertEq(brv, uint64(0));
        assertEq(reg.botKeyToId(botKey), botId);
    }

    function testRegisterBotDuplicateIdReverts() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        address k1 = address(0xB01);
        address k2 = address(0xB02);
        vm.prank(alice);
        reg.registerBot(opId, "openclaw.france.prod-1", k1);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.BotTaken.selector);
        reg.registerBot(opId, "openclaw.france.prod-1", k2);
    }

    function testRegisterBotDuplicateKeyAcrossOperatorsReverts() public {
        vm.prank(alice);
        bytes32 opA = reg.registerOperator("org.openclaw.alice");
        vm.prank(bob);
        bytes32 opB = reg.registerOperator("org.openclaw.bob");
        address shared = address(0x5EEDED);
        vm.prank(alice);
        reg.registerBot(opA, "openclaw.france.prod-1", shared);
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.BotKeyInUse.selector);
        reg.registerBot(opB, "openclaw.tooter.prod-1", shared);
    }

    function testRotateBotKeyUpdatesReverseMap() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        address k1 = address(0xB01);
        address k2 = address(0xB02);
        vm.prank(alice);
        bytes32 botId = reg.registerBot(opId, "openclaw.france.prod-1", k1);
        assertEq(reg.botKeyToId(k1), botId);
        vm.prank(alice);
        reg.rotateBotKey(botId, k2);
        assertEq(reg.botKeyToId(k1), bytes32(0));
        assertEq(reg.botKeyToId(k2), botId);
        (, address bk,,) = reg.bots(botId);
        assertEq(bk, k2);
    }

    function testRotateBotKeyNonOwnerReverts() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        bytes32 botId = reg.registerBot(opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.NotOperatorOwner.selector);
        reg.rotateBotKey(botId, address(0xB02));
    }

    function testRotateToAlreadyUsedKeyReverts() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        address k1 = address(0xB01);
        address k2 = address(0xB02);
        vm.prank(alice);
        bytes32 botA = reg.registerBot(opId, "openclaw.france.prod-1", k1);
        vm.prank(alice);
        bytes32 botB = reg.registerBot(opId, "openclaw.tooter.prod-1", k2);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.BotKeyInUse.selector);
        reg.rotateBotKey(botA, k2);
        assertEq(reg.botKeyToId(k2), botB);
    }

    function testRevokeBotNonOwnerReverts() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        bytes32 botId = reg.registerBot(opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.NotOperatorOwner.selector);
        reg.revokeBot(botId);
    }

    function testRevokeBotClearsBotKeyToId() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        address k = address(0xB01);
        vm.prank(alice);
        bytes32 botId = reg.registerBot(opId, "openclaw.france.prod-1", k);
        vm.prank(alice);
        reg.revokeBot(botId);
        assertEq(reg.botKeyToId(k), bytes32(0));
        (,,, uint64 brv) = reg.bots(botId);
        assertGt(brv, uint64(0));
    }

    function testRegisterBotNonExistentOperatorReverts() public {
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorMissing.selector);
        reg.registerBot(bytes32(uint256(1)), "openclaw.france.prod-1", address(0xB01));
    }

    function testRegisterBotUnderRevokedOperatorReverts() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        reg.revokeOperator(opId);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorNotActive.selector);
        reg.registerBot(opId, "openclaw.france.prod-1", address(0xB01));
    }

    function testRotateBotAfterBotRevokedReverts() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        bytes32 botId = reg.registerBot(opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(alice);
        reg.revokeBot(botId);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.BotNotActive.selector);
        reg.rotateBotKey(botId, address(0xB02));
    }

    function testProposeTransferAfterRevokeReverts() public {
        vm.prank(alice);
        bytes32 id = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        reg.revokeOperator(id);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorNotActive.selector);
        reg.proposeOperatorTransfer(id, bob);
    }

    function testOperatorRevoked_BotRotateReverts() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        bytes32 botId = reg.registerBot(opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(alice);
        reg.revokeOperator(opId);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorNotActive.selector);
        reg.rotateBotKey(botId, address(0xB02));
    }

    function testRegisterBotZeroKeyReverts() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.ZeroAddress.selector);
        reg.registerBot(opId, "openclaw.france.prod-1", address(0));
    }

    function testRotateBotKeyZeroKeyReverts() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        bytes32 botId = reg.registerBot(opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.ZeroAddress.selector);
        reg.rotateBotKey(botId, address(0));
    }

    function testTwoBotsSameOperator() public {
        vm.prank(alice);
        bytes32 opId = reg.registerOperator("org.openclaw.alice");
        vm.prank(alice);
        bytes32 b1 = reg.registerBot(opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(alice);
        bytes32 b2 = reg.registerBot(opId, "openclaw.tooter.prod-1", address(0xB02));
        assertTrue(b1 != b2);
        (bytes32 oid1,,,) = reg.bots(b1);
        (bytes32 oid2,,,) = reg.bots(b2);
        assertEq(oid1, opId);
        assertEq(oid2, opId);
    }
}
