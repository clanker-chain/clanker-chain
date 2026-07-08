/** Minimal ClankerIdentity ABI for clanker-cli (see chain/src/ClankerIdentity.sol). */
export const clankerIdentityAbi = [
  {
    type: "function",
    name: "operatorFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "botFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "registerOperator",
    stateMutability: "payable",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "id", type: "bytes32" }],
  },
  {
    type: "function",
    name: "registerBot",
    stateMutability: "payable",
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
