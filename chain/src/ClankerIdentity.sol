// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClankerIdentity} from "./IClankerIdentity.sol";

/// @title ClankerIdentity
/// @notice Public-good Facts registry: operator ownership, bot keys, revoke.
///         No metadata, reputation, or allow-lists — pairing and “who may talk
///         to whom” belong in products (docs/trust-model.md). Fees are a
///         sunk-cost filter (docs/registration-economics.md), not authorization.
///         `priorRegistry` walks predecessors so a successor cannot usurp
///         labels (docs/registry-lifecycle.md).
contract ClankerIdentity is IClankerIdentity {
    uint256 private constant MAX_PRIOR_HOPS = 16;

    struct Operator {
        address owner;
        uint64 registeredAt;
        uint64 revokedAt;
    }

    struct Bot {
        bytes32 operatorId;
        address botKey;
        uint64 registeredAt;
        uint64 revokedAt;
    }

    uint256 public immutable operatorFee;
    uint256 public immutable botFee;
    address public immutable feeRecipient;
    /// @notice Immediate predecessor on this chain, or zero for genesis.
    address public immutable override priorRegistry;

    mapping(bytes32 => Operator) public override operators;
    mapping(bytes32 => Bot) public override bots;
    mapping(bytes32 => address) public pendingOperatorOwner;
    mapping(address => bytes32) public botKeyToId;

    event OperatorRegistered(bytes32 indexed id, address indexed owner, string label);
    event OperatorTransferProposed(bytes32 indexed id, address indexed proposed);
    event OperatorTransferred(bytes32 indexed id, address indexed oldOwner, address indexed newOwner);
    event OperatorRevoked(bytes32 indexed id);
    event BotRegistered(bytes32 indexed id, bytes32 indexed operatorId, address indexed botKey, string label);
    event BotKeyRotated(bytes32 indexed id, address indexed oldKey, address indexed newKey);
    event BotRevoked(bytes32 indexed id);

    error OperatorTaken();
    error BotTaken();
    error BotKeyInUse();
    error NotOperatorOwner();
    error NotProposedOwner();
    error ZeroAddress();
    error OperatorMissing();
    error OperatorNotActive();
    error BotMissing();
    error BotNotActive();
    error WrongFee();
    error FeeTransferFailed();

    constructor(uint256 _operatorFee, uint256 _botFee, address _feeRecipient, address _priorRegistry) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_priorRegistry == address(this)) revert ZeroAddress();
        operatorFee = _operatorFee;
        botFee = _botFee;
        feeRecipient = _feeRecipient;
        priorRegistry = _priorRegistry;
    }

    function registerOperator(string calldata label) external payable returns (bytes32 id) {
        if (msg.value != operatorFee) revert WrongFee();
        id = keccak256(bytes(label));
        if (operators[id].registeredAt != 0) revert OperatorTaken();
        _enforcePriorOperator(id);
        operators[id] = Operator({owner: msg.sender, registeredAt: uint64(block.timestamp), revokedAt: 0});
        emit OperatorRegistered(id, msg.sender, label);
        _forwardFee();
    }

    function proposeOperatorTransfer(bytes32 id, address newOwner) external {
        Operator storage op = operators[id];
        if (op.registeredAt == 0) revert OperatorMissing();
        if (op.revokedAt != 0) revert OperatorNotActive();
        if (msg.sender != op.owner) revert NotOperatorOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOperatorOwner[id] = newOwner;
        emit OperatorTransferProposed(id, newOwner);
    }

    function acceptOperatorTransfer(bytes32 id) external {
        address pending = pendingOperatorOwner[id];
        if (pending == address(0)) revert NotProposedOwner();
        if (msg.sender != pending) revert NotProposedOwner();
        Operator storage op = operators[id];
        address oldOwner = op.owner;
        op.owner = pending;
        pendingOperatorOwner[id] = address(0);
        emit OperatorTransferred(id, oldOwner, pending);
    }

    function revokeOperator(bytes32 id) external {
        Operator storage op = operators[id];
        if (op.registeredAt == 0) revert OperatorMissing();
        if (op.revokedAt != 0) revert OperatorNotActive();
        if (msg.sender != op.owner) revert NotOperatorOwner();
        op.revokedAt = uint64(block.timestamp);
        pendingOperatorOwner[id] = address(0);
        emit OperatorRevoked(id);
    }

    function registerBot(bytes32 operatorId, string calldata label, address botKey)
        external
        payable
        returns (bytes32 id)
    {
        if (msg.value != botFee) revert WrongFee();
        if (botKey == address(0)) revert ZeroAddress();
        Operator storage op = operators[operatorId];
        if (op.registeredAt == 0) revert OperatorMissing();
        if (op.revokedAt != 0) revert OperatorNotActive();
        if (msg.sender != op.owner) revert NotOperatorOwner();

        id = keccak256(bytes(label));
        if (bots[id].registeredAt != 0) revert BotTaken();
        _enforcePriorBot(id, operatorId);

        if (botKeyToId[botKey] != bytes32(0)) revert BotKeyInUse();

        bots[id] = Bot({
            operatorId: operatorId,
            botKey: botKey,
            registeredAt: uint64(block.timestamp),
            revokedAt: 0
        });
        botKeyToId[botKey] = id;
        emit BotRegistered(id, operatorId, botKey, label);
        _forwardFee();
    }

    function rotateBotKey(bytes32 botId, address newKey) external {
        if (newKey == address(0)) revert ZeroAddress();
        Bot storage b = bots[botId];
        if (b.registeredAt == 0) revert BotMissing();
        if (b.revokedAt != 0) revert BotNotActive();

        Operator storage op = operators[b.operatorId];
        if (op.registeredAt == 0) revert OperatorMissing();
        if (op.revokedAt != 0) revert OperatorNotActive();
        if (msg.sender != op.owner) revert NotOperatorOwner();

        bytes32 conflict = botKeyToId[newKey];
        if (conflict != bytes32(0) && conflict != botId) revert BotKeyInUse();

        address oldKey = b.botKey;
        if (oldKey != address(0)) {
            botKeyToId[oldKey] = bytes32(0);
        }
        b.botKey = newKey;
        botKeyToId[newKey] = botId;
        emit BotKeyRotated(botId, oldKey, newKey);
    }

    function revokeBot(bytes32 botId) external {
        Bot storage b = bots[botId];
        if (b.registeredAt == 0) revert BotMissing();
        if (b.revokedAt != 0) revert BotNotActive();

        Operator storage op = operators[b.operatorId];
        if (op.registeredAt == 0) revert OperatorMissing();
        if (op.revokedAt != 0) revert OperatorNotActive();
        if (msg.sender != op.owner) revert NotOperatorOwner();

        address k = b.botKey;
        if (k != address(0)) {
            botKeyToId[k] = bytes32(0);
        }
        b.revokedAt = uint64(block.timestamp);
        emit BotRevoked(botId);
    }

    function _enforcePriorOperator(bytes32 id) private view {
        address p = priorRegistry;
        for (uint256 i = 0; i < MAX_PRIOR_HOPS && p != address(0); i++) {
            (address owner, uint64 registeredAt, uint64 revokedAt) = IClankerIdentity(p).operators(id);
            if (registeredAt != 0) {
                if (revokedAt != 0 || owner != msg.sender) revert OperatorTaken();
                return;
            }
            p = IClankerIdentity(p).priorRegistry();
        }
    }

    function _enforcePriorBot(bytes32 id, bytes32 operatorId) private view {
        address p = priorRegistry;
        for (uint256 i = 0; i < MAX_PRIOR_HOPS && p != address(0); i++) {
            (bytes32 priorOp, , uint64 registeredAt, uint64 revokedAt) = IClankerIdentity(p).bots(id);
            if (registeredAt != 0) {
                if (revokedAt != 0 || priorOp != operatorId) revert BotTaken();
                (address owner, uint64 ora, uint64 orv) = IClankerIdentity(p).operators(priorOp);
                if (ora == 0 || orv != 0 || owner != msg.sender) revert BotTaken();
                return;
            }
            p = IClankerIdentity(p).priorRegistry();
        }
    }

    function _forwardFee() private {
        if (msg.value == 0) return;
        (bool ok,) = feeRecipient.call{value: msg.value}("");
        if (!ok) revert FeeTransferFailed();
    }
}
