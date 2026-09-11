// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClankerIdentity} from "../src/ClankerIdentity.sol";

/// No-usurpation across successor pins (docs/registry-lifecycle.md).
contract PriorRegistryTest is Test {
    uint256 internal constant FEE = 0.01 ether;

    ClankerIdentity internal v1;
    ClankerIdentity internal v2;
    address internal feeRecipient = address(0xFEE);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        v1 = new ClankerIdentity(FEE, FEE, feeRecipient, address(0));
        v2 = new ClankerIdentity(FEE, FEE, feeRecipient, address(v1));
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function testGenesisPriorIsZero() public view {
        assertEq(v1.priorRegistry(), address(0));
        assertEq(v2.priorRegistry(), address(v1));
    }

    function testStrangerCannotTakePriorOperator() public {
        vm.prank(alice);
        v1.registerOperator{value: FEE}("org.alice");

        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.OperatorTaken.selector);
        v2.registerOperator{value: FEE}("org.alice");
    }

    function testPriorOwnerCanClaimOperator() public {
        vm.prank(alice);
        bytes32 id = v1.registerOperator{value: FEE}("org.alice");

        vm.prank(alice);
        bytes32 id2 = v2.registerOperator{value: FEE}("org.alice");
        assertEq(id, id2);
        (address owner,,) = v2.operators(id);
        assertEq(owner, alice);
    }

    function testFreshLabelStillOpenOnSuccessor() public {
        vm.prank(bob);
        bytes32 id = v2.registerOperator{value: FEE}("org.bob");
        (address owner,,) = v2.operators(id);
        assertEq(owner, bob);
    }

    function testTombstoneCannotBeReopened() public {
        vm.prank(alice);
        bytes32 id = v1.registerOperator{value: FEE}("org.alice");
        vm.prank(alice);
        v1.revokeOperator(id);

        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorTaken.selector);
        v2.registerOperator{value: FEE}("org.alice");

        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.OperatorTaken.selector);
        v2.registerOperator{value: FEE}("org.alice");
    }

    function testClaimFollowsPriorTransfer() public {
        vm.prank(alice);
        bytes32 id = v1.registerOperator{value: FEE}("org.alice");
        vm.prank(alice);
        v1.proposeOperatorTransfer(id, bob);
        vm.prank(bob);
        v1.acceptOperatorTransfer(id);

        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.OperatorTaken.selector);
        v2.registerOperator{value: FEE}("org.alice");

        vm.prank(bob);
        v2.registerOperator{value: FEE}("org.alice");
        (address owner,,) = v2.operators(id);
        assertEq(owner, bob);
    }

    function testUnclaimedPriorStillBlocksAfterTime() public {
        vm.prank(alice);
        v1.registerOperator{value: FEE}("org.alice");
        vm.warp(block.timestamp + 365 days);
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.OperatorTaken.selector);
        v2.registerOperator{value: FEE}("org.alice");
    }

    function testBotClaimRequiresSameOperatorAndOwner() public {
        vm.prank(alice);
        bytes32 opId = v1.registerOperator{value: FEE}("org.alice");
        vm.prank(alice);
        v1.registerBot{value: FEE}(opId, "alice.laptop", address(0xB01));

        vm.prank(bob);
        bytes32 bobOp = v2.registerOperator{value: FEE}("org.bob");
        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.BotTaken.selector);
        v2.registerBot{value: FEE}(bobOp, "alice.laptop", address(0xB02));

        vm.prank(alice);
        v2.registerOperator{value: FEE}("org.alice");
        vm.prank(alice);
        v2.registerBot{value: FEE}(opId, "alice.laptop", address(0xB03));
        (, address key,,) = v2.bots(keccak256(bytes("alice.laptop")));
        assertEq(key, address(0xB03));
    }

    function testRevokedPriorBotStaysDead() public {
        vm.prank(alice);
        bytes32 opId = v1.registerOperator{value: FEE}("org.alice");
        vm.prank(alice);
        bytes32 botId = v1.registerBot{value: FEE}(opId, "alice.laptop", address(0xB01));
        vm.prank(alice);
        v1.revokeBot(botId);

        vm.prank(alice);
        v2.registerOperator{value: FEE}("org.alice");
        vm.prank(alice);
        vm.expectRevert(ClankerIdentity.BotTaken.selector);
        v2.registerBot{value: FEE}(opId, "alice.laptop", address(0xB09));
    }

    function testWalkTwoPriors() public {
        vm.prank(alice);
        v1.registerOperator{value: FEE}("org.alice");
        ClankerIdentity v3 = new ClankerIdentity(FEE, FEE, feeRecipient, address(v2));
        vm.deal(alice, 100 ether);

        vm.prank(bob);
        vm.expectRevert(ClankerIdentity.OperatorTaken.selector);
        v3.registerOperator{value: FEE}("org.alice");

        vm.prank(alice);
        v3.registerOperator{value: FEE}("org.alice");
        (address owner,,) = v3.operators(keccak256(bytes("org.alice")));
        assertEq(owner, alice);
    }
}
