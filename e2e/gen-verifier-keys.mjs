// ===========================================================================
// Generate 3 independent verifier identities for the Quittance demo.
//
// Each verifier needs ONE Ed25519 keypair that serves two roles:
//   1. verdict signer  — raw 32-byte pubkey hex is the `signer` in SignedVerdict,
//      registered on-chain in ServicerVault `cfg.verifiers` (adapter prefixes
//      "01" to make it a Casper PublicKey), and checked by the agent's quorum.
//   2. Casper account  — its account-hash is the `payTo` the agent pays WCSPR to
//      ("00"+accountHash, the 66-char address the exact scheme requires).
//
// SELF-CHECK: derives the account-hash of our KNOWN funded account
// (pub 0197f3…b35b94) and asserts it equals 05454459…ee524b2 — proving the
// derivation before we trust the verifier identities.
//
// Secrets (private keys) are written ONLY to ~/Documents/secret/quittance/ —
// never the repo. Public identities are printed for contract registration.
//
//   node e2e/gen-verifier-keys.mjs
// ===========================================================================
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
// @noble/ed25519 v2 needs sha512 wired for sync ops; set it once.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const toHex = (u8) => Buffer.from(u8).toString("hex");

/** account-hash hex (64 chars, no prefix) for a raw 32-byte Ed25519 pubkey. */
function accountHashHex(rawPubHex) {
  const pk = casperSdk.PublicKey.fromHex("01" + rawPubHex);
  // v5 AccountHash.toHex() may return "account-hash-<hex>" or bare hex.
  const raw = pk.accountHash().toHex().replace(/^account-hash-/, "");
  return raw.toLowerCase();
}

function identity(label, privU8) {
  const privHex = toHex(privU8);
  const pubHex = toHex(ed.getPublicKey(privU8)); // raw 32-byte pubkey
  const acct = accountHashHex(pubHex);
  return {
    label,
    privHex,                       // VERIFIER_SIGNING_KEY_HEX (secret)
    pubHex,                        // verdict signer + register_asset input (raw)
    casperPublicKey: "01" + pubHex,
    accountHash: acct,
    payTo: "00" + acct,            // VERIFIER_PAYTO
  };
}

// ----------------------------- self-check ---------------------------------
const KNOWN_PUB = "97f3bf29f93fd7e88f3f6b02f68ef5936cb0aa9d0f9ab3f3a84dd8f511b35b94";
const KNOWN_ACCT = "05454459c91497e073217296bb6b4c9da1bae8019a1790a3f87f4dea3ee524b2";
const derived = accountHashHex(KNOWN_PUB);
if (derived !== KNOWN_ACCT) {
  console.error("SELF-CHECK FAILED — account-hash derivation is wrong.");
  console.error("  expected:", KNOWN_ACCT);
  console.error("  derived :", derived);
  process.exit(1);
}
console.log("✓ self-check passed: account-hash derivation matches our known account.\n");

// --------------------------- generate keys --------------------------------
const verifiers = [
  identity("v1", ed.utils.randomPrivateKey()),
  identity("v2", ed.utils.randomPrivateKey()),
  identity("v3", ed.utils.randomPrivateKey()),
];

const secretDir = resolve(homedir(), "Documents/secret/quittance");
mkdirSync(secretDir, { recursive: true });
const outPath = resolve(secretDir, "verifier-keys.json");
writeFileSync(outPath, JSON.stringify({ generatedFor: "casper-test demo", verifiers }, null, 2), { mode: 0o600 });

console.log("Wrote secret key material →", outPath, "(perms 600)\n");
console.log("Public identities (safe to register on-chain / commit in configs):");
for (const v of verifiers) {
  console.log(`\n[${v.label}]`);
  console.log("  pubHex (signer)  :", v.pubHex);
  console.log("  casperPublicKey  :", v.casperPublicKey);
  console.log("  accountHash      :", v.accountHash);
  console.log("  payTo            :", v.payTo);
}
console.log("\nregister_asset verifiers (raw pubHex array):");
console.log(JSON.stringify(verifiers.map((v) => v.pubHex), null, 2));
