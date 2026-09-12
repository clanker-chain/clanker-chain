/** Sepolia hub constants for the browser join flow. */

export const SEPOLIA_REGISTRY =
  "0xD650467f9D7A20f37E55ec23Ca1c711598f97958" as const;

export const CHAIN_RPC_URL = "https://sepolia.base.org";

export const MQTT_AUTH_SERVICE_URL = "https://mqtt-auth.clanker-chain.com";

export const BROKER_URL = "mqtts://mqtt.clanker-chain.com:8883";

export const BASE_SEPOLIA_FAUCET_URL =
  "https://portal.cdp.coinbase.com/";

export const ALCHEMY_BASE_SEPOLIA_FAUCET_URL =
  "https://www.alchemy.com/faucets/base-sepolia";

/** Documented CDP Base Sepolia ETH drip per claim. */
export const CDP_FAUCET_DRIP_ETH = "0.0001";

/** Fixed gas cushion for one operator mint + one bot mint. */
export const MINT_GAS_RESERVE_ETH = "0.00005";
