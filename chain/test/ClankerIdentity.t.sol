// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClankerIdentity} from "../src/ClankerIdentity.sol";

contract RevertingReceiver {
    receive() external payable {
        revert();
    }
}

contract ClankerIdentityTest is Test {
    uint256 internal constant OPERATOR_FEE = 0.01 ether;
    uint256 internal constant BOT_FEE = 0.001 ether;

    ClankerIdentity internal reg;
    address internal feeRecipient = address(0xFEE);

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA801);

    function setUp() public {
        reg = new ClankerIdentity(OPERATOR_FEE, BOT_FEE, feeRecipient, address(0));
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _opId(string memory label) internal pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _registerOperator(address actor, string memory label) internal returns (bytes32 id) {
        vm.prank(actor);
        return reg.registerOperator{value: OPERATOR_FEE}(label);
    }

    function _registerBot(address actor, bytes32 opId, string memory label, address botKey)
        internal
        returns (bytes32 id)
    {
        vm.prank(actor);
        return reg.registerBot{value: BOT_FEE}(opId, label, botKey);
    }

    function testConstructorZeroRecipientReverts() public {
        vm.expectRevert(ClankerIdentity.ZeroAddress.selector);
        new ClankerIdentity(OPERATOR_FEE, BOT_FEE, address(0), address(0));
    }

    function testRegisterOperatorWrongFeeReverts() public {
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.WrongFee.selector);
        reg.registerOperator{value: 0}("org.openclaw.alice");

        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.WrongFee.selector);
        reg.registerOperator{value: OPERATOR_FEE + 1}("org.openclaw.alice");
    }

    function testRegisterBotWrongFeeReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");

        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.WrongFee.selector);
        reg.registerBot{value: 0}(opId, "openclaw.france.prod-1", address(0xB07));

        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.WrongFee.selector);
        reg.registerBot{value: BOT_FEE + 1}(opId, "openclaw.france.prod-1", address(0xB07));
    }

    function testRegisterOperatorForwardsFee() public {
        uint256 beforeBal = feeRecipient.balance;
        _registerOperator(alice, "org.openclaw.alice");
        assertEq(feeRecipient.balance, beforeBal + OPERATOR_FEE);
    }

    function testRegisterBotForwardsFee() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        uint256 beforeBal = feeRecipient.balance;
        _registerBot(alice, opId, "openclaw.france.prod-1", address(0xB07));
        assertEq(feeRecipient.balance, beforeBal + BOT_FEE);
    }

    function testRevokeDoesNotRefundFee() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        bytes32 botId = _registerBot(alice, opId, "openclaw.france.prod-1", address(0xB01));
        uint256 afterRegister = feeRecipient.balance;

        vm.prank(alice);
        reg.revokeBot(botId);

        assertEq(feeRecipient.balance, afterRegister);
    }

    function testFeeTransferFailedReverts() public {
        RevertingReceiver reverting = new RevertingReceiver();
        ClankerIdentity paidReg = new ClankerIdentity(OPERATOR_FEE, BOT_FEE, address(reverting), address(0));

        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.FeeTransferFailed.selector);
        paidReg.registerOperator{value: OPERATOR_FEE}("org.openclaw.alice");
    }

    function testFeeTransferFailedRevertsOnBot() public {
        RevertingReceiver reverting = new RevertingReceiver();
        ClankerIdentity paidReg = new ClankerIdentity(0, BOT_FEE, address(reverting), address(0));

        vm.prank(alice);
        bytes32 opId = paidReg.registerOperator{value: 0}("org.openclaw.alice");
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.FeeTransferFailed.selector);
        paidReg.registerBot{value: BOT_FEE}(opId, "openclaw.france.prod-1", address(0xB01));
    }

    function testZeroFeeRegistrationSucceeds() public {
        ClankerIdentity freeReg = new ClankerIdentity(0, 0, feeRecipient, address(0));
        vm.prank(alice);
        bytes32 opId = freeReg.registerOperator{value: 0}("org.openclaw.alice");
        vm.prank(alice);
        bytes32 botId = freeReg.registerBot{value: 0}(opId, "openclaw.france.prod-1", address(0xB01));
        (address owner,,) = freeReg.operators(opId);
        assertEq(owner, alice);
        (bytes32 oid,,,) = freeReg.bots(botId);
        assertEq(oid, opId);
    }

    function testRegisterOperatorHappy() public {
        bytes32 id = _registerOperator(alice, "org.openclaw.alice");
        assertEq(id, _opId("org.openclaw.alice"));
        (address owner, uint64 ra, uint64 rv) = reg.operators(id);
        assertEq(owner, alice);
        assertGt(ra, uint64(0));
        assertEq(rv, uint64(0));
    }

    function testRegisterOperatorDuplicateReverts() public {
        _registerOperator(alice, "org.openclaw.alice");
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.OperatorTaken.selector);
        reg.registerOperator{value: OPERATOR_FEE}("org.openclaw.alice");
    }

    function testProposeAndAcceptTransferHappy() public {
        bytes32 id = _registerOperator(alice, "org.openclaw.alice");
        vm.prank(alice);
        reg.proposeOperatorTransfer(id, bob);
        vm.prank(bob);
        reg.acceptOperatorTransfer(id);
        (address owner,,) = reg.operators(id);
        assertEq(owner, bob);
        assertEq(reg.pendingOperatorOwner(id), address(0));
    }

    function testAcceptTransferWrongAddressReverts() public {
        bytes32 id = _registerOperator(alice, "org.openclaw.alice");
        vm.prank(alice);
        reg.proposeOperatorTransfer(id, bob);
        vm.prank(carol);
        vm.expectRevert(ClankerIdentity.NotProposedOwner.selector);
        reg.acceptOperatorTransfer(id);
    }

    function testRevokeOperatorHappy() public {
        bytes32 id = _registerOperator(alice, "org.openclaw.alice");
        vm.prank(alice);
        reg.revokeOperator(id);
        (,, uint64 rv) = reg.operators(id);
        assertGt(rv, uint64(0));
    }

    function testRevokeOperatorNonOwnerReverts() public {
        bytes32 id = _registerOperator(alice, "org.openclaw.alice");
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.NotOperatorOwner.selector);
        reg.revokeOperator(id);
    }

    function testRegisteredAtUsesBlockTimestamp() public {
        vm.warp(1_700_000_000);
        bytes32 id = _registerOperator(alice, "org.openclaw.alice");
        (, uint64 ra,) = reg.operators(id);
        assertEq(ra, uint64(1_700_000_000));
    }

    function testRegisterBotHappy() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        address botKey = address(0xB07);
        bytes32 botId = _registerBot(alice, opId, "openclaw.france.prod-1", botKey);
        assertEq(botId, keccak256(bytes("openclaw.france.prod-1")));
        (bytes32 oid, address bk, uint64 bra, uint64 brv) = reg.bots(botId);
        assertEq(oid, opId);
        assertEq(bk, botKey);
        assertGt(bra, uint64(0));
        assertEq(brv, uint64(0));
        assertEq(reg.botKeyToId(botKey), botId);
    }

    function testRegisterBotDuplicateIdReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        address k1 = address(0xB01);
        address k2 = address(0xB02);
        _registerBot(alice, opId, "openclaw.france.prod-1", k1);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.BotTaken.selector);
        reg.registerBot{value: BOT_FEE}(opId, "openclaw.france.prod-1", k2);
    }

    function testRegisterBotDuplicateKeyAcrossOperatorsReverts() public {
        bytes32 opA = _registerOperator(alice, "org.openclaw.alice");
        bytes32 opB = _registerOperator(bob, "org.openclaw.bob");
        address shared = address(0x5EEDED);
        _registerBot(alice, opA, "openclaw.france.prod-1", shared);
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.BotKeyInUse.selector);
        reg.registerBot{value: BOT_FEE}(opB, "openclaw.tooter.prod-1", shared);
    }

    function testRotateBotKeyUpdatesReverseMap() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        address k1 = address(0xB01);
        address k2 = address(0xB02);
        bytes32 botId = _registerBot(alice, opId, "openclaw.france.prod-1", k1);
        assertEq(reg.botKeyToId(k1), botId);
        vm.prank(alice);
        reg.rotateBotKey(botId, k2);
        assertEq(reg.botKeyToId(k1), bytes32(0));
        assertEq(reg.botKeyToId(k2), botId);
        (, address bk,,) = reg.bots(botId);
        assertEq(bk, k2);
    }

    function testRotateBotKeyNonOwnerReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        bytes32 botId = _registerBot(alice, opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.NotOperatorOwner.selector);
        reg.rotateBotKey(botId, address(0xB02));
    }

    function testRotateToAlreadyUsedKeyReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        address k1 = address(0xB01);
        address k2 = address(0xB02);
        bytes32 botA = _registerBot(alice, opId, "openclaw.france.prod-1", k1);
        bytes32 botB = _registerBot(alice, opId, "openclaw.tooter.prod-1", k2);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.BotKeyInUse.selector);
        reg.rotateBotKey(botA, k2);
        assertEq(reg.botKeyToId(k2), botB);
    }

    function testRevokeBotNonOwnerReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        bytes32 botId = _registerBot(alice, opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.NotOperatorOwner.selector);
        reg.revokeBot(botId);
    }

    function testRevokeBotClearsBotKeyToId() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        address k = address(0xB01);
        bytes32 botId = _registerBot(alice, opId, "openclaw.france.prod-1", k);
        vm.prank(alice);
        reg.revokeBot(botId);
        assertEq(reg.botKeyToId(k), bytes32(0));
        (,,, uint64 brv) = reg.bots(botId);
        assertGt(brv, uint64(0));
    }

    function testRegisterBotNonExistentOperatorReverts() public {
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorMissing.selector);
        reg.registerBot{value: BOT_FEE}(bytes32(uint256(1)), "openclaw.france.prod-1", address(0xB01));
    }

    function testRegisterBotUnderRevokedOperatorReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        vm.prank(alice);
        reg.revokeOperator(opId);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorNotActive.selector);
        reg.registerBot{value: BOT_FEE}(opId, "openclaw.france.prod-1", address(0xB01));
    }

    function testRotateBotAfterBotRevokedReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        bytes32 botId = _registerBot(alice, opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(alice);
        reg.revokeBot(botId);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.BotNotActive.selector);
        reg.rotateBotKey(botId, address(0xB02));
    }

    function testProposeTransferAfterRevokeReverts() public {
        bytes32 id = _registerOperator(alice, "org.openclaw.alice");
        vm.prank(alice);
        reg.revokeOperator(id);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorNotActive.selector);
        reg.proposeOperatorTransfer(id, bob);
    }

    function testOperatorRevoked_BotRotateReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        bytes32 botId = _registerBot(alice, opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(alice);
        reg.revokeOperator(opId);
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorNotActive.selector);
        reg.rotateBotKey(botId, address(0xB02));
    }

    function testRegisterBotZeroKeyReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.ZeroAddress.selector);
        reg.registerBot{value: BOT_FEE}(opId, "openclaw.france.prod-1", address(0));
    }

    function testRotateBotKeyZeroKeyReverts() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        bytes32 botId = _registerBot(alice, opId, "openclaw.france.prod-1", address(0xB01));
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.ZeroAddress.selector);
        reg.rotateBotKey(botId, address(0));
    }

    function testTwoBotsSameOperator() public {
        bytes32 opId = _registerOperator(alice, "org.openclaw.alice");
        bytes32 b1 = _registerBot(alice, opId, "openclaw.france.prod-1", address(0xB01));
        bytes32 b2 = _registerBot(alice, opId, "openclaw.tooter.prod-1", address(0xB02));
        assertTrue(b1 != b2);
        (bytes32 oid1,,,) = reg.bots(b1);
        (bytes32 oid2,,,) = reg.bots(b2);
        assertEq(oid1, opId);
        assertEq(oid2, opId);
    }
}
