// ===========================================================================
// Register an asset on the live ServicerVault (casper-test).
//
// Entrypoint: register_asset(asset_id, token, holders, verifiers, quorum)
// Target: ServicerVault entity hash (SERVICER_VAULT_HASH env).
//
//   node e2e/harness/register-asset.mjs validate   # build + inspect, NO submit
//   node e2e/harness/register-asset.mjs submit     # real on-chain tx (~5 CSPR gas)
//
// NEVER call submit unless the controller signs off — real gas + chain state.
// ===========================================================================
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../../.env"));
const require = createRequire(resolve(__dirname, "../../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const {
  Args, CLValue, CLTypePublicKey,
  ContractCallBuilder, Key, KeyAlgorithm, PrivateKey, PublicKey,
  RpcClient, HttpHandler,
} = casperSdk;

// --------------------------------- config ---------------------------------
const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const CHAIN = (process.env.CASPER_NETWORK ?? "casper:casper-test").replace(/^casper:/, "");
const PEM = resolve(__dirname, "../..", process.env.CASPER_SECRET_KEY_PATH);
const VAULT_HASH = process.env.SERVICER_VAULT_HASH; // bare hex, no prefix
const GAS_MOTES = 5_000_000_000;

// Demo values (all verified working — see brief §CLValue encodings)
const ASSET_ID = "inv-001";

// `token` = agent's own account hash (Address stored by the contract; unused by distribute).
const AGENT_ACCT_HASH = "05454459c91497e073217296bb6b4c9da1bae8019a1790a3f87f4dea3ee524b2";

// Holders: (Address, U256 weight) tuples — receive-only demo accounts.
const HOLDERS = [
  { accountHash: "0c61a1f572e6bb7b2a3cf23b01105897ea10ac8468d395c36f46f6dff4b6179b", weight: "70" },
  { accountHash: "48f10c6a95265cd6ba51ececa3b8bb019ca6888451b5e2891e3be3bbe4fbd2a9", weight: "30" },
];

// Verifiers: raw 32-byte Ed25519 public keys (no tag prefix — prepend "01" for casper-js-sdk).
const VERIFIER_HEXES = [
  "21423f386b2700fe0cc65a5bb3bbb8dcadfa1dac6abe89b51f23b0af72c72892", // v1 :4101
  "d13c0fd57a9f58046fa4527777d3367350c739bc97eb55a21d6452267da65105", // v2 :4102
  "4970062de460a171b72fd7546ff17efaaceacf1c615a239cb1e254f736566697", // v3 :4103
];

const QUORUM = 2;

/** Bigint-safe JSON stringifier — prevents "Cannot convert BigInt to JSON". */
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

// Normalize entity hash to bare hex (strip "hash-" / "contract-" prefix if present).
function stripPrefix(h) {
  return h.replace(/^(?:hash-|contract-)/, "");
}

// ---------------------------------------------------------------------------
// Build the register_asset RuntimeArgs.
//
// Encoding strategy (all verified working against this chain):
//   token    → Key::Account via CLValue.newCLKey(Key.newKey("account-hash-" + hex))
//   holders  → Vec<(Key, U256)> as CLList of CLTuple2 — tupleType from first element
//   verifiers → Vec<PublicKey> — raw 32-byte hex prepended with "01" Ed25519 tag
//   quorum   → u8
// ---------------------------------------------------------------------------
function buildArgs() {
  const tokenCL = CLValue.newCLKey(Key.newKey("account-hash-" + AGENT_ACCT_HASH));

  const holderTuples = HOLDERS.map((h) =>
    CLValue.newCLTuple2(
      CLValue.newCLKey(Key.newKey("account-hash-" + h.accountHash)),
      CLValue.newCLUInt256(h.weight),
    ),
  );
  // tupleType is derived from the first element (all tuples share the same schema).
  const holdersCL = CLValue.newCLList(holderTuples[0].type, holderTuples);

  const verifiersCL = CLValue.newCLList(
    CLTypePublicKey,
    VERIFIER_HEXES.map((h) => CLValue.newCLPublicKey(PublicKey.fromHex("01" + h))),
  );

  return Args.fromMap({
    asset_id: CLValue.newCLString(ASSET_ID),
    token: tokenCL,
    holders: holdersCL,
    verifiers: verifiersCL,
    quorum: CLValue.newCLUint8(QUORUM),
  });
}

function buildTx(priv) {
  const rArgs = buildArgs();
  const tx = new ContractCallBuilder()
    .from(priv.publicKey)
    .byHash(stripPrefix(VAULT_HASH))
    .entryPoint("register_asset")
    .runtimeArgs(rArgs)
    .chainName(CHAIN)
    .payment(GAS_MOTES)
    .build();
  return { tx, rArgs };
}

function inspect() {
  if (!VAULT_HASH) throw new Error("SERVICER_VAULT_HASH not set in .env");
  const priv = PrivateKey.fromPem(readFileSync(PEM, "utf8"), KeyAlgorithm.ED25519);
  const { tx, rArgs } = buildTx(priv);

  console.log("=== register_asset — validate (no submit) ===");
  console.log("  chain          :", CHAIN);
  console.log("  from           :", priv.publicKey.toHex());
  console.log("  vault hash     :", VAULT_HASH);
  console.log("  asset_id       :", ASSET_ID);
  console.log("  gas limit      :", GAS_MOTES, `(${GAS_MOTES / 1e9} CSPR)`);
  console.log("\n  arg byte-lengths:");
  for (const name of ["asset_id", "token", "holders", "verifiers", "quorum"]) {
    const v = rArgs.getByName(name);
    console.log(`    ${name.padEnd(12)}: ${v.bytes().length} bytes`);
  }
  console.log("\n  tx entryPoint  :", j(tx.entryPoint));
  console.log("  tx target keys :", Object.keys(tx.target ?? {}));

  const ok = !!tx.entryPoint && !!tx.target;
  console.log(ok ? "\nVALIDATION PASS" : "\nVALIDATION FAIL");
  return ok;
}

async function submit() {
  if (!inspect()) throw new Error("validation FAILED — refusing to submit");
  const priv = PrivateKey.fromPem(readFileSync(PEM, "utf8"), KeyAlgorithm.ED25519);
  const { tx } = buildTx(priv);
  tx.sign(priv);
  const rpc = new RpcClient(new HttpHandler(RPC_URL));
  const put = await rpc.putTransaction(tx);
  const hash = put.transactionHash.toHex();
  console.log("\n=== SUBMITTED ===");
  console.log("tx hash  :", hash);
  console.log("explorer :", `https://testnet.cspr.live/deploy/${hash}`);

  console.log("\npolling finality…");
  const deadline = Date.now() + 240_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    let info;
    try { info = await rpc.getTransactionByTransactionHash(hash); } catch { continue; }
    const ei = info?.executionInfo;
    if (ei && ei.blockHeight !== 0 && ei.executionResult) {
      const err = ei.executionResult.errorMessage;
      console.log("\n=== FINALITY ===");
      console.log("block  :", ei.blockHeight);
      console.log("result :", err ? `FAILURE: ${err}` : "SUCCESS");
      console.log("cost   :", ei.executionResult.cost ?? ei.executionResult.limit, "motes");
      return { hash, status: err ? "failure" : "success", error: err ?? null };
    }
    if (Date.now() > deadline) { console.log("finality timeout"); return { hash, status: "timeout" }; }
  }
}

const mode = process.argv[2] ?? "validate";
if (mode === "validate") {
  process.exitCode = inspect() ? 0 : 1;
} else if (mode === "submit") {
  const res = await submit();
  process.exitCode = res.status === "success" ? 0 : 1;
} else {
  console.log("usage: node e2e/harness/register-asset.mjs [validate|submit]");
  process.exitCode = 2;
}
