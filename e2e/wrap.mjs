// ===========================================================================
// Wrap CSPR -> WCSPR for our account by replicating the proven on-chain deposit
// convention: an Odra "Call" proxy session that funds a cargo purse from our
// main purse and forwards `attached_value` to the WCSPR contract's payable
// `deposit` entry point. (casper-js-sdk v5 ContractCallBuilder cannot attach
// native value, so the proxy session is the ONLY path — confirmed against a real
// deposit tx 3984baa9… on this exact contract.)
//
// SAFETY: `validate` reconstructs the proxy args at the REAL tx's amount and
// asserts EVERY arg's bytes match the real deposit byte-for-byte. `submit` only
// proceeds if validation passes — no on-chain thrashing. NEVER logs the token.
//
//   node e2e/wrap.mjs validate          # off-chain byte-match proof, no tx
//   node e2e/wrap.mjs submit [motes]    # wrap (default 10 CSPR), live tx
// ===========================================================================
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const {
  Args, CLValue, CLTypeUInt8, KeyAlgorithm,
  PrivateKey, PublicKey, RpcClient, HttpHandler, SessionBuilder,
} = casperSdk;

// --------------------------------- config ---------------------------------
const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const CHAIN = (process.env.CASPER_NETWORK ?? "casper:casper-test").replace(/^casper:/, "");
const PKG = process.env.WCSPR_PACKAGE_HASH;
const PEM = resolve(__dirname, "..", process.env.CASPER_SECRET_KEY_PATH);
const GAS_MOTES = 10_000_000_000; // proven-sufficient (real deposit used 8e9) + margin
const PROXY_WASM = resolve(__dirname, "proxy_caller.wasm"); // extracted from real deposit

// Known-good reference (real deposit tx 3984baa9…), for byte-exact validation.
const REF_AMOUNT = "50000000000";
const REF = {
  package_hash: "3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e",
  entry_point: "070000006465706f736974",
  args: "21000000010000000e00000061747461636865645f76616c7565060000000500743ba40b08",
  amount: "0500743ba40b",
  attached_value: "0500743ba40b",
};

const hex = (u8) => Buffer.from(u8).toString("hex");
const pkgBytes = Uint8Array.from(Buffer.from(PKG, "hex"));

/** Serialize the RuntimeArgs forwarded to `deposit`: { attached_value: U512 }. */
function innerArgsBytes(motes) {
  return Args.fromMap({ attached_value: CLValue.newCLUInt512(motes) }).toBytes();
}

/** Build the proxy "Call" runtime args for a given wrap amount (motes). */
function proxyArgs(motes) {
  const inner = innerArgsBytes(motes);
  return Args.fromMap({
    package_hash: CLValue.newCLByteArray(pkgBytes),
    entry_point: CLValue.newCLString("deposit"),
    args: CLValue.newCLList(CLTypeUInt8, Array.from(inner, (b) => CLValue.newCLUint8(b))),
    amount: CLValue.newCLUInt512(motes),
    attached_value: CLValue.newCLUInt512(motes),
  });
}

/** Assert our reconstructed args match the real deposit byte-for-byte. */
function validate() {
  const a = proxyArgs(REF_AMOUNT);
  const got = {
    package_hash: hex(a.getByName("package_hash").bytes()),
    entry_point: hex(a.getByName("entry_point").bytes()),
    args: hex(a.getByName("args").bytes()),
    amount: hex(a.getByName("amount").bytes()),
    attached_value: hex(a.getByName("attached_value").bytes()),
  };
  let ok = true;
  for (const k of Object.keys(REF)) {
    const match = got[k] === REF[k];
    ok &&= match;
    console.log(`  ${match ? "OK " : "MISMATCH"}  ${k}`);
    if (!match) {
      console.log(`      expected ${REF[k]}`);
      console.log(`      got      ${got[k]}`);
    }
  }
  // Sanity: proxy wasm present and non-trivial.
  const wasm = readFileSync(PROXY_WASM);
  console.log(`  proxy wasm: ${wasm.length} bytes`);
  if (wasm.length < 1000) { ok = false; console.log("  MISMATCH proxy wasm too small"); }
  return ok;
}

async function submit(motes) {
  console.log(`\n=== validate construction (byte-match vs real deposit) ===`);
  if (!validate()) throw new Error("validation FAILED — refusing to submit");
  console.log("validation PASS — construction is byte-identical to the real deposit\n");

  const priv = PrivateKey.fromPem(readFileSync(PEM, "utf8"), KeyAlgorithm.ED25519);
  const wasm = new Uint8Array(readFileSync(PROXY_WASM));

  const tx = new SessionBuilder()
    .from(priv.publicKey)
    .wasm(wasm)
    .installOrUpgrade()
    .runtimeArgs(proxyArgs(motes))
    .chainName(CHAIN)
    .payment(GAS_MOTES)
    .build();

  // Off-chain structural check of the BUILT tx before signing.
  console.log("=== built tx structure ===");
  console.log("  entryPoint :", tx.entryPoint?.type ?? JSON.stringify(tx.entryPoint));
  console.log("  target     :", tx.target?.session ? "Session" : JSON.stringify(Object.keys(tx.target ?? {})));
  console.log("  isInstallUpgrade:", tx.target?.session?.isInstallUpgrade);
  console.log("  chainName  :", CHAIN);
  console.log("  wrap motes :", motes, `(${Number(motes) / 1e9} CSPR)`);
  console.log("  gas motes  :", GAS_MOTES);

  tx.sign(priv);
  const rpc = new RpcClient(new HttpHandler(RPC_URL));
  const put = await rpc.putTransaction(tx);
  const hash = put.transactionHash.toHex();
  console.log("\n=== SUBMITTED ===");
  console.log("tx hash:", hash);
  console.log("explorer:", `https://testnet.cspr.live/deploy/${hash}`);

  // Poll finality.
  console.log("\npolling finality…");
  const deadline = Date.now() + 180_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    let info;
    try { info = await rpc.getTransactionByTransactionHash(hash); } catch { continue; }
    const ei = info?.executionInfo;
    if (ei && ei.blockHeight !== 0 && ei.executionResult) {
      const err = ei.executionResult.errorMessage;
      console.log("\n=== FINALITY ===");
      console.log("block:", ei.blockHeight);
      console.log("result:", err ? `FAILURE: ${err}` : "SUCCESS");
      console.log("cost:", ei.executionResult.cost ?? ei.executionResult.limit);
      return { hash, status: err ? "failure" : "success", error: err ?? null };
    }
    if (Date.now() > deadline) { console.log("finality timeout"); return { hash, status: "timeout" }; }
  }
}

const mode = process.argv[2] ?? "validate";
if (mode === "validate") {
  console.log("=== validate (byte-match vs real deposit, no tx) ===");
  process.exitCode = validate() ? 0 : 1;
  console.log(process.exitCode === 0 ? "\nVALIDATION PASS" : "\nVALIDATION FAIL");
} else if (mode === "submit") {
  const motes = process.argv[3] ?? "10000000000"; // default 10 CSPR
  const res = await submit(motes);
  process.exitCode = res.status === "success" ? 0 : 1;
} else {
  console.log("usage: node e2e/wrap.mjs [validate|submit] [motes]");
  process.exitCode = 2;
}
