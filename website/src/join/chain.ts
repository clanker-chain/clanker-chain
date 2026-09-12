import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { clankerIdentityAbi } from "./abi";
import {
  CHAIN_RPC_URL,
  SEPOLIA_REGISTRY,
} from "./constants";
import { computeMintBudget, type MintBudget } from "./mint-budget";
import {
  assertOperatorLabel,
  assertSafeBotLabel,
  harnessSnippet,
  labelToId,
} from "./utils";
import { setPendingBotKey } from "./pending-key";

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(CHAIN_RPC_URL),
});

const ZERO = "0x0000000000000000000000000000000000000000";

export async function assessJoinBudget(owner: Address): Promise<MintBudget> {
  const [operatorFee, botFee, balance] = await Promise.all([
    publicClient.readContract({
      address: SEPOLIA_REGISTRY,
      abi: clankerIdentityAbi,
      functionName: "operatorFee",
    }),
    publicClient.readContract({
      address: SEPOLIA_REGISTRY,
      abi: clankerIdentityAbi,
      functionName: "botFee",
    }),
    publicClient.getBalance({ address: owner }),
  ]);

  return computeMintBudget({
    operatorFee: BigInt(operatorFee),
    botFee: BigInt(botFee),
    balance: BigInt(balance),
    needOperatorFee: true,
    needBotFee: true,
  });
}

export async function walletClientFromProvider(
  provider: ethereumProvider,
  address: Address,
): Promise<WalletClient> {
  return createWalletClient({
    account: address,
    chain: baseSepolia,
    transport: custom(provider),
  });
}

type ethereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

async function waitOk(hash: Hex): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Transaction failed on chain");
  }
}

/** Public Facts returned to React — never includes the bot private key. */
export type MintResult = {
  operatorLabel: string;
  botLabel: string;
  botAddress: Address;
  operatorTx: Hex | null;
  botTx: Hex;
  channelsMqtt: Record<string, unknown>;
};

export async function mintOperatorAndBot(opts: {
  walletClient: WalletClient;
  owner: Address;
  operatorLabel: string;
  botLabel: string;
  onProgress?: (phase: "operator" | "bot") => void;
}): Promise<MintResult> {
  assertOperatorLabel(opts.operatorLabel);
  assertSafeBotLabel(opts.botLabel);

  const operatorLabel = opts.operatorLabel.trim();
  const botLabel = opts.botLabel.trim();
  const operatorId = labelToId(operatorLabel);

  const existing = await publicClient.readContract({
    address: SEPOLIA_REGISTRY,
    abi: clankerIdentityAbi,
    functionName: "operators",
    args: [operatorId],
  });
  const existingOwner = existing[0]?.toLowerCase?.() ?? ZERO;
  const ownerLower = opts.owner.toLowerCase();
  const operatorAlreadyOurs =
    existingOwner !== ZERO && existingOwner === ownerLower;
  if (existingOwner !== ZERO && !operatorAlreadyOurs) {
    throw new Error(
      `That name is already taken on this registry. Pick another.`,
    );
  }

  const botExisting = await publicClient.readContract({
    address: SEPOLIA_REGISTRY,
    abi: clankerIdentityAbi,
    functionName: "bots",
    args: [labelToId(botLabel)],
  });
  // ABI: operatorId, botKey, registeredAt, revokedAt
  const existingBotKey = botExisting[1];
  if (existingBotKey && existingBotKey.toLowerCase() !== ZERO) {
    throw new Error(
      `That computer name is already taken. Pick another (example: you.laptop).`,
    );
  }

  const [operatorFee, botFee] = await Promise.all([
    publicClient.readContract({
      address: SEPOLIA_REGISTRY,
      abi: clankerIdentityAbi,
      functionName: "operatorFee",
    }),
    publicClient.readContract({
      address: SEPOLIA_REGISTRY,
      abi: clankerIdentityAbi,
      functionName: "botFee",
    }),
  ]);

  const botPrivateKey = generatePrivateKey();
  const botAccount = privateKeyToAccount(botPrivateKey);

  let operatorTx: Hex | null = null;
  if (!operatorAlreadyOurs) {
    opts.onProgress?.("operator");
    operatorTx = await opts.walletClient.writeContract({
      account: opts.owner,
      chain: baseSepolia,
      address: SEPOLIA_REGISTRY,
      abi: clankerIdentityAbi,
      functionName: "registerOperator",
      args: [operatorLabel],
      value: BigInt(operatorFee),
    });
    await waitOk(operatorTx);
  }

  opts.onProgress?.("bot");
  const botTx = await opts.walletClient.writeContract({
    account: opts.owner,
    chain: baseSepolia,
    address: SEPOLIA_REGISTRY,
    abi: clankerIdentityAbi,
    functionName: "registerBot",
    args: [operatorId, botLabel, botAccount.address],
    value: BigInt(botFee),
  });
  await waitOk(botTx);

  // Hold hex outside React; caller downloads once then user confirms saved.
  setPendingBotKey(botLabel, botPrivateKey);

  return {
    operatorLabel,
    botLabel,
    botAddress: botAccount.address,
    operatorTx,
    botTx,
    channelsMqtt: harnessSnippet({
      botId: botLabel,
      operatorId: operatorLabel,
    }),
  };
}
