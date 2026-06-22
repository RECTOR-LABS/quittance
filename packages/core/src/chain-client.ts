export interface DeployResult {
  txHash: string;
}

export interface ChainClient {
  installContract(wasmPath: string, args: Record<string, unknown>): Promise<DeployResult>;
  callEntrypoint(contractHash: string, entry: string, args: Record<string, unknown>): Promise<DeployResult>;
  queryDictItem(contractHash: string, dict: string, key: string): Promise<unknown>;
  waitForFinality(txHash: string): Promise<"success" | "failure">;
}
