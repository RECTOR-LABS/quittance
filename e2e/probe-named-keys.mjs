// Probe the WCSPR contract's named keys via RPC to discover any stored EIP-712
// `version` / domain key. Read-only, no facilitator quota cost.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;

const PKG = process.env.WCSPR_PACKAGE_HASH;
const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const { RpcClient, HttpHandler } = casperSdk;
const rpc = new RpcClient(new HttpHandler(RPC_URL));

function dump(label, val) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(val, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, 3000));
}

// 1. Resolve the package to find its current contract/entity hash.
for (const key of [`hash-${PKG}`, `package-${PKG}`, `entity-contract-${PKG}`]) {
  try {
    const res = await rpc.queryLatestGlobalState(key, []);
    const sv = res?.storedValue ?? res?.rawJSON ?? res;
    console.log(`\n==== queryLatestGlobalState("${key}") OK ====`);
    console.log("storedValue keys:", Object.keys(sv ?? {}));
    dump(key, sv);
  } catch (err) {
    console.log(`queryLatestGlobalState("${key}") -> ${err instanceof Error ? err.message : err}`);
  }
}

// 2. Try reading common CEP-18 / EIP-712 named keys directly off the entity.
const NAMED_KEY_CANDIDATES = ["name", "symbol", "decimals", "version", "domain_separator",
  "eip712_version", "eip712_name", "domain_version", "DOMAIN_SEPARATOR"];
for (const base of [`hash-${PKG}`, `entity-contract-${PKG}`]) {
  for (const nk of NAMED_KEY_CANDIDATES) {
    try {
      const res = await rpc.queryLatestGlobalState(base, [nk]);
      const sv = res?.storedValue;
      const cl = sv?.clValue ?? sv?.CLValue ?? sv;
      console.log(`namedKey ${base} ["${nk}"] ->`, JSON.stringify(cl, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 300));
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (!/not.*found|ValueNotFound|QueryFailed|dictionary|URef|Invalid|prefix|parse/i.test(m)) {
        console.log(`namedKey ${base} ["${nk}"] ERR: ${m.slice(0, 120)}`);
      }
    }
  }
}
console.log("\n=== named-key probe done ===");
