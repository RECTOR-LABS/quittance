// Read the ACTIVE WCSPR contract (v7) entrypoints + named keys. Read-only.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;

const TOKEN = process.env.CSPR_CLOUD_TOKEN;
const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const REST = "https://api.testnet.cspr.cloud";
const V7 = "4b351800391d4a47a7f932e9498516ed59bb41056d2743c14a8b1a5f90f67b3e";
const H = { Authorization: TOKEN };
const redact = (e) => {
  const s = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return TOKEN ? s.split(TOKEN).join("<TOKEN>") : s;
};
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

// ---- RPC: full Contract object (entrypoints + named keys) ---------------------
console.log("=== RPC queryLatestGlobalState hash-" + V7 + " ===");
try {
  const { RpcClient, HttpHandler } = casperSdk;
  const rpc = new RpcClient(new HttpHandler(RPC_URL));
  const res = await rpc.queryLatestGlobalState(`hash-${V7}`, []);
  const sv = res?.storedValue ?? res?.rawJSON ?? res;
  console.log("top keys:", Object.keys(sv ?? {}));
  const c = sv?.contract ?? sv?.Contract ?? sv;
  // entrypoints
  const eps = c?.entryPoints ?? c?.entry_points ?? [];
  console.log("\n--- ENTRYPOINTS (" + eps.length + ") ---");
  for (const ep of eps) {
    const e = ep?.entryPoint ?? ep;
    const name = e?.name;
    const args = (e?.args ?? []).map((a) => `${a.name}: ${j(a.clType ?? a.cl_type)}`).join(", ");
    console.log(`  • ${name}(${args})  ret=${j(e?.ret ?? e?.entryPointType ?? "")}`);
  }
  // named keys
  const nk = c?.namedKeys?.keys ?? c?.namedKeys ?? c?.named_keys ?? [];
  const names = Array.isArray(nk) ? nk.map((k) => k.name ?? k) : Object.keys(nk);
  console.log("\n--- NAMED KEYS ---");
  console.log(j(names));
} catch (e) { console.log("RPC error:", redact(e)); }

// ---- REST entry-points (richer ABI if available) ------------------------------
console.log("\n=== REST /contracts/" + V7 + "/entry-points ===");
try {
  const res = await fetch(`${REST}/contracts/${V7}/entry-points?page_size=100`, { headers: H });
  console.log("status:", res.status);
  if (res.ok) {
    const body = await res.json();
    for (const row of body?.data ?? []) {
      const a = row?.entry_point ?? row;
      const args = (a?.args ?? []).map((x) => `${x.name}: ${j(x.cl_type)}`).join(", ");
      console.log(`  • ${a?.name}(${args})`);
    }
  } else {
    console.log("body:", (await res.text()).slice(0, 300));
  }
} catch (e) { console.log("REST error:", redact(e)); }

console.log("\n=== done ===");
