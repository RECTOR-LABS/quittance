// ===========================================================================
// Snapshot native CSPR balances for the demo accounts.
// Read-only — safe to run at any time, before or after live cycles.
//
//   node e2e/harness/check-balances.mjs
//
// Queries:
//   A. Agent    — main_purse_under_public_key (pubkey from env)
//   B. holderA  — main_purse_under_public_key (casperPublicKey from holder-keys.json)
//   C. holderB  — same
//   D. Vault pool for "inv-001" — distributed dict + pool_of dict (graceful-fail if absent)
// ===========================================================================
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../../.env"));
const require = createRequire(resolve(__dirname, "../../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const {
  RpcClient, HttpHandler,
  ParamDictionaryIdentifier, ParamDictionaryIdentifierContractNamedKey,
  PublicKey, PurseIdentifier,
} = casperSdk;

// --------------------------------- config ---------------------------------
const RPC_URL    = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const VAULT_HASH = process.env.SERVICER_VAULT_HASH;

// Agent's known public key (Ed25519, 01-prefixed).
const AGENT_PUBKEY_HEX = "0197f3bf29f93fd7e88f3f6b02f68ef5936cb0aa9d0f9ab3f3a84dd8f511b35b94";

const ASSET_ID = "inv-001";

/** Bigint-safe JSON stringifier. */
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

/** Format motes as "X motes (Y CSPR)". */
const fmtMotes = (m) => {
  const n = typeof m === "bigint" ? m : BigInt(m);
  return `${n} motes (${Number(n) / 1e9} CSPR)`;
};

// Load holder public keys from the strategy secret store.
function loadHolderKeys() {
  const path = resolve(homedir(), "Documents/secret/quittance/holder-keys.json");
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const holders = raw.holders ?? [];
    return holders.map((h) => ({ label: h.label, pubHex: h.casperPublicKey }));
  } catch (err) {
    console.warn(`  [warn] could not read holder-keys.json: ${err.message}`);
    return [];
  }
}

// RPC error codes that mean "account has no main purse yet" (unfunded new account).
// casper-js-sdk v5 uses err.statusCode (not err.code) for JSON-RPC error codes.
const NO_PURSE_CODES = new Set([-32026, -32009]); // PurseNotFound, NoSuchAccount

/** Query the main-purse native CSPR balance for a given 01-prefixed pubkey hex. */
async function queryNativeBalance(rpc, label, pubHex) {
  try {
    const pub = PublicKey.fromHex(pubHex);
    const purseId = PurseIdentifier.fromPublicKey(pub);
    const result = await rpc.queryLatestBalance(purseId);
    const balance = result?.balance ?? result;
    console.log(`  ${label.padEnd(10)}: ${fmtMotes(balance)}`);
  } catch (err) {
    const code = err?.statusCode;
    const noPurse = typeof code === "number" && NO_PURSE_CODES.has(code);
    console.log(`  ${label.padEnd(10)}: ${noPurse ? "(no main purse — unfunded account)" : `ERROR — ${err.message}`}`);
  }
}

/** Query a named-key dictionary item on the vault contract. */
async function queryVaultDict(rpc, dict, key) {
  if (!VAULT_HASH) return console.log(`  (SERVICER_VAULT_HASH not set — skipping dict read)`);
  const hashWithPrefix = `hash-${VAULT_HASH.replace(/^(?:hash-|contract-)/, "")}`;
  try {
    const namedKey = new ParamDictionaryIdentifierContractNamedKey(hashWithPrefix, dict, key);
    const identifier = new ParamDictionaryIdentifier(undefined, namedKey, undefined, undefined);
    const result = await rpc.getDictionaryItemByIdentifier(null, identifier);
    const clValue = result?.storedValue?.clValue ?? result?.storedValue;
    console.log(`  dict[${dict}][${key}]: ${j(clValue).slice(0, 200)}`);
  } catch (err) {
    // Absent dict item is normal before register_asset / fund / distribute.
    // NodeRequestFailed (-32018) is what the node returns when a named-key dict
    // doesn't yet exist on the contract (created lazily on first write).
    // casper-js-sdk v5 uses err.statusCode (not err.code) for JSON-RPC error codes.
    const ABSENT_CODES = new Set([-32003, -32004, -32010, -32002, -32018]);
    const code = err?.statusCode;
    const isAbsent =
      (typeof code === "number" && ABSENT_CODES.has(code)) ||
      /not.?found|does.?not.?exist|dictionary.?item|valuenotfound/i.test(err.message ?? "");
    console.log(`  dict[${dict}][${key}]: ${isAbsent ? "(not yet set)" : `ERROR — ${err.message}`}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const rpc = new RpcClient(new HttpHandler(RPC_URL));

console.log("=== check-balances (read-only snapshot) ===");
console.log("  rpcUrl     :", RPC_URL);
console.log("  vaultHash  :", VAULT_HASH ?? "(not set)");
console.log();

// A. Native CSPR balances
console.log("--- A. native CSPR balances (main_purse_under_public_key) ---");
await queryNativeBalance(rpc, "agent", AGENT_PUBKEY_HEX);

const holders = loadHolderKeys();
for (const h of holders) {
  await queryNativeBalance(rpc, h.label, h.pubHex);
}
if (holders.length === 0) {
  console.log("  (no holder keys loaded — run gen-holders.mjs first)");
}

// B. Vault dict reads (pool balance + distributed flag)
console.log("\n--- B. vault dict reads ---");
await queryVaultDict(rpc, "pool_of", ASSET_ID);
await queryVaultDict(rpc, "distributed", `${ASSET_ID}:happy`);
await queryVaultDict(rpc, "distributed", `${ASSET_ID}:fraud`);

console.log("\n=== done ===");
