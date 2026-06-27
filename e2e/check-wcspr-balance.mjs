// Read our account's current WCSPR balance. Read-only. NEVER logs the token.
// Tries CSPR.cloud REST ft-balance endpoints + a direct balances-dict read.
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
const ACCT_HASH = "05454459c91497e073217296bb6b4c9da1bae8019a1790a3f87f4dea3ee524b2";
const PUBKEY = "0197f3bf29f93fd7e88f3f6b02f68ef5936cb0aa9d0f9ab3f3a84dd8f511b35b94";
const BALANCES_UREF = "uref-f8491246e0eed9c5cd5c0a896dc6e0a270bba846df69b6d497c9694dcdc2770c-007";
const H = { Authorization: TOKEN };
const redact = (e) => {
  const s = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return TOKEN ? s.split(TOKEN).join("<TOKEN>") : s;
};
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

// ---- A. CSPR.cloud REST ft-balance endpoints ----------------------------------
console.log("=== A. CSPR.cloud ft-balance endpoints ===");
for (const ep of [
  `/accounts/${ACCT_HASH}/ft-token-ownership?contract_package_hash=${PKG}`,
  `/accounts/${PUBKEY}/ft-token-ownership?contract_package_hash=${PKG}`,
  `/contract-packages/${PKG}/ft-token-ownership?account_hash=${ACCT_HASH}`,
  `/accounts/${ACCT_HASH}/fungible-token-balances`,
]) {
  try {
    const res = await fetch(`${REST}${ep}`, { headers: H });
    console.log(`GET ${ep.split("?")[0]} -> ${res.status}`);
    if (res.ok) console.log("  ", JSON.stringify((await res.json())?.data ?? {}).slice(0, 600));
  } catch (e) { console.log("  err:", redact(e)); }
}

// ---- B. Direct balances dictionary read via URef ------------------------------
// CEP-18 balances dict key varies by implementation. Try common encodings of the
// account Key: raw account-hash hex, "account-hash-"+hex, and base64 of the
// Key's serialized bytes (00 tag + 32 bytes).
console.log("\n=== B. balances dict via URef ===");
const { RpcClient, HttpHandler } = casperSdk;
const rpc = new RpcClient(new HttpHandler(RPC_URL));
const keyBytes = new Uint8Array(33);
keyBytes[0] = 0x00; // Account variant tag
for (let i = 0; i < 32; i++) keyBytes[i + 1] = parseInt(ACCT_HASH.slice(i * 2, i * 2 + 2), 16);
const b64 = Buffer.from(keyBytes).toString("base64");
const candidates = [ACCT_HASH, `account-hash-${ACCT_HASH}`, b64, Buffer.from(ACCT_HASH, "hex").toString("base64")];
for (const dk of candidates) {
  try {
    const res = await rpc.getDictionaryItemByURef(null, dk, BALANCES_UREF);
    console.log(`dictKey ${dk.slice(0, 24)}... -> OK`);
    console.log("   value:", j(res?.storedValue?.clValue ?? res?.storedValue).slice(0, 300));
  } catch (e) {
    console.log(`dictKey ${dk.slice(0, 24)}... -> ${redact(e).slice(0, 90)}`);
  }
}
console.log("\n=== done ===");
