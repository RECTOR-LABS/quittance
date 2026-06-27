// Query the ServicerVault package to extract its contract ENTITY hash.
//   node e2e/resolve-package.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const { RpcClient, HttpHandler } = casperSdk;

const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const PKG = "fb5225d80e8bc59d7e8581f6be2118e3442ab69eea432d9ad79daf1fbd222d3f";
const j = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x));

const rpc = new RpcClient(new HttpHandler(RPC_URL));

for (const key of [`package-${PKG}`, `hash-${PKG}`, `entity-contract-${PKG}`]) {
  try {
    const q = await rpc.queryLatestGlobalState(key, []);
    console.log(`\n=== ${key} ===`);
    console.log(j(q).slice(0, 2000));
  } catch (e) {
    console.log(`\n${key} → ERR: ${e.message}`);
  }
}
