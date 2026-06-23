export interface DeployResult {
  txHash: string;
}

export interface ChainClient {
  installContract(wasmPath: string, args: Record<string, unknown>): Promise<DeployResult>;
  /**
   * Invoke a mutating contract entrypoint. Any `args` value typed as
   * `PublicKeyHex` or `Hash` (e.g. the `signers` / `verdict_hashes` passed to
   * `distribute`) is a hex string at this seam; the adapter MUST convert it to
   * the Casper CLValue the contract expects (tag-prefixed `PublicKey`, a
   * `[u8; 32]` byte array) per the encoding contract documented on those types
   * in `types.ts` before building the TransactionV1.
   */
  callEntrypoint(contractHash: string, entry: string, args: Record<string, unknown>): Promise<DeployResult>;
  queryDictItem(contractHash: string, dict: string, key: string): Promise<unknown>;
  waitForFinality(txHash: string): Promise<"success" | "failure">;
}
