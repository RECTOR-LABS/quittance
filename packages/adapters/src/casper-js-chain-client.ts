import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import casperSdk from "casper-js-sdk";
import type {
  Args as ArgsT,
  CLValue as CLValueT,
  InfoGetTransactionResult,
  PrivateKey as PrivateKeyT,
  PublicKey as PublicKeyT,
  RpcClient,
  Transaction,
} from "casper-js-sdk";
import type { ChainClient, DeployResult } from "@quittance/core";
import type { KeyAlgorithm } from "casper-js-sdk";

const {
  Args,
  CLValue,
  CLTypePublicKey,
  CLTypeByteArray,
  ContractCallBuilder,
  ErrorCode,
  HttpHandler,
  KeyAlgorithm: KeyAlgorithmEnum,
  ParamDictionaryIdentifier,
  ParamDictionaryIdentifierContractNamedKey,
  PrivateKey,
  PublicKey,
  RpcClient: RpcClientCtor,
  SessionBuilder,
} = casperSdk;

// JSON-RPC error codes a Casper node returns when a queried dictionary item /
// its URef does not resolve — i.e. the item is simply absent. These are
// "expected empty", distinct from transport/parse faults which must surface.
const DICT_ABSENT_RPC_CODES: ReadonlySet<number> = new Set([
  ErrorCode.QueryFailed, // -32003: state query failed (ValueNotFound)
  ErrorCode.QueryFailedToExecute, // -32004
  ErrorCode.FailedToGetDictionaryURef, // -32010: dict named key not found on contract
  ErrorCode.FailedToParseQueryKey, // -32002
]);

// ---------------------------------------------------------------------------
// CasperJsChainClient — the real ChainClient: the casper-js-sdk v5 on-chain
// interface the agent uses to drive the `ServicerVault` contract. It installs
// the contract, calls its mutating entrypoints (`register_asset` / `fund` /
// `distribute`), reads the `distributed` idempotency dictionary, and awaits
// transaction finality.
//
// The crux this adapter owns is the ENCODING BOUNDARY documented on
// `@quittance/core` `types.ts` + `chain-client.ts`: the agent passes plain hex
// strings through `args` (`signers: PublicKeyHex[]`, `verdict_hashes: Hash[]`),
// and this adapter converts them to the exact Casper CLValues the on-chain ABI
// expects — `Vec<PublicKey>` (each raw 32-byte Ed25519 key tag-prefixed with
// `0x01` so its serialization is byte-identical to what `register_asset`
// stored) and `Vec<[u8; 32]>` (each 64-char hash decoded to a fixed 32-byte
// ByteArray). A wrong tag here makes the on-chain `verifiers.contains(signer)`
// check fail and `distribute` revert `QuorumNotMet`, so the encoding is
// unit-tested against real v5 `TransactionV1` objects below.
//
// Testability: the `RpcClient` is injectable via `deps.rpc` so the unit tests
// build genuine v5 transactions from a real ephemeral key while a mock captures
// the submitted tx and returns canned RPC results — NO network, NO creds, NO
// deployed contract. Live on-chain settlement is validated later by the
// RUN_TESTNET-gated integration test.
// ---------------------------------------------------------------------------

/**
 * Either a PEM string the client loads directly, or a path to a PEM file on
 * disk. Exactly one must be supplied.
 */
export type CasperJsChainClientKey =
  | { secretKeyPem: string; secretKeyPath?: undefined }
  | { secretKeyPath: string; secretKeyPem?: undefined };

export type CasperJsChainClientConfig = CasperJsChainClientKey & {
  /** Node JSON-RPC endpoint, e.g. `https://node.testnet.casper.network/rpc`. */
  rpcUrl: string;
  /** Key algorithm of the secret key. Defaults to Ed25519. */
  keyAlgo?: KeyAlgorithm;
  /**
   * Chain name. A CAIP-2 `casper:` prefix (e.g. `"casper:casper-test"`) is
   * stripped to the bare network name (`"casper-test"`) the SDK expects.
   */
  chainName: string;
  /** Gas payment in motes for entrypoint calls. Sane testnet default. */
  paymentMotes?: number;
  /** Gas payment in motes for the (larger) wasm install. Sane default. */
  installPaymentMotes?: number;
  /** Finality poll interval in ms (default 2000). */
  finalityPollMs?: number;
  /** Finality timeout in ms (default 180000). */
  finalityTimeoutMs?: number;
};

