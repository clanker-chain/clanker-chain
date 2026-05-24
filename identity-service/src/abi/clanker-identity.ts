/**
 * Hand-authored ABI for ClankerIdentity (see `chain/src/ClankerIdentity.sol`).
 * Avoids a Foundry build dependency in identity-service.
 */
export const clankerIdentityAbi = [
  {
    type: "function",
    name: "registerOperator",
    stateMutability: "nonpayable",
    inputs: [{ name: "label", type: "string", internalType: "string" }],
    outputs: [{ name: "id", type: "bytes32", internalType: "bytes32" }],
  },
  {
    type: "function",
    name: "registerBot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operatorId", type: "bytes32", internalType: "bytes32" },
      { name: "label", type: "string", internalType: "string" },
      { name: "botKey", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "id", type: "bytes32", internalType: "bytes32" }],
  },
  {
    type: "function",
    name: "rotateBotKey",
    stateMutability: "nonpayable",
    inputs: [
      { name: "botId", type: "bytes32", internalType: "bytes32" },
      { name: "newKey", type: "address", internalType: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeBot",
    stateMutability: "nonpayable",
    inputs: [{ name: "botId", type: "bytes32", internalType: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "proposeOperatorTransfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32", internalType: "bytes32" },
      { name: "newOwner", type: "address", internalType: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "acceptOperatorTransfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32", internalType: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeOperator",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32", internalType: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "operators",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "owner", type: "address", internalType: "address" },
      { name: "registeredAt", type: "uint64", internalType: "uint64" },
      { name: "revokedAt", type: "uint64", internalType: "uint64" },
    ],
  },
  {
    type: "function",
    name: "bots",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "operatorId", type: "bytes32", internalType: "bytes32" },
      { name: "botKey", type: "address", internalType: "address" },
      { name: "registeredAt", type: "uint64", internalType: "uint64" },
      { name: "revokedAt", type: "uint64", internalType: "uint64" },
    ],
  },
  {
    type: "function",
    name: "botKeyToId",
    stateMutability: "view",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
  },
  {
    type: "event",
    name: "OperatorRegistered",
    inputs: [
      { name: "id", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "owner", type: "address", indexed: true, internalType: "address" },
      { name: "label", type: "string", indexed: false, internalType: "string" },
    ],
  },
  {
    type: "event",
    name: "OperatorTransferred",
    inputs: [
      { name: "id", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "oldOwner", type: "address", indexed: true, internalType: "address" },
      { name: "newOwner", type: "address", indexed: true, internalType: "address" },
    ],
  },
  {
    type: "event",
    name: "OperatorRevoked",
    inputs: [{ name: "id", type: "bytes32", indexed: true, internalType: "bytes32" }],
  },
  {
    type: "event",
    name: "BotRegistered",
    inputs: [
      { name: "id", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "operatorId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "botKey", type: "address", indexed: true, internalType: "address" },
      { name: "label", type: "string", indexed: false, internalType: "string" },
    ],
  },
  {
    type: "event",
    name: "BotKeyRotated",
    inputs: [
      { name: "id", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "oldKey", type: "address", indexed: true, internalType: "address" },
      { name: "newKey", type: "address", indexed: true, internalType: "address" },
    ],
  },
  {
    type: "event",
    name: "BotRevoked",
    inputs: [{ name: "id", type: "bytes32", indexed: true, internalType: "bytes32" }],
  },
] as const;
