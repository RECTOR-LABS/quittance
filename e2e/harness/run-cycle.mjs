// ===========================================================================
// Run one happy or fraud cycle against the live ServicerVault.
//
// This is the LIVE CYCLE RUNNER — it pays real x402 verifiers (scarce quota)
// and calls distribute() on-chain (real CSPR gas). Do NOT run it yourself.
// Only the controller runs it after the pool is funded and verifiers are up.
//
//   node e2e/harness/run-cycle.mjs --dry              # construct + print cfg only
//   node e2e/harness/run-cycle.mjs happy              # LIVE: pays verifiers + distributes
//   node e2e/harness/run-cycle.mjs fraud              # LIVE: pays verifiers, halts on no-quorum
//
// Expected outcomes:
//   happy → CycleOutcome { status: "distributed", distributeTx: "..." }
//   fraud → CycleOutcome { status: "halted", reason: "quorum_not_met" }
// ===========================================================================
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../../.env"));

// Import built adapter dist directly (ESM resolves relative to the dist file,
// so casper-js-sdk and casper-x402 deps resolve via packages/adapters/node_modules).
const ADAPTERS_DIST = resolve(__dirname, "../../packages/adapters/dist/index.js");
const AGENT_DIST    = resolve(__dirname, "../../agent/dist/index.js");

const { CasperVerifierClient, CasperJsChainClient } = await import(ADAPTERS_DIST);
const { runCycle } = await import(AGENT_DIST);

// --------------------------------- config ---------------------------------
const RPC_URL  = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const CHAIN    = process.env.CASPER_NETWORK  ?? "casper:casper-test"; // chain client strips prefix
const PEM_PATH = resolve(__dirname, "../..", process.env.CASPER_SECRET_KEY_PATH);

const VAULT_HASH = process.env.SERVICER_VAULT_HASH;

/** Bigint-safe JSON stringifier. */
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

// ---------------------------------------------------------------------------
// Asset servicing config — shared by both cycles.
// ---------------------------------------------------------------------------
const cfg = {
  assetId: "inv-001",
  vaultHash: VAULT_HASH,
  // 1 000 000 000 000 motes = 1 000 CSPR. The verifiers check the invoice
  // payment amount against this value before issuing a "yes" verdict.
  expectedAmount: "1000000000000",
  expectedReference: "INV-001",
  quorumRequired: 2,
  endpoints: [
    { id: "v1", url: "http://localhost:4101/verify" },
    { id: "v2", url: "http://localhost:4102/verify" },
    { id: "v3", url: "http://localhost:4103/verify" },
  ],
};

// ---------------------------------------------------------------------------
// Construct the real clients (uses the actual secret key PEM — no network
// calls are made during construction itself).
// ---------------------------------------------------------------------------
const verifierClient = new CasperVerifierClient({ secretKeyPath: PEM_PATH });

const chainClient = new CasperJsChainClient({
  secretKeyPath: PEM_PATH,
  rpcUrl: RPC_URL,
  chainName: CHAIN,
  // distribute() does quorum checks + 2 native transfers + receipt storage +
  // event emission; 2.5 CSPR OOGs. 30 CSPR limit (PaymentLimited charges actual).
  paymentMotes: 30_000_000_000,
});

// ---------------------------------------------------------------------------
// Dry mode: confirm clients constructed + print cfg, then exit without running.
// The controller runs the live cycle after verifiers + pool are ready.
// ---------------------------------------------------------------------------
const arg = process.argv[2];

if (!arg || arg === "--dry") {
  console.log("=== run-cycle DRY MODE — import verification + config ===");
  console.log("  CasperVerifierClient :", typeof CasperVerifierClient);
  console.log("  CasperJsChainClient  :", typeof CasperJsChainClient);
  console.log("  runCycle             :", typeof runCycle);
  console.log("\n  clients constructed  : OK (no network)");
  console.log("\n  AssetServicingConfig:");
  console.log(j(cfg).split("\n").map((l) => "  " + l).join("\n"));
  console.log("\n  rpcUrl               :", RPC_URL);
  console.log("  chainName            :", CHAIN);
  console.log("  pemPath              :", PEM_PATH);
  console.log("\nDRY MODE PASS — no on-chain calls made");
  process.exitCode = 0;

} else if (arg === "happy" || arg === "fraud") {
  // ---------------------------------------------------------------------------
  // LIVE CYCLE — only runs when controller explicitly passes happy/fraud.
  // Pays real verifiers (x402 quota) and may call distribute() (real gas).
  // ---------------------------------------------------------------------------
  console.log(`=== run-cycle LIVE: ${arg} ===`);
  console.log("  assetId    :", cfg.assetId);
  console.log("  vaultHash  :", cfg.vaultHash);
  console.log("  cycleId    :", arg);
  console.log("  quorum     :", cfg.quorumRequired);
  console.log("  verifiers  :", cfg.endpoints.map((e) => `${e.id}@${e.url}`).join(", "));
  console.log("\nrunning cycle…");

  const outcome = await runCycle({ verifierClient, chainClient }, cfg, arg);

  console.log("\n=== CycleOutcome ===");
  console.log(j(outcome));
  process.exitCode = outcome.status === "distributed" || outcome.status === "halted" ? 0 : 1;

  // The agent submits distribute() but does NOT await finality (a known gap),
  // so a "distributed" status only means "submitted". Verify it actually landed.
  if (outcome.distributeTx) {
    console.log("\nverifying distribute finality on-chain…");
    try {
      const status = await chainClient.waitForFinality(outcome.distributeTx);
      console.log(`  distribute ${outcome.distributeTx.slice(0, 16)}… → ${status.toUpperCase()}`);
      if (status !== "success") process.exitCode = 1;
    } catch (e) {
      console.log("  finality check error:", e.message);
      process.exitCode = 1;
    }
  }

} else {
  console.log("usage: node e2e/harness/run-cycle.mjs [--dry|happy|fraud]");
  process.exitCode = 2;
}