export interface CasperJsChainClientDeps {
  /**
   * The RPC client. Injectable for tests so a mock can capture submitted
   * transactions and return canned results; do NOT dial a real node in unit
   * tests. Defaults to a client built from `config.rpcUrl`.
   */
  rpc?: RpcClient;
}

const DEFAULT_PAYMENT_MOTES = 2_500_000_000;
const DEFAULT_INSTALL_PAYMENT_MOTES = 150_000_000_000;
const DEFAULT_FINALITY_POLL_MS = 2_000;
const DEFAULT_FINALITY_TIMEOUT_MS = 180_000;

/** Normalize a contract hash to bare hex (no `hash-`/`contract-` prefix). */
function stripHashPrefix(contractHash: string): string {
  return contractHash.replace(/^(?:hash-|contract-)/, "");
}

/** Normalize a contract hash to the `hash-`-prefixed key form the node expects. */
function withHashPrefix(contractHash: string): string {
  const bare = stripHashPrefix(contractHash);
  return `hash-${bare}`;
}

/** Decode a 64-char hex string to its 32 raw bytes, or throw a specific error. */
function hashHexToBytes(hex: string, label: string): Uint8Array {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `${label} must be a 64-char (32-byte) hex string, got ${JSON.stringify(hex)}`,
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert a raw 32-byte Ed25519 `PublicKeyHex` (no tag) to a v5 `PublicKey` by
 * prepending the Ed25519 algorithm tag `01`, per the encoding contract on
 * `PublicKeyHex` in `@quittance/core` `types.ts`.
 */
function publicKeyHexToPublicKey(hex: string): PublicKeyT {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `signer public key must be a raw 32-byte (64-char) Ed25519 hex string, ` +
        `got ${JSON.stringify(hex)}`,
    );
  }
  return PublicKey.fromHex(`01${hex}`);
}

