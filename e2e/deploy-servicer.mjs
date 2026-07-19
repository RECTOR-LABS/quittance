// ===========================================================================
// Deploy ServicerVault to casper-test via casper-js-sdk v5 (NOT odra-cli).
//
// WHY NOT odra-cli: odra-casper-rpc-client 2.8.1 hardcodes a PricingMode the
// current casper-test rejects ("invalid pricing mode"). casper-js-sdk v5's
// SessionBuilder.payment() emits PaymentLimited{standardPayment,tolerance:1} —
// the SAME mode wrap.mjs used to land tx 9b1c4721 on this exact testnet — so we
// install the Odra wasm ourselves with the install runtime args the wasm reads
// (odra_cfg_*), proven by reading odra-casper-wasm-env host_functions.rs.
//
//   node e2e/deploy-servicer.mjs validate   # build + inspect tx, NO submission
//   node e2e/deploy-servicer.mjs submit     # real on-chain install (gas ≤400 CSPR)
// ===========================================================================
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const { Args, CLValue, KeyAlgorithm, PrivateKey, RpcClient, HttpHandler, SessionBuilder } = casperSdk;

const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const CHAIN = (process.env.CASPER_NETWORK ?? "casper:casper-test").replace(/^casper:/, "");
const PEM = resolve(__dirname, "..", process.env.CASPER_SECRET_KEY_PATH);
const WASM_PATH = resolve(__dirname, "../contracts/wasm/ServicerVault.wasm");
const GAS_MOTES = 812_000_000_000; // 812 CSPR — just under the casper-test BLOCK gas limit (812.5e9).
// The install_upgrade_lane max is 1e12 (1000 CSPR) but the BLOCK gas limit is
// 812.5e9; a tx gas limit exceeding the block limit is rejected (-32016,
// "exceeds the networks block gas limit"). The SPEC-4/5/6 wasm OOG'd at 400;
// this is the highest allowed ceiling. PaymentLimited charges ACTUAL gas.
const PKG_KEY_NAME = "servicer_vault_package_hash_v2"; // v2: the qualifier's `servicer_vault_package_hash` named key already exists; a new unique name avoids the `allow_key_override:false` collision (error 64641).

/** Odra install args read by odra-casper-wasm-env install_new_contract(). */
function installArgs() {
  return Args.fromMap({
    odra_cfg_package_hash_key_name: CLValue.newCLString(PKG_KEY_NAME),
    odra_cfg_allow_key_override: CLValue.newCLValueBool(false),
    odra_cfg_is_upgradable: CLValue.newCLValueBool(false),
    odra_cfg_is_upgrade: CLValue.newCLValueBool(false),
  });
}

function buildTx(priv) {
  const wasm = new Uint8Array(readFileSync(WASM_PATH));
  const tx = new SessionBuilder()
    .from(priv.publicKey)
    .wasm(wasm)
    .installOrUpgrade()
    .runtimeArgs(installArgs())
    .chainName(CHAIN)
    .payment(GAS_MOTES)
    .build();
  return { tx, wasmLen: wasm.length };
}

function inspect() {
  const priv = PrivateKey.fromPem(readFileSync(PEM, "utf8"), KeyAlgorithm.ED25519);
  const { tx, wasmLen } = buildTx(priv);
  console.log("=== built install tx ===");
  console.log("  chainName        :", CHAIN);
  console.log("  from             :", priv.publicKey.toHex());
  console.log("  wasm             :", WASM_PATH.split("/").slice(-2).join("/"), `(${wasmLen} bytes)`);
  console.log("  isInstallUpgrade :", tx.target?.session?.isInstallUpgrade);
  console.log("  pkg key name     :", PKG_KEY_NAME);
  console.log("  gas limit        :", GAS_MOTES, `(${GAS_MOTES / 1e9} CSPR)`);
  console.log("  args             : odra_cfg_package_hash_key_name, _allow_key_override, _is_upgradable, _is_upgrade");
  const ok = wasmLen > 100_000 && tx.target?.session?.isInstallUpgrade === true;
  console.log(ok ? "\nVALIDATION PASS" : "\nVALIDATION FAIL");
  return ok;
}

async function resolvePackageHash(rpc, priv) {
  // After install the package hash lives under our account's named key.
  try {
    const entity = await rpc.getEntity({ publicKey: priv.publicKey });
    const nk = entity?.namedKeys?.keys ?? entity?.entity?.namedKeys ?? [];
    const found = (Array.isArray(nk) ? nk : []).find((k) => k?.name === PKG_KEY_NAME);
    if (found) return found.key ?? found.value;
  } catch (e) {
    console.log("  (named-key auto-resolve failed:", e.message + ")");
  }
  return null;
}

async function submit() {
  if (!inspect()) throw new Error("validation FAILED — refusing to submit");
  const priv = PrivateKey.fromPem(readFileSync(PEM, "utf8"), KeyAlgorithm.ED25519);
  const { tx } = buildTx(priv);
  tx.sign(priv);
  const rpc = new RpcClient(new HttpHandler(RPC_URL));
  // Clean error surface: the raw SDK rejection can dump the entire module
  // source, swallowing the real cause. Print err name + a truncated message
  // + the first stack frame so the actual failure is visible.
  try {
    const put = await rpc.putTransaction(tx);
    const hash = put?.transactionHash?.toHex?.();
    if (!hash) {
      console.log("\n=== putTransaction returned no tx hash ===");
      console.log("putTransaction raw:", JSON.stringify(put, (k, v) => typeof v === "bigint" ? v.toString() : v, 0)?.slice(0, 800));
      return { hash: null, status: "no-hash" };
    }
    console.log("\n=== SUBMITTED ===");
    console.log("tx hash :", hash);
    console.log("explorer:", `https://testnet.cspr.live/deploy/${hash}`);

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
        console.log("block :", ei.blockHeight);
        console.log("result:", err ? `FAILURE: ${err}` : "SUCCESS");
        console.log("cost  :", ei.executionResult.cost ?? ei.executionResult.limit, "motes");
        if (!err) {
          const pkg = await resolvePackageHash(rpc, priv);
          console.log("\nServicerVault PACKAGE hash:", pkg ?? "(resolve manually — see named key '" + PKG_KEY_NAME + "')");
          console.log("→ set SERVICER_VAULT_HASH after resolving the entity hash from the package.");
        }
        return { hash, status: err ? "failure" : "success", error: err ?? null };
      }
      if (Date.now() > deadline) { console.log("finality timeout"); return { hash, status: "timeout" }; }
    }
  } catch (e) {
    console.log("\n=== submit ERROR ===");
    console.log("name:", e?.name);
    console.log("message:", String(e?.message ?? e).slice(0, 1500));
    console.log("cause:", e?.cause ? String(e.cause?.message ?? e.cause).slice(0, 800) : "(none)");
    const own = e ? Object.getOwnPropertyNames(e).filter(k => !['name','message','stack'].includes(k)) : [];
    if (own.length) console.log("props:", own.map(k => k + '=' + JSON.stringify(e[k]).slice(0,300)).join(' | '));
    console.log("stack0:", (e?.stack || "").split("\n").slice(0, 4).join("\n"));
    return { hash: null, status: "error", error: String(e?.message ?? e).slice(0, 400) };
  }
}

const mode = process.argv[2] ?? "validate";
if (mode === "validate") {
  process.exitCode = inspect() ? 0 : 1;
} else if (mode === "submit") {
  const res = await submit();
  process.exitCode = res.status === "success" ? 0 : 1;
} else {
  console.log("usage: node e2e/deploy-servicer.mjs [validate|submit]");
  process.exitCode = 2;
}
