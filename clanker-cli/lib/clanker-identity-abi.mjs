/** Minimal ClankerIdentity ABI for clanker-cli (see chain/src/ClankerIdentity.sol). */
export const clankerIdentityAbi = [
  {
    type: "function",
    name: "registerOperator",
    stateMutability: "nonpayable",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "id", type: "bytes32" }],
  },
  {
    type: "function",
    name: "registerBot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operatorId", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "botKey", type: "address" },
    ],
    outputs: [{ name: "id", type: "bytes32" }],
  },
  {
    type: "function",
    name: "rotateBotKey",
    stateMutability: "nonpayable",
    inputs: [
      { name: "botId", type: "bytes32" },
      { name: "newKey", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeBot",
    stateMutability: "nonpayable",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [],
  },
];
