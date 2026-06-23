import { describe, expect, it, vi } from "vitest";
// Importing a value from the core barrel runs `sign.ts`'s module-load side
// effect that wires @noble/ed25519 v2's `sha512Sync` — required before
// `freshKeypair()` (which derives a public key synchronously) can run. We don't
// call verifyVerdict here; the import is for that one-time crypto setup.
import { verifyVerdict } from "@quittance/core";
import { freshKeypair } from "@quittance/core/test-utils";
import casperSdk from "casper-js-sdk";

void verifyVerdict;
import type {
  InfoGetTransactionResult,
  PutTransactionResult,
  RpcClient,
  StateGetDictionaryResult,
  Transaction,
} from "casper-js-sdk";
import { CasperJsChainClient } from "./casper-js-chain-client.js";

const { CLValue, PrivateKey, KeyAlgorithm } = casperSdk;

// ---------------------------------------------------------------------------
// Test doubles
//
// Every test injects a mock RpcClient (deps.rpc) so NO real network is touched.
// The adapter still builds REAL casper-js-sdk v5 TransactionV1 objects from a
// REAL ephemeral key — so the assertions below prove genuine v5 tx-construction
// and the hex -> CLValue encoding boundary, not a stub. The mock only captures
// the built Transaction handed to putTransaction and returns canned RPC results.
// Live on-chain settlement is the RUN_TESTNET-gated test at the bottom.
// ---------------------------------------------------------------------------

/** A throwaway PEM the adapter loads as its caller key. Generated per-suite from
 *  a real Ed25519 key so PrivateKey.fromPem round-trips and tx.sign() works. */
function ephemeralPem(): { pem: string; publicKeyHex: string } {
  // PrivateKey.generate is async; we need a sync PEM for the config object, so
  // derive deterministically from a fresh secret via fromHex -> toPem instead.
  const kp = freshKeypair();
  const priv = PrivateKey.fromHex(kp.secretKeyHex, KeyAlgorithm.ED25519);
  return { pem: priv.toPem(), publicKeyHex: priv.publicKey.toHex() };
}

/** Builds a mock RpcClient exposing only the three methods the adapter calls,
 *  each a vi.fn() the tests can assert on / re-stub. Cast through unknown so we
 *  don't have to satisfy the full RpcClient surface. */
function mockRpc(overrides: {
  putTransaction?: (tx: Transaction) => Promise<PutTransactionResult>;
  getTransactionByTransactionHash?: (hash: string) => Promise<InfoGetTransactionResult>;
  getDictionaryItemByIdentifier?: (
    stateRootHash: string | null,
    identifier: unknown,
  ) => Promise<StateGetDictionaryResult>;
} = {}): { rpc: RpcClient; putTransaction: ReturnType<typeof vi.fn>; getTx: ReturnType<typeof vi.fn>; getDict: ReturnType<typeof vi.fn> } {
  const putTransaction = vi.fn(
    overrides.putTransaction ??
      (async () =>
        ({
          transactionHash: { toHex: () => "feedface00", } as unknown,
        } as PutTransactionResult)),
  );
  const getTx = vi.fn(overrides.getTransactionByTransactionHash);
  const getDict = vi.fn(overrides.getDictionaryItemByIdentifier);
  const rpc = {
    putTransaction,
    getTransactionByTransactionHash: getTx,
    getDictionaryItemByIdentifier: getDict,
  } as unknown as RpcClient;
  return { rpc, putTransaction, getTx, getDict };
}

/** Canonical config for the chain client (no rpcUrl is dialed because deps.rpc
 *  is injected). chainName carries the CAIP-2 "casper:" prefix on purpose so the
 *  stripping behavior is exercised. */
function clientConfig(pem: string) {
  return {
    rpcUrl: "https://node.invalid/rpc",
    secretKeyPem: pem,
    keyAlgo: KeyAlgorithm.ED25519,
    chainName: "casper:casper-test",
    paymentMotes: 2_500_000_000,
  } as const;
}

/** Build a finalized InfoGetTransactionResult whose executionInfo carries the
 *  given errorMessage (undefined => success). blockHeight 0 / no executionInfo
 *  is treated by the adapter as "not yet final". */
function finalizedTxResult(errorMessage?: string): InfoGetTransactionResult {
  return {
    executionInfo: {
      blockHash: "abc" as unknown,
      blockHeight: 42,
      executionResult: { errorMessage },
    },
  } as unknown as InfoGetTransactionResult;
}

function pendingTxResult(): InfoGetTransactionResult {
  // executionInfo absent => the tx has not been included in a block yet.
  return {} as unknown as InfoGetTransactionResult;
}

