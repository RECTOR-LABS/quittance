// Generate 2 holder accounts (receive-only) for the Quittance demo.
// Holders receive native CSPR pro-rata from distribute(); they never sign.
// Reuses the validated account-hash derivation (see gen-verifier-keys.mjs).
//   node e2e/gen-holders.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const requireCore = createRequire(resolve(__dirname, "../packages/core/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const ed = await import(requireCore.resolve("@noble/ed25519"));
const { sha512 } = await import(requireCore.resolve("@noble/hashes/sha512"));
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const toHex = (u8) => Buffer.from(u8).toString("hex");
function identity(label, weight, privU8) {
  const pubHex = toHex(ed.getPublicKey(privU8));
  const acct = casperSdk.PublicKey.fromHex("01" + pubHex).accountHash().toHex().replace(/^account-hash-/, "").toLowerCase();
  return { label, weight, privHex: toHex(privU8), pubHex, casperPublicKey: "01" + pubHex, accountHash: acct };
}

const holders = [
  identity("holderA", "70", ed.utils.randomPrivateKey()),
  identity("holderB", "30", ed.utils.randomPrivateKey()),
];

const dir = resolve(homedir(), "Documents/secret/quittance");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "holder-keys.json"), JSON.stringify({ generatedFor: "casper-test demo", holders }, null, 2), { mode: 0o600 });

console.log("Wrote holder keys → ~/Documents/secret/quittance/holder-keys.json (600)\n");
for (const h of holders) {
  console.log(`[${h.label}] weight ${h.weight}`);
  console.log("  pubHex      :", h.pubHex);
  console.log("  accountHash :", h.accountHash);
}
console.log("\nregister_asset holders (accountHash, weight):");
console.log(JSON.stringify(holders.map((h) => [h.accountHash, h.weight]), null, 2));
