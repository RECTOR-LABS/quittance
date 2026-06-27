// ===========================================================================
// Boot 3 independent x402-gated verifier instances for the Quittance demo.
//
// Reads verifier private keys from ~/Documents/secret/quittance/verifier-keys.json
// (NEVER from the repo), loads shared creds from ../.env, and launches
// verifiers/dist/serve.js x3 with per-instance env on ports 4101/4102/4103.
//
// PREREQ: build verifiers first →  pnpm --filter @quittance/verifier build
//
//   node e2e/verifiers/boot.mjs          # runs until Ctrl-C (kills children)
// ===========================================================================
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
process.loadEnvFile(resolve(repoRoot, ".env"));

const SERVE = resolve(repoRoot, "verifiers/dist/serve.js");
if (!existsSync(SERVE)) {
  console.error(`missing ${SERVE}\n→ build first: pnpm --filter @quittance/verifier build`);
  process.exit(1);
}

const KEYS = JSON.parse(
  readFileSync(resolve(homedir(), "Documents/secret/quittance/verifier-keys.json"), "utf8"),
).verifiers;

const REFERENCE = "INV-001";
const PRICE_MOTES = "1000000000"; // 1 WCSPR per verification
const PORTS = { v1: 4101, v2: 4102, v3: 4103 };

const children = [];
for (const v of KEYS) {
  const port = PORTS[v.label];
  const env = {
    ...process.env,
    CASPER_NETWORK: "casper-test", // serve.ts prefixes "casper:"; .env value is already-prefixed
    VERIFIER_LABEL: v.label,
    VERIFIER_PORT: String(port),
    VERIFIER_SIGNING_KEY_HEX: v.privHex,
    VERIFIER_PAYTO: v.payTo,
    VERIFIER_PRICE_MOTES: PRICE_MOTES,
    VERIFIER_EVIDENCE_PATH: resolve(__dirname, `evidence/${v.label}.json`),
    VERIFIER_EXPECTED_REFERENCE: REFERENCE,
  };
  const child = spawn(process.execPath, [SERVE], { env, stdio: ["ignore", "inherit", "inherit"] });
  children.push(child);
  console.log(`[boot] ${v.label} → http://localhost:${port}/verify  (payTo ${v.payTo.slice(0, 10)}…)`);
}

console.log(`\n[boot] ${children.length} verifiers starting. Endpoints:`);
for (const [label, port] of Object.entries(PORTS)) {
  console.log(`  ${label}: http://localhost:${port}/verify`);
}
console.log("[boot] Ctrl-C to stop all.\n");

function shutdown() {
  console.log("\n[boot] shutting down verifiers…");
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
