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
  MQTT_AUTH_SERVICE_URL,
  SEPOLIA_REGISTRY,
  SMOKE_OPERATOR,
} from "./constants";
import { computeMintBudget, type MintBudget } from "./mint-budget";
import {
  assertOperatorLabel,
  assertSafeBotLabel,
  harnessSnippet,
  labelToId,
} from "./utils";

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

export type MintResult = {
  operatorLabel: string;
  botLabel: string;
  botPrivateKey: Hex;
  botAddress: Address;
  operatorTx: Hex;
  botTx: Hex;
  channelsMqtt: Record<string, unknown>;
};

export async function mintOperatorAndBot(opts: {
  walletClient: WalletClient;
  owner: Address;
  operatorLabel: string;
  botLabel: string;
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
  if (existing[0] && existing[0].toLowerCase() !== ZERO) {
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
  if (botExisting[0] && botExisting[0].toLowerCase() !== ZERO) {
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

  const operatorTx = await opts.walletClient.writeContract({
    account: opts.owner,
    chain: baseSepolia,
    address: SEPOLIA_REGISTRY,
    abi: clankerIdentityAbi,
    functionName: "registerOperator",
    args: [operatorLabel],
    value: BigInt(operatorFee),
  });
  await waitOk(operatorTx);

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

  return {
    operatorLabel,
    botLabel,
    botPrivateKey,
    botAddress: botAccount.address,
    operatorTx,
    botTx,
    channelsMqtt: harnessSnippet({
      botId: botLabel,
      operatorId: operatorLabel,
    }),
  };
}

export async function pairWithSmoke(opts: {
  walletClient: WalletClient;
  owner: Address;
  operatorLabel: string;
}): Promise<void> {
  const base = MQTT_AUTH_SERVICE_URL.replace(/\/$/, "");
  const nonceUrl = new URL("/pair-nonce", base);
  nonceUrl.searchParams.set("operator_id", opts.operatorLabel);
  nonceUrl.searchParams.set("action", "add");
  nonceUrl.searchParams.set("peer_label", SMOKE_OPERATOR);

  const nonceRes = await fetch(nonceUrl.toString());
  const nonceBody = (await nonceRes.json()) as {
    nonce?: string;
    message?: string;
    error?: string;
  };
  if (!nonceRes.ok || !nonceBody.nonce || !nonceBody.message) {
    throw new Error(nonceBody.error || `pair-nonce failed (${nonceRes.status})`);
  }

  const signature = await opts.walletClient.signMessage({
    account: opts.owner,
    message: nonceBody.message,
  });

  const pairRes = await fetch(new URL("/pair", base).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operator_id: opts.operatorLabel,
      peer_label: SMOKE_OPERATOR,
      action: "add",
      nonce: nonceBody.nonce,
      signature,
    }),
  });
  const pairBody = (await pairRes.json()) as { error?: string };
  if (!pairRes.ok) {
    throw new Error(pairBody.error || `pair failed (${pairRes.status})`);
  }
}
