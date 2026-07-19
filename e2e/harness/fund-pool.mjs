// ===========================================================================
// Fund the ServicerVault native-CSPR pool for asset "inv-001" with 10 CSPR.
//
// WHY proxy-session: ServicerVault's `fund` entrypoint is payable (attached
// native value). casper-js-sdk v5 ContractCallBuilder cannot attach native
// value, so we use the same proxy_caller.wasm "Call" pattern that wrap.mjs
// used to land the WCSPR deposit tx on this exact testnet.
//
//   node e2e/harness/fund-pool.mjs validate   # build + inspect, NO submit
//   node e2e/harness/fund-pool.mjs submit     # real on-chain tx (10 CSPR + gas)
//
// NEVER call submit unless the controller signs off — real CSPR transfer.
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
  Args, CLValue, CLTypeUInt8,
  KeyAlgorithm, PrivateKey,
  RpcClient, HttpHandler, SessionBuilder,
} = casperSdk;

// --------------------------------- config ---------------------------------
const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const CHAIN = (process.env.CASPER_NETWORK ?? "casper:casper-test").replace(/^casper:/, "");
const PEM = resolve(__dirname, "../..", process.env.CASPER_SECRET_KEY_PATH);
const PROXY_WASM = resolve(__dirname, "../proxy_caller.wasm");
const GAS_MOTES = 10_000_000_000;      // 10 CSPR gas ceiling (proven sufficient for proxy)
const FUND_MOTES = "10000000000";       // 10 CSPR to deposit into the pool

// ServicerVault PACKAGE hash (for proxy-session target — the proxy forwards
// the call to this package's `fund` entry point). Env-driven so a new deploy
// (new package hash) just updates .env without a code change.
// NOTE: this is the PACKAGE hash, not the entity hash. The entity hash (used
// for ContractCallBuilder calls and dict reads) is in SERVICER_VAULT_HASH.
const VAULT_PKG_HASH = process.env.SERVICER_VAULT_PACKAGE_HASH;

const ASSET_ID = "inv-001";

/** Bigint-safe JSON stringifier — prevents "Cannot convert BigInt to JSON". */
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

// ---------------------------------------------------------------------------
// Build the proxy "Call" RuntimeArgs (mirrors wrap.mjs proxyArgs exactly,
// substituting `fund` as the entry_point and its inner args for the deposit's).
//
//   package_hash   → CLByteArray(32) — the vault package hash bytes
//   entry_point    → CLString        — "fund"
//   args           → CLList<u8>      — serialized inner Args for `fund`
//   amount         → CLU512          — motes to attach + forward
//   attached_value → CLU512          — same value (proxy pattern requires both)
// ---------------------------------------------------------------------------
function innerArgsBytes() {
  // `fund` takes a single runtime arg: asset_id.
  return Args.fromMap({ asset_id: CLValue.newCLString(ASSET_ID) }).toBytes();
}

function buildProxyArgs() {
  const pkgBytes = Uint8Array.from(Buffer.from(VAULT_PKG_HASH, "hex"));
  const inner = innerArgsBytes();
  return Args.fromMap({
    package_hash: CLValue.newCLByteArray(pkgBytes),
    entry_point: CLValue.newCLString("fund"),
    args: CLValue.newCLList(CLTypeUInt8, Array.from(inner, (b) => CLValue.newCLUint8(b))),
    amount: CLValue.newCLUInt512(FUND_MOTES),
    attached_value: CLValue.newCLUInt512(FUND_MOTES),
  });
}

function buildTx(priv) {
  const wasm = new Uint8Array(readFileSync(PROXY_WASM));
  const proxyArgs = buildProxyArgs();
  const tx = new SessionBuilder()
    .from(priv.publicKey)
    .wasm(wasm)
    .installOrUpgrade()
    .runtimeArgs(proxyArgs)
    .chainName(CHAIN)
    .payment(GAS_MOTES)
    .build();
  return { tx, wasm, proxyArgs };
}

function inspect() {
  const wasm = readFileSync(PROXY_WASM);
  if (wasm.length < 1000) throw new Error(`proxy_caller.wasm too small (${wasm.length} bytes) — wrong path?`);

  const priv = PrivateKey.fromPem(readFileSync(PEM, "utf8"), KeyAlgorithm.ED25519);
  const { tx, proxyArgs } = buildTx(priv);
  const inner = innerArgsBytes();

  console.log("=== fund pool — validate (proxy-session, no submit) ===");
  console.log("  chain            :", CHAIN);
  console.log("  from             :", priv.publicKey.toHex());
  console.log("  vault pkg hash   :", VAULT_PKG_HASH);
  console.log("  asset_id         :", ASSET_ID);
  console.log("  fund motes       :", FUND_MOTES, `(${Number(FUND_MOTES) / 1e9} CSPR)`);
  console.log("  gas limit        :", GAS_MOTES, `(${GAS_MOTES / 1e9} CSPR)`);
  console.log("  proxy wasm       :", wasm.length, "bytes");
  console.log("  inner args hex   :", Buffer.from(inner).toString("hex"), `(${inner.length} bytes)`);
  console.log("\n  proxy arg byte-lengths:");
  for (const name of ["package_hash", "entry_point", "args", "amount", "attached_value"]) {
    const v = proxyArgs.getByName(name);
    console.log(`    ${name.padEnd(16)}: ${v.bytes().length} bytes`);
  }
  console.log("\n  tx isInstallUpgrade:", tx.target?.session?.isInstallUpgrade);
  console.log("  tx target keys     :", j(Object.keys(tx.target ?? {})));

  const ok = tx.target?.session?.isInstallUpgrade === true && wasm.length > 1000;
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
  console.log("usage: node e2e/harness/fund-pool.mjs [validate|submit]");
  process.exitCode = 2;
}
