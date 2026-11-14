export type AuthMethod = "near-auth" | "near-connect";
export type NearNetwork = "testnet" | "mainnet";

export interface ConnectedAccount {
  readonly accountId: string;
  readonly publicKey?: string;
}

/** Browser account context only: deliberately no signer, tokens or user profile. */
export interface AuthAdapter {
  readonly method: AuthMethod;
  restore(): Promise<readonly ConnectedAccount[]>;
  login(): Promise<readonly ConnectedAccount[]>;
  logout(): Promise<void>;
  subscribe?(changed: () => void): () => void;
}

export interface AuthSettings {
  readonly clientId: string;
  readonly domain: string;
  readonly contractId: string;
  readonly mpcId: string;
}

export interface WalletConfig {
  readonly network: NearNetwork;
  readonly rpcUrl: string;
  readonly auth: AuthSettings | null;
}
