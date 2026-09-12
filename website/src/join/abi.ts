/** Minimal ClankerIdentity ABI for join mint + fee reads. */
export const clankerIdentityAbi = [
  {
    type: "function",
    name: "operatorFee",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "botFee",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "operators",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "registeredAt", type: "uint64" },
      { name: "revokedAt", type: "uint64" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "bots",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "operatorId", type: "bytes32" },
      { name: "botKey", type: "address" },
      { name: "registeredAt", type: "uint64" },
      { name: "revokedAt", type: "uint64" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registerOperator",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "id", type: "bytes32" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "registerBot",
    inputs: [
      { name: "operatorId", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "botKey", type: "address" },
    ],
    outputs: [{ name: "id", type: "bytes32" }],
    stateMutability: "payable",
  },
] as const;
