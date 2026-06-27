// Empirically discover the REAL `deposit` calling convention by finding a past
// successful deposit tx on the WCSPR contract and reading its runtime args.
// Read-only. NEVER logs the token.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));

const TOKEN = process.env.CSPR_CLOUD_TOKEN;
const PKG = process.env.WCSPR_PACKAGE_HASH;
const V7 = "4b351800391d4a47a7f932e9498516ed59bb41056d2743c14a8b1a5f90f67b3e";
const REST = "https://api.testnet.cspr.cloud";
const H = { Authorization: TOKEN };
const redact = (e) => {
  const s = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return TOKEN ? s.split(TOKEN).join("<TOKEN>") : s;
};
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

// Probe a set of plausible CSPR.cloud endpoints for contract-call history.
const endpoints = [
  `/contracts/${V7}/deploys?page_size=20&order_direction=DESC`,
  `/contract-packages/${PKG}/deploys?page_size=20&order_direction=DESC`,
  `/contracts/${V7}/extrinsics?page_size=20`,
  `/contracts/${V7}/transactions?page_size=20`,
  `/deploys?contract_package_hash=${PKG}&page_size=20`,
];

for (const ep of endpoints) {
  console.log(`\n=== GET ${ep.split("?")[0]} ===`);
  try {
    const res = await fetch(`${REST}${ep}`, { headers: H });
    console.log("status:", res.status);
    if (!res.ok) { console.log("body:", (await res.text()).slice(0, 200)); continue; }
    const body = await res.json();
    const rows = body?.data ?? [];
    console.log(`rows: ${rows.length}`);
    // Surface entry_point + args for any deposit-like call.
    for (const r of rows.slice(0, 20)) {
      const entry = r.entry_point_name ?? r.entry_point ?? r.entry_point_id ?? r?.action;
      const hash = r.deploy_hash ?? r.transaction_hash ?? r.hash;
      console.log(`  ${hash}  entry=${j(entry)}  args?=${r.args ? "yes" : "no"}`);
      if (String(entry).includes("deposit") && r.args) {
        console.log("    DEPOSIT ARGS:", j(r.args));
      }
    }
  } catch (e) { console.log("error:", redact(e)); }
}
console.log("\n=== done ===");
