// Discovery: find the WCSPR EIP-712 domain `name` / `version` the CSPR.cloud
// facilitator expects. Off-chain reads only. NEVER logs the access token.
//
//   node e2e/discover-wcspr.mjs
//
// Strategies (all best-effort; we print whatever resolves):
//   A. GET {FACILITATOR}/supported            — what schemes/networks/extra it advertises
//   B. CSPR.cloud REST contract-package        — on-chain token metadata (name/symbol)
//   C. RPC named keys (queryLatestGlobalState) — the contract's stored named keys
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));

const TOKEN = process.env.CSPR_CLOUD_TOKEN;
const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://x402-facilitator.cspr.cloud";
const PKG = process.env.WCSPR_PACKAGE_HASH;
const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const REST_BASE = "https://api.testnet.cspr.cloud";

if (!TOKEN) throw new Error("CSPR_CLOUD_TOKEN missing from .env");
if (!PKG) throw new Error("WCSPR_PACKAGE_HASH missing from .env");

const authHeaders = { Authorization: TOKEN };

function redact(err) {
  // Defensive: never let the token leak via an error string.
  const s = err instanceof Error ? err.message : String(err);
  return TOKEN ? s.split(TOKEN).join("<redacted>") : s;
}

async function strategyA() {
  console.log("\n=== A. GET /supported (facilitator) ===");
  try {
    const res = await fetch(`${FACILITATOR}/supported`, { headers: authHeaders });
    console.log("status:", res.status, res.statusText);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log("body:", text.slice(0, 1000));
    }
  } catch (err) {
    console.log("error:", redact(err));
  }
}

async function strategyB() {
  console.log("\n=== B. CSPR.cloud REST contract-package metadata ===");
  for (const path of [
    `/contract-packages/${PKG}`,
    `/contracts/${PKG}`,
  ]) {
    try {
      const res = await fetch(`${REST_BASE}${path}`, { headers: authHeaders });
      console.log(`GET ${path} ->`, res.status, res.statusText);
      if (res.ok) {
        const json = await res.json();
        console.log(JSON.stringify(json, null, 2).slice(0, 2500));
      }
    } catch (err) {
      console.log(`GET ${path} error:`, redact(err));
    }
  }
}

async function strategyC() {
  console.log("\n=== C. RPC named keys of the WCSPR contract ===");
  const casperSdk = (await import("casper-js-sdk")).default;
  const { RpcClient, HttpHandler } = casperSdk;
  const rpc = new RpcClient(new HttpHandler(RPC_URL));

  // Resolve the package -> latest contract entity, then dump its named keys and
  // read the name/version/symbol/decimals values.
  const candidates = [`hash-${PKG}`, `package-${PKG}`, `entity-contract-${PKG}`, PKG];
  for (const key of candidates) {
    try {
      const res = await rpc.queryLatestGlobalState(key, []);
      console.log(`\nqueryLatestGlobalState("${key}") OK -> storedValue keys:`,
        Object.keys(res?.storedValue ?? {}));
      console.log(JSON.stringify(res?.storedValue ?? res, null, 2).slice(0, 2000));
    } catch (err) {
      console.log(`queryLatestGlobalState("${key}") -> ${redact(err)}`);
    }
  }

  // Try reading named keys directly off the latest entity (Condor 2.0).
  try {
    const { EntityIdentifier, EntityAddr } = casperSdk;
    // Some SDK builds expose EntityAddr.fromPrefixedString; guard for absence.
    let entityId;
    if (EntityAddr?.fromPrefixedString) {
      const addr = EntityAddr.fromPrefixedString(`entity-contract-${PKG}`);
      entityId = EntityIdentifier.fromEntityAddr(addr);
    }
    if (entityId) {
      const ent = await rpc.getLatestEntity(entityId);
      console.log("\ngetLatestEntity OK. namedKeys:");
      console.log(JSON.stringify(ent?.namedKeys ?? ent, null, 2).slice(0, 2500));
    }
  } catch (err) {
    console.log("getLatestEntity ->", redact(err));
  }
}

await strategyA();
await strategyB();
await strategyC();
console.log("\n=== discovery done ===");
