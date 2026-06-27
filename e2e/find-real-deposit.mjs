// Empirically find a REAL past `deposit` on the WCSPR contract and read its
// session runtime args via RPC getDeploy — gives the EXACT purse arg name with
// certainty. Read-only. NEVER logs the token.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;

const TOKEN = process.env.CSPR_CLOUD_TOKEN;
const PKG = process.env.WCSPR_PACKAGE_HASH;
const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const REST = "https://api.testnet.cspr.cloud";
const H = { Authorization: TOKEN };
const redact = (e) => {
  const s = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return TOKEN ? s.split(TOKEN).join("<TOKEN>") : s;
};
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

// 1. Find recent WCSPR token actions (mint on deposit). Surface their deploy hashes.
console.log("=== ft-token-actions for WCSPR package ===");
let depositDeploys = [];
for (const ep of [
  `/contract-packages/${PKG}/ft-token-actions?page_size=30&order_by=block_height&order_direction=DESC`,
  `/contract-packages/${PKG}/ft-token-actions?page_size=30&order_by=timestamp&order_direction=DESC`,
]) {
  try {
    const res = await fetch(`${REST}${ep}`, { headers: H });
    console.log(`GET ${ep.split("?")[0]} -> ${res.status}`);
    if (!res.ok) { console.log("  body:", (await res.text()).slice(0, 200)); continue; }
    const rows = (await res.json())?.data ?? [];
    console.log("  sample row:", j(rows[0] ?? {}).slice(0, 500));
    for (const r of rows.slice(0, 30)) {
      const type = r.ft_action_type_id ?? r.action_type ?? r.type;
      const dh = r.deploy_hash ?? r.transaction_hash;
      // mint actions (from null/zero) signal a deposit
      const from = r.from_hash ?? r.from;
      if (!from || from === "0".repeat(64) || type === 1 /*mint*/) {
        if (dh) depositDeploys.push(dh);
      }
    }
    console.log("  candidate mint/deposit deploys:", depositDeploys.slice(0, 8));
    if (depositDeploys.length) break;
  } catch (e) { console.log("  err:", redact(e)); }
}

// 2. For each candidate, RPC getDeploy and inspect the session (ModuleBytes args).
const { RpcClient, HttpHandler } = casperSdk;
const rpc = new RpcClient(new HttpHandler(RPC_URL));
console.log("\n=== inspect candidate deploys' session args ===");
async function fetchAny(dh) {
  // Legacy Deploy first; fall back to Condor TransactionV1.
  try { return { kind: "deploy", info: await rpc.getDeploy(dh) }; }
  catch { return { kind: "tx", info: await rpc.getTransactionByTransactionHash(dh) }; }
}
for (const dh of depositDeploys.slice(0, 6)) {
  try {
    const { kind, info } = await fetchAny(dh);
    const dep = info?.deploy ?? info?.transaction ?? info;
    const raw = info?.rawJSON ?? dep?.rawJSON ?? {};
    const session = dep?.session ?? raw?.session ?? raw?.Deploy?.session
      ?? raw?.Version1?.body ?? dep?.body;
    console.log(`\n${dh}  [${kind}]`);
    console.log("  raw keys:", Object.keys(raw ?? {}), "session keys:", Object.keys(session ?? {}));
    // Dump any args we can find, looking for 'purse'/'amount'.
    console.log("  RAW (trunc):", j(raw).slice(0, 1200));
    continue;
    const moduleBytes = session?.ModuleBytes ?? session?.moduleBytes;
    const storedCall = session?.StoredContractByHash ?? session?.StoredVersionedContractByHash;
    const args = moduleBytes?.args ?? storedCall?.args ?? session?.args;
    const entry = storedCall?.entry_point ?? storedCall?.entryPoint;
    const argNames = Array.isArray(args) ? args.map((a) => Array.isArray(a) ? a[0] : a?.name ?? a?.[0]) : args;
    console.log(`\n${dh}`);
    console.log("  session kind:", Object.keys(session ?? {}));
    console.log("  entry_point:", entry ?? "(session ModuleBytes)");
    console.log("  arg names:", j(argNames));
    if (String(JSON.stringify(argNames)).match(/purse/i)) {
      console.log("  >>> FULL ARGS:", j(args).slice(0, 1500));
    }
  } catch (e) { console.log(`${dh} -> ${redact(e).slice(0, 120)}`); }
}
console.log("\n=== done ===");