/** Narrow an `args` value to a non-empty array of strings. */
function expectStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${field} must be an array of hex strings`);
  }
  return value as string[];
}

/** Narrow an `args` value to a string. */
function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

/**
 * Per-entrypoint arg builder for the `ServicerVault` ABI.
 *
 * Two of the contract's entrypoints are on the agent's runtime path and carry
 * the hex-string encoding boundary, so they get a fully-typed mapper that
 * converts the agent's hex `args` into the exact CLValues the ABI expects:
 *   - `distribute(asset_id, cycle_id, verdict_hashes: Vec<[u8;32]>, signers: Vec<PublicKey>)`
 *   - `fund(asset_id)`
 *
 * `register_asset` is a one-time deploy-time setup call (NOT on the agent's
 * cycle path) whose args involve `Address`/tuple/U256 encoding. Per the
 * encoding contract, the caller supplies those as already-shaped CLValues and
 * we pass them through (same philosophy as `installContract`).
 *
 * Any entrypoint outside this allowlist is rejected — we never silently build an
 * empty/incorrect call to an arbitrary contract method.
 */
const PASSTHROUGH_ENTRYPOINTS: ReadonlySet<string> = new Set(["register_asset"]);

function buildEntrypointArgs(entry: string, args: Record<string, unknown>): ArgsT {
  switch (entry) {
    case "distribute": {
      const assetId = expectString(args["asset_id"], "asset_id");
      const cycleId = expectString(args["cycle_id"], "cycle_id");
      const signers = expectStringArray(args["signers"], "signers").map((hex) =>
        CLValue.newCLPublicKey(publicKeyHexToPublicKey(hex)),
      );
      const verdictHashes = expectStringArray(args["verdict_hashes"], "verdict_hashes").map(
        (hex) => CLValue.newCLByteArray(hashHexToBytes(hex, "verdict_hashes entry")),
      );
      // Named runtime args are dispatched by NAME on-chain (Odra reads each
      // param via get_named_arg), so insertion order is not load-bearing; we
      // list them in the contract's declared order purely for readability.
      return Args.fromMap({
        asset_id: CLValue.newCLString(assetId),
        cycle_id: CLValue.newCLString(cycleId),
        verdict_hashes: CLValue.newCLList(new CLTypeByteArray(32), verdictHashes),
        signers: CLValue.newCLList(CLTypePublicKey, signers),
      });
    }
    case "fund": {
      const assetId = expectString(args["asset_id"], "asset_id");
      return Args.fromMap({ asset_id: CLValue.newCLString(assetId) });
    }
    default:
      if (PASSTHROUGH_ENTRYPOINTS.has(entry)) {
        return Args.fromMap(expectClValueMap(args, entry));
      }
      throw new Error(
        `unsupported entrypoint ${JSON.stringify(entry)}: the chain client encodes ` +
          `args for "distribute" / "fund" and passes through pre-shaped CLValues ` +
          `for ${[...PASSTHROUGH_ENTRYPOINTS].map((e) => `"${e}"`).join(", ")}`,
      );
  }
}

/** Require every arg of a passthrough entrypoint to already be a CLValue. */
function expectClValueMap(
  args: Record<string, unknown>,
  entry: string,
): Record<string, CLValueT> {
  const out: Record<string, CLValueT> = {};
  for (const [name, value] of Object.entries(args)) {
    if (!(value instanceof CLValue)) {
      throw new Error(
        `entrypoint ${JSON.stringify(entry)} arg ${JSON.stringify(name)} must be a ` +
          `casper-js-sdk CLValue (this entrypoint takes pre-shaped values)`,
      );
    }
    out[name] = value;
  }
  return out;
}

export class CasperJsChainClient implements ChainClient {
  private readonly rpc: RpcClient;
  private readonly priv: PrivateKeyT;
  private readonly chainName: string;
  private readonly paymentMotes: number;
  private readonly installPaymentMotes: number;
  private readonly finalityPollMs: number;
  private readonly finalityTimeoutMs: number;

  constructor(config: CasperJsChainClientConfig, deps: CasperJsChainClientDeps = {}) {
    const algo = config.keyAlgo ?? KeyAlgorithmEnum.ED25519;
    // The caller key comes either inline as a PEM string or as a path to a local
    // PEM file (read synchronously at construction — a local-file read is a
    // legitimate sync operation and keeps the constructor non-async).
    const pem = config.secretKeyPem ?? this.readKeyFile(config.secretKeyPath);
    this.priv = PrivateKey.fromPem(pem, algo);

    this.rpc = deps.rpc ?? new RpcClientCtor(new HttpHandler(config.rpcUrl));
    this.chainName = config.chainName.replace(/^casper:/, "");
    this.paymentMotes = config.paymentMotes ?? DEFAULT_PAYMENT_MOTES;
    this.installPaymentMotes = config.installPaymentMotes ?? DEFAULT_INSTALL_PAYMENT_MOTES;
    this.finalityPollMs = config.finalityPollMs ?? DEFAULT_FINALITY_POLL_MS;
    this.finalityTimeoutMs = config.finalityTimeoutMs ?? DEFAULT_FINALITY_TIMEOUT_MS;
  }

  private readKeyFile(path: string): string {
    try {
      return readFileSync(path, "utf8");
    } catch (cause) {
      throw new Error(`failed to read secret key PEM at ${path}`, { cause });
    }
  }

  async installContract(wasmPath: string, args: Record<string, unknown>): Promise<DeployResult> {
    let wasm: Uint8Array;
    try {
      wasm = new Uint8Array(await readFile(wasmPath));
    } catch (cause) {
      throw new Error(`failed to read contract wasm at ${wasmPath}`, { cause });
    }

    // `args` for install are passed through as already-shaped CLValues; the
    // ServicerVault constructor takes no runtime args in the common path, so an
    // empty map is the default. Any provided values must already be CLValues.
    const clArgs = expectClValueMap(args, "install");

    const tx = new SessionBuilder()
      .from(this.priv.publicKey)
      .wasm(wasm)
      .installOrUpgrade()
      .runtimeArgs(Args.fromMap(clArgs))
      .chainName(this.chainName)
      .payment(this.installPaymentMotes)
      .build();

    return this.signAndSubmit(tx, "installContract");
  }

  async callEntrypoint(
    contractHash: string,
    entry: string,
    args: Record<string, unknown>,
  ): Promise<DeployResult> {
    const runtimeArgs = buildEntrypointArgs(entry, args);

    // `byHash` targets the contract by its (entity) contract hash — the SAME
    // identifier `queryDictItem` uses to locate the contract's named-key
    // dictionaries, so a single `contractHash` config refers coherently to one
    // deployed contract. (A package-hash reference via `byPackageHash` would
    // pin "latest version" but is incoherent with the contract-scoped dict read,
    // so we standardize on the contract hash.)
    const tx = new ContractCallBuilder()
      .from(this.priv.publicKey)
      .byHash(stripHashPrefix(contractHash))
      .entryPoint(entry)
      .runtimeArgs(runtimeArgs)
      .chainName(this.chainName)
      .payment(this.paymentMotes)
      .build();

    return this.signAndSubmit(tx, `callEntrypoint(${entry})`);
  }

  async queryDictItem(contractHash: string, dict: string, key: string): Promise<unknown> {
    const namedKey = new ParamDictionaryIdentifierContractNamedKey(
      // The dictionary lives under the contract's named keys; the node expects
      // the contract reference as a `hash-` prefixed key string.
      withHashPrefix(contractHash),
      dict,
      key,
    );
    const identifier = new ParamDictionaryIdentifier(undefined, namedKey, undefined, undefined);

    let result;
    try {
      // `null` state-root-hash => the node uses the latest tip.
      result = await this.rpc.getDictionaryItemByIdentifier(null, identifier);
    } catch (cause) {
      // An absent dictionary item surfaces as an RPC error. The agent treats a
      // falsy result as "not distributed", so we return undefined ONLY for the
      // not-found case and re-throw everything else (never mask a real fault).
      if (isDictionaryNotFound(cause)) {
        return undefined;
      }
      throw cause;
    }

    return result.storedValue?.clValue;
  }

  async waitForFinality(txHash: string): Promise<"success" | "failure"> {
    const deadline = Date.now() + this.finalityTimeoutMs;

    for (;;) {
      let info: InfoGetTransactionResult;
      try {
        info = await this.rpc.getTransactionByTransactionHash(txHash);
      } catch (cause) {
        throw new Error(`failed to poll finality for transaction ${txHash}`, { cause });
      }

      const exec = info.executionInfo;
      // Finalized once execution info is attached with a real block and result.
      if (exec && exec.blockHeight !== 0 && exec.executionResult) {
        return exec.executionResult.errorMessage ? "failure" : "success";
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `transaction ${txHash} did not reach finality within ${this.finalityTimeoutMs}ms`,
        );
      }
      await delay(this.finalityPollMs);
    }
  }

  /** Sign with the caller key and submit, returning the on-chain tx hash. */
  private async signAndSubmit(tx: Transaction, context: string): Promise<DeployResult> {
    tx.sign(this.priv);
    let put;
    try {
      put = await this.rpc.putTransaction(tx);
    } catch (cause) {
      throw new Error(`${context}: putTransaction failed`, { cause });
    }
    return { txHash: put.transactionHash.toHex() };
  }
}

/**
 * Does this thrown RPC error mean "the dictionary item is absent" (as opposed
 * to a transport/parse fault that must be surfaced)?
 *
 * Primary signal is the structured JSON-RPC error CODE (robust across node
 * versions / message wording). We fall back to a message substring only when no
 * numeric code is present (e.g. a non-RpcError thrown by a mock or a transport
 * layer), so a real "connection reset" is never silently swallowed as absent.
 */
function isDictionaryNotFound(error: unknown): boolean {
  const e = error as {
    code?: unknown;
    statusCode?: unknown;
    sourceErr?: { code?: unknown; data?: unknown };
    message?: unknown;
  };
  // casper-js-sdk surfaces the RPC code at different depths depending on the
  // transport wrapper: top-level `code`, `statusCode`, or nested `sourceErr.code`.
  const code = [e?.code, e?.statusCode, e?.sourceErr?.code].find(
    (c): c is number => typeof c === "number",
  );
  // The node's specific reason lives in `sourceErr.data`; the message is generic.
  const detail = `${typeof e?.sourceErr?.data === "string" ? e.sourceErr.data : ""} ${
    error instanceof Error ? error.message : String(error)
  }`;
  const looksNotFound = /not[\s_-]?found|does not exist|dictionary item|valuenotfound/i.test(detail);

  if (typeof code === "number") {
    if (DICT_ABSENT_RPC_CODES.has(code)) return true;
    // -32018 NodeRequestFailed wraps multiple faults; treat as "absent" ONLY when
    // the node's detail explicitly says the dictionary/URef was not found, so a
    // genuine transport fault still surfaces (never silently skip the
    // already-distributed idempotency guard → never risk a double distribute).
    if (code === ErrorCode.NodeRequestFailed) return looksNotFound;
    return false;
  }
  // No numeric code (e.g. a test mock or a bare transport error): fall back to text.
  return looksNotFound;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
