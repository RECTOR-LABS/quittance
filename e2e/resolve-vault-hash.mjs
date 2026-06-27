// Resolve ServicerVault's package hash + entity hash after deploy.
// The package hash is under our account's named key `servicer_vault_package_hash`.
//   node e2e/resolve-vault-hash.mjs [--dump]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const { PublicKey, RpcClient, HttpHandler, EntityIdentifier } = casperSdk;

const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const PUB = "0197f3bf29f93fd7e88f3f6b02f68ef5936cb0aa9d0f9ab3f3a84dd8f511b35b94";
const KEY_NAME = "servicer_vault_package_hash";
const j = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x));

const rpc = new RpcClient(new HttpHandler(RPC_URL));
const pub = PublicKey.fromHex(PUB);
const r = await rpc.getLatestEntity(EntityIdentifier.fromPublicKey(pub));

if (process.argv.includes("--dump")) {
  console.log("FULL RESULT:", j(r).slice(0, 3000));
  process.exit(0);
}

// Named keys can live at a few paths across sdk shapes — probe them.
const candidates = [r.namedKeys, r.entity?.namedKeys, r.AddressableEntity?.namedKeys, r.entity?.entity?.namedKeys];
let entries = null;
for (const c of candidates) {
  if (!c) continue;
  const arr = c.keys ?? c.namedKeys ?? (Array.isArray(c) ? c : null);
  if (Array.isArray(arr)) { entries = arr; break; }
}
if (!entries) {
  console.log("could not locate namedKeys array; re-run with --dump to inspect shape.");
  console.log("top keys:", Object.keys(r));
  process.exit(1);
}

console.log(`found ${entries.length} named keys`);
const hit = entries.find((e) => (e.name ?? e.Name) === KEY_NAME);
if (!hit) {
  console.log("named keys:", entries.map((e) => e.name ?? e.Name).join(", "));
  console.log(`\n'${KEY_NAME}' not found.`);
  process.exit(1);
}
const pkgKey = hit.key ?? hit.Key ?? hit.value ?? hit.namedKey?.key;
console.log("\nServicerVault package key:", j(pkgKey));

// Resolve the entity (contract) hash from the package's latest version.
try {
  const pkgStr = typeof pkgKey === "string" ? pkgKey : (pkgKey?.toString?.() ?? j(pkgKey));
  console.log("package (string):", pkgStr);
  const q = await rpc.queryLatestGlobalState(pkgStr, []);
  console.log("\npackage global-state:", j(q).slice(0, 1500));
} catch (e) {
  console.log("package query err:", e.message);
}