const CONTRACT_HASH = "0".repeat(64);

describe("CasperJsChainClient", () => {
  describe("callEntrypoint — distribute encoding", () => {
    it("builds a distribute tx with hex signers tagged to PublicKey and hashes as [u8;32], returning the put hash", async () => {
      const { pem } = ephemeralPem();
      // Two raw 32-byte Ed25519 hexes (no tag) — exactly the PublicKeyHex form.
      const signerA = freshKeypair().publicKeyHex;
      const signerB = freshKeypair().publicKeyHex;
      // Two 64-char verdict hashes.
      const hashA = "11".repeat(32);
      const hashB = "22".repeat(32);

      let captured: Transaction | undefined;
      const { rpc, putTransaction } = mockRpc({
        putTransaction: async (tx) => {
          captured = tx;
          return { transactionHash: { toHex: () => "deadbeef01" } } as unknown as PutTransactionResult;
        },
      });

      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      const res = await client.callEntrypoint(CONTRACT_HASH, "distribute", {
        asset_id: "inv-1",
        cycle_id: "c1",
        signers: [signerA, signerB],
        verdict_hashes: [hashA, hashB],
      });

      expect(res.txHash).toBe("deadbeef01");
      expect(putTransaction).toHaveBeenCalledOnce();
      expect(captured).toBeDefined();
      const tx = captured!;

      // Correct entrypoint.
      expect(JSON.stringify(tx.entryPoint)).toContain("distribute");

      // chainName had the CAIP-2 "casper:" prefix stripped.
      expect(tx.chainName).toBe("casper-test");

      // asset_id / cycle_id -> CLString.
      const assetArg = tx.args.getByName("asset_id")!;
      expect(assetArg.type.toString()).toBe("String");
      expect(assetArg.toString()).toBe("inv-1");
      expect(tx.args.getByName("cycle_id")!.toString()).toBe("c1");

      // signers -> List of PublicKey, each tagged with the Ed25519 "01" prefix.
      const signersArg = tx.args.getByName("signers")!;
      expect(signersArg.type.toString()).toBe("(List of PublicKey)");
      const elems = signersArg.list!.elements;
      expect(elems).toHaveLength(2);
      expect(elems[0]!.publicKey!.toHex()).toBe("01" + signerA);
      expect(elems[1]!.publicKey!.toHex()).toBe("01" + signerB);

      // verdict_hashes -> List of [u8;32] byte arrays with the raw decoded bytes.
      const hashesArg = tx.args.getByName("verdict_hashes")!;
      expect(hashesArg.type.toString()).toBe("(List of ByteArray: 32)");
      const hashElems = hashesArg.list!.elements;
      expect(hashElems).toHaveLength(2);
      expect(Buffer.from(hashElems[0]!.bytes()).toString("hex")).toBe(hashA);
      expect(Buffer.from(hashElems[1]!.bytes()).toString("hex")).toBe(hashB);

      // The tx was signed (one approval) before being sent.
      expect(tx.approvals.length).toBe(1);
    });

    it("rejects a malformed verdict hash (not 64 hex chars) with a specific error", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc();
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });

      await expect(
        client.callEntrypoint(CONTRACT_HASH, "distribute", {
          asset_id: "inv-1",
          cycle_id: "c1",
          signers: [freshKeypair().publicKeyHex],
          verdict_hashes: ["abcd"], // too short
        }),
      ).rejects.toThrow(/verdict_hashes.*32|hash.*hex|hex.*32/i);
    });

    it("rejects a malformed signer hex with a specific error", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc();
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });

      await expect(
        client.callEntrypoint(CONTRACT_HASH, "distribute", {
          asset_id: "inv-1",
          cycle_id: "c1",
          signers: ["nothex"],
          verdict_hashes: ["33".repeat(32)],
        }),
      ).rejects.toThrow(/signer|public.?key|hex/i);
    });
  });

  describe("callEntrypoint — fund encoding", () => {
    it("builds a fund tx carrying the asset_id string", async () => {
      const { pem } = ephemeralPem();
      let captured: Transaction | undefined;
      const { rpc } = mockRpc({
        putTransaction: async (tx) => {
          captured = tx;
          return { transactionHash: { toHex: () => "fund01" } } as unknown as PutTransactionResult;
        },
      });

      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      const res = await client.callEntrypoint(CONTRACT_HASH, "fund", { asset_id: "inv-1" });

      expect(res.txHash).toBe("fund01");
      const tx = captured!;
      expect(JSON.stringify(tx.entryPoint)).toContain("fund");
      expect(tx.args.getByName("asset_id")!.toString()).toBe("inv-1");
    });
  });

  describe("callEntrypoint — register_asset passthrough", () => {
    it("passes pre-shaped CLValues through for register_asset (deploy-time setup)", async () => {
      const { pem } = ephemeralPem();
      let captured: Transaction | undefined;
      const { rpc } = mockRpc({
        putTransaction: async (tx) => {
          captured = tx;
          return { transactionHash: { toHex: () => "reg01" } } as unknown as PutTransactionResult;
        },
      });

      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      const res = await client.callEntrypoint(CONTRACT_HASH, "register_asset", {
        asset_id: CLValue.newCLString("inv-1"),
        quorum: CLValue.newCLUint8(2),
      });

      expect(res.txHash).toBe("reg01");
      const tx = captured!;
      expect(JSON.stringify(tx.entryPoint)).toContain("register_asset");
      expect(tx.args.getByName("asset_id")!.toString()).toBe("inv-1");
      expect(tx.args.getByName("quorum")!.type.toString()).toBe("U8");
    });

    it("rejects a register_asset arg that is not a CLValue (raw value not allowed on passthrough)", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc();
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });

      await expect(
        client.callEntrypoint(CONTRACT_HASH, "register_asset", { quorum: 2 }),
      ).rejects.toThrow(/CLValue|pre-shaped|register_asset/i);
    });
  });

  describe("callEntrypoint — guard rails", () => {
    it("rejects an unknown entrypoint instead of silently building an empty call", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc();
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });

      await expect(
        client.callEntrypoint(CONTRACT_HASH, "self_destruct", {}),
      ).rejects.toThrow(/unknown|unsupported|entrypoint/i);
    });

    it("surfaces a putTransaction RPC failure as a thrown error (no silent swallow)", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc({
        putTransaction: async () => {
          throw new Error("node refused: 429");
        },
      });
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });

      await expect(
        client.callEntrypoint(CONTRACT_HASH, "fund", { asset_id: "inv-1" }),
      ).rejects.toThrow(/429|refused|putTransaction|submit/i);
    });
  });

  describe("queryDictItem", () => {
    it("returns the stored value for a present key via a contract-named-key identifier", async () => {
      const { pem } = ephemeralPem();
      const storedClValue = CLValue.newCLValueBool(true);
      let capturedId: unknown;
      const { rpc, getDict } = mockRpc({
        getDictionaryItemByIdentifier: async (_srh, identifier) => {
          capturedId = identifier;
          return {
            storedValue: { clValue: storedClValue },
          } as unknown as StateGetDictionaryResult;
        },
      });

      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      const value = await client.queryDictItem(CONTRACT_HASH, "distributed", "inv-1:c1");

      expect(getDict).toHaveBeenCalledOnce();
      // The identifier must be a contract-named-key pointing at our dict + item.
      const id = capturedId as {
        contractNamedKey?: { key: string; dictionaryName: string; dictionaryItemKey: string };
      };
      // Bare contract hash is normalized to the `hash-` prefixed key form.
      expect(id.contractNamedKey?.key).toBe(`hash-${CONTRACT_HASH}`);
      expect(id.contractNamedKey?.dictionaryName).toBe("distributed");
      expect(id.contractNamedKey?.dictionaryItemKey).toBe("inv-1:c1");
      // The stored CLValue is returned to the caller.
      expect(value).toBe(storedClValue);
    });

    it("returns undefined for an absent key (node returns the structured QueryFailed code) so the agent treats it as 'not distributed'", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc({
        getDictionaryItemByIdentifier: async () => {
          // The node returns RpcError code -32003 (QueryFailed: ValueNotFound)
          // for a missing dictionary item.
          throw new casperSdk.RpcError(
            casperSdk.ErrorCode.QueryFailed,
            "state query failed: ValueNotFound",
          );
        },
      });

      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      const value = await client.queryDictItem(CONTRACT_HASH, "distributed", "absent:key");
      expect(value).toBeUndefined();
    });

    it("returns undefined for an absent key surfaced as a plain not-found message (no structured code)", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc({
        getDictionaryItemByIdentifier: async () => {
          throw new Error("dictionary item not found");
        },
      });
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      const value = await client.queryDictItem(CONTRACT_HASH, "distributed", "absent:key");
      expect(value).toBeUndefined();
    });

    it("propagates a transport RPC error (NodeRequestFailed code) rather than masking it as absent", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc({
        getDictionaryItemByIdentifier: async () => {
          throw new casperSdk.RpcError(casperSdk.ErrorCode.NodeRequestFailed, "node request failed");
        },
      });
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      await expect(
        client.queryDictItem(CONTRACT_HASH, "distributed", "k"),
      ).rejects.toThrow(/node request failed/i);
    });

    it("propagates a non-coded transport error (connection reset) rather than masking it as absent", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc({
        getDictionaryItemByIdentifier: async () => {
          throw new Error("connection reset");
        },
      });
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      await expect(
        client.queryDictItem(CONTRACT_HASH, "distributed", "k"),
      ).rejects.toThrow(/connection reset/i);
    });
  });

  describe("waitForFinality", () => {
    it("returns 'success' when the execution result has no errorMessage", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc({
        getTransactionByTransactionHash: async () => finalizedTxResult(undefined),
      });
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      await expect(client.waitForFinality("deadbeef")).resolves.toBe("success");
    });

    it("returns 'failure' when the execution result carries an errorMessage", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc({
        getTransactionByTransactionHash: async () => finalizedTxResult("User error: 4 (QuorumNotMet)"),
      });
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      await expect(client.waitForFinality("deadbeef")).resolves.toBe("failure");
    });

    it("polls until executionInfo is populated (pending -> finalized)", async () => {
      const { pem } = ephemeralPem();
      const results = [pendingTxResult(), pendingTxResult(), finalizedTxResult(undefined)];
      let call = 0;
      const { rpc, getTx } = mockRpc({
        getTransactionByTransactionHash: async () => results[call++]!,
      });
      const client = new CasperJsChainClient(
        // tiny poll interval so the test is fast.
        { ...clientConfig(pem), finalityPollMs: 1, finalityTimeoutMs: 1000 },
        { rpc },
      );
      await expect(client.waitForFinality("deadbeef")).resolves.toBe("success");
      expect(getTx).toHaveBeenCalledTimes(3);
    });

    it("throws (does not hang or silently pass) when finality is not reached before the timeout", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc({
        getTransactionByTransactionHash: async () => pendingTxResult(),
      });
      const client = new CasperJsChainClient(
        { ...clientConfig(pem), finalityPollMs: 1, finalityTimeoutMs: 10 },
        { rpc },
      );
      await expect(client.waitForFinality("deadbeef")).rejects.toThrow(/timeout|finality|not.*final/i);
    });
  });

  describe("installContract", () => {
    it("builds a session install tx from the wasm file and returns the put hash", async () => {
      const { pem } = ephemeralPem();
      // Point at a real on-disk wasm-ish file so readFile succeeds; bytes are
      // arbitrary for tx construction (the real install is creds-gated).
      const wasmPath = new URL("./casper-js-chain-client.test.ts", import.meta.url).pathname;

      let captured: Transaction | undefined;
      const { rpc } = mockRpc({
        putTransaction: async (tx) => {
          captured = tx;
          return { transactionHash: { toHex: () => "install01" } } as unknown as PutTransactionResult;
        },
      });

      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      const res = await client.installContract(wasmPath, {});

      expect(res.txHash).toBe("install01");
      // A session (module-bytes) target was built and signed.
      expect(captured).toBeDefined();
      expect(captured!.approvals.length).toBe(1);
    });

    it("fails loudly when the wasm path does not exist", async () => {
      const { pem } = ephemeralPem();
      const { rpc } = mockRpc();
      const client = new CasperJsChainClient(clientConfig(pem), { rpc });
      await expect(
        client.installContract("/no/such/contract.wasm", {}),
      ).rejects.toThrow(/ENOENT|no such file|wasm/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration (creds-gated) — real finality lookup against a known testnet tx.
// Skipped by default; runs only with RUN_TESTNET=1 + a real node URL + tx hash.
// ---------------------------------------------------------------------------
describe.skipIf(!process.env.RUN_TESTNET)("CasperJsChainClient (testnet)", () => {
  it("resolves finality for a known successful testnet transaction", async () => {
    const rpcUrl = process.env.CASPER_NODE_RPC_URL;
    const txHash = process.env.QUITTANCE_TESTNET_TX_HASH;
    const secretKeyPath = process.env.CASPER_SECRET_KEY_PATH;
    if (!rpcUrl || !txHash || !secretKeyPath) {
      throw new Error(
        "RUN_TESTNET set but CASPER_NODE_RPC_URL / QUITTANCE_TESTNET_TX_HASH / CASPER_SECRET_KEY_PATH missing",
      );
    }
    const client = new CasperJsChainClient({
      rpcUrl,
      secretKeyPath,
      chainName: "casper-test",
    });
    await expect(client.waitForFinality(txHash)).resolves.toBe("success");
  });
});
