// Discover the WCSPR contract's `deposit` (wrap) interface BEFORE submitting any
// on-chain tx. Read-only. NEVER logs the CSPR.cloud token.
//
//   node e2e/discover-deposit.mjs
//
// Sources, most authoritative first:
//   1. CSPR.cloud REST contract-package -> active contract hash + metadata
//   2. CSPR.cloud REST contract entry-points (full ABI w/ arg names+types)
//   3. RPC entity read (entrypoints + named keys), as a cross-check
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
if (!TOKEN) throw new Error("CSPR_CLOUD_TOKEN missing");
if (!PKG) throw new Error("WCSPR_PACKAGE_HASH missing");
const H = { Authorization: TOKEN };

function redact(e) {
  const s = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return TOKEN ? s.split(TOKEN).join("<TOKEN>") : s;
}
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

async function getJson(url) {
  const res = await fetch(url, { headers: H });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  return { status: res.status, body };
}

let activeContractHash;

// ---- 1. contract-package: find the active contract version --------------------
console.log("=== 1. REST /contract-packages/" + PKG + " ===");
try {
  const { status, body } = await getJson(`${REST}/contract-packages/${PKG}`);
  console.log("status:", status);
  const data = body?.data ?? body;
  // Print just the useful fields to keep output readable.
  const slim = {
    contract_package_hash: data?.contract_package_hash,
    contract_name: data?.contract_name,
    latest_version_contract_type_id: data?.latest_version_contract_type_id,
    metadata: data?.metadata,
  };
  console.log(j(slim));
  // versions array may carry the active contract hash
  if (Array.isArray(data?.versions)) {
    console.log("versions:", j(data.versions));
  }
} catch (e) { console.log("error:", redact(e)); }

// ---- 2. contracts list for the package: get active contract hash --------------
console.log("\n=== 2. REST /contracts?contract_package_hash=" + PKG + " ===");
try {
  const { status, body } = await getJson(
    `${REST}/contracts?contract_package_hash=${PKG}&order_direction=DESC&page=1&page_size=20`,
  );
  console.log("status:", status);
  const rows = body?.data ?? [];
  for (const r of rows) {
    console.log(`  contract_hash=${r.contract_hash} version=${r.contract_version} enabled=${!r.is_disabled ?? r.protocol_version}`);
  }
  // pick the highest-version enabled contract
  const enabled = rows.filter((r) => !r.is_disabled);
  const pick = (enabled.length ? enabled : rows).sort(
    (a, b) => (b.contract_version ?? 0) - (a.contract_version ?? 0),
  )[0];
  activeContractHash = pick?.contract_hash;
  console.log("=> active contract hash:", activeContractHash);
} catch (e) { console.log("error:", redact(e)); }

// ---- 3. entry-points ABI for the active contract ------------------------------
if (activeContractHash) {
  console.log("\n=== 3. REST /contracts/" + activeContractHash + "/entry-points ===");
  try {
    const { status, body } = await getJson(
      `${REST}/contracts/${activeContractHash}/entry-points?page_size=100`,
    );
    console.log("status:", status);
    const rows = body?.data ?? [];
    for (const ep of rows) {
      const action = ep?.entry_point ?? ep;
      const args = (action?.args ?? []).map((a) => `${a.name}: ${typeof a.cl_type === "object" ? j(a.cl_type) : a.cl_type}`);
      console.log(`\n  • ${action?.name}  (access=${j(action?.access)}, ret=${j(action?.ret)})`);
      for (const a of args) console.log(`      ${a}`);
    }
  } catch (e) { console.log("error:", redact(e)); }
}

// ---- 4. RPC cross-check: entity entrypoints + named keys ----------------------
console.log("\n=== 4. RPC entity entrypoints + named keys ===");
try {
  const { RpcClient, HttpHandler } = casperSdk;
  const rpc = new RpcClient(new HttpHandler(RPC_URL));
  const target = activeContractHash
    ? `entity-contract-${activeContractHash.replace(/^(hash-|contract-)/, "")}`
    : `hash-${PKG}`;
  console.log("querying:", target);
  const res = await rpc.queryLatestGlobalState(target, []);
  const sv = res?.storedValue ?? res?.rawJSON ?? res;
  const keys = Object.keys(sv ?? {});
  console.log("storedValue top keys:", keys);
  // AddressableEntity / Contract: dump entrypoints + named keys names only
  const entity = sv?.addressableEntity ?? sv?.AddressableEntity ?? sv?.contract ?? sv?.Contract ?? sv;
  if (entity?.entryPoints || entity?.entry_points) {
    const eps = entity.entryPoints ?? entity.entry_points;
    console.log("entrypoints:", j(eps).slice(0, 4000));
  }
  if (entity?.namedKeys || entity?.named_keys) {
    const nk = entity.namedKeys ?? entity.named_keys;
    const names = (nk?.keys ?? nk)?.map?.((x) => x.name) ?? Object.keys(nk ?? {});
    console.log("named key names:", j(names));
  } else {
    console.log("full storedValue (trunc):", j(sv).slice(0, 3000));
  }
} catch (e) { console.log("error:", redact(e)); }

console.log("\n=== deposit discovery done ===");
