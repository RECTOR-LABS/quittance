// ===========================================================================
// THE qualifying tx: settle a real x402 payment on casper-test. Signs an
// EIP-712 `transfer_with_authorization` (1 WCSPR, from=our account, to=our own
// account-hash => a real on-chain self-transfer settlement) and POSTs it to the
// live CSPR.cloud facilitator /settle, which submits + pays gas on-chain.
//
// Reuses the EXACT payload construction proven by verify-spike.mjs (which the
// facilitator accepted at /verify with isValid:true, domain name "Wrapped CSPR"
// version "1"). NEVER logs the token.
//
//   node e2e/settle.mjs [version] [name]
// ===========================================================================
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const x402EsmPath = require
  .resolve("@make-software/casper-x402")
  .replace("/dist/cjs/index.js", "/dist/esm/index.mjs");
const { createClientCasperSigner, ExactCasperScheme } = await import(x402EsmPath);

const TOKEN = req("CSPR_CLOUD_TOKEN");
const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://x402-facilitator.cspr.cloud";
const PEM_PATH = resolve(__dirname, "..", req("CASPER_SECRET_KEY_PATH"));
const ASSET = req("WCSPR_PACKAGE_HASH");
const NETWORK = process.env.CASPER_NETWORK ?? "casper:casper-test";
const X402_VERSION = 2;

// Self-settlement: payTo = our OWN account-hash, "00"-prefixed to the 66-char
// account-hash address form the scheme requires. from == to: a real on-chain
// transfer_with_authorization that consumes the nonce + verifies the signature.
const OUR_ACCT_HASH = "05454459c91497e073217296bb6b4c9da1bae8019a1790a3f87f4dea3ee524b2";
const PAY_TO = "00" + OUR_ACCT_HASH;
const AMOUNT = "1000000000"; // 1 WCSPR (decimals 9)
const MAX_TIMEOUT_SECONDS = 300;

const DOMAIN_VERSION = process.argv[2] ?? "1";
const DOMAIN_NAME = process.argv[3] ?? "Wrapped CSPR";

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing from .env`);
  return v;
}
function redact(s) {
  const str = s instanceof Error ? (s.stack ?? s.message) : String(s);
  return TOKEN ? str.split(TOKEN).join("<TOKEN>") : str;
}

async function main() {
  const signer = await createClientCasperSigner(PEM_PATH, casperSdk.KeyAlgorithm.ED25519);
  const scheme = new ExactCasperScheme(signer);

  const paymentRequirements = {
    scheme: "exact",
    network: NETWORK,
    asset: ASSET,
    amount: AMOUNT,
    payTo: PAY_TO,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { name: DOMAIN_NAME, version: DOMAIN_VERSION },
  };

  const result = await scheme.createPaymentPayload(X402_VERSION, paymentRequirements);
  const paymentPayload = {
    x402Version: result.x402Version,
    accepted: paymentRequirements,
    payload: result.payload,
  };

  console.log("── settle inputs ──");
  console.log("facilitator   :", FACILITATOR + "/settle");
  console.log("network       :", NETWORK);
  console.log("asset (WCSPR) :", ASSET);
  console.log("amount        :", AMOUNT, "motes (1 WCSPR)");
  console.log("payer (from)  :", paymentPayload.payload.authorization.from);
  console.log("payTo (to)    :", PAY_TO, "(self)");
  console.log("DOMAIN        :", JSON.stringify(DOMAIN_NAME), "version", JSON.stringify(DOMAIN_VERSION));
  console.log("nonce         :", paymentPayload.payload.authorization.nonce);

  const res = await fetch(`${FACILITATOR}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN },
    body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements }),
  });

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }

  console.log("\n── /settle response ──");
  console.log("HTTP status   :", res.status, res.statusText);
  console.log("body          :", JSON.stringify(body, null, 2));

  const success = body?.success === true;
  console.log("\n========================================");
  if (success) {
    const txHash = body.transaction ?? body.txHash ?? body.transactionHash;
    console.log("RESULT: SETTLED  (success: true)");
    console.log("settlement tx :", txHash);
    if (txHash) console.log("explorer      :", `https://testnet.cspr.live/deploy/${txHash}`);
  } else {
    console.log("RESULT: FAILED  (success:", body?.success, ")");
    console.log("errorReason   :", body?.errorReason ?? "(none)");
    console.log("errorMessage  :", body?.errorMessage ?? "(none)");
    console.log("domain tried  :", `name=${JSON.stringify(DOMAIN_NAME)} version=${JSON.stringify(DOMAIN_VERSION)}`);
  }
  console.log("========================================");
  process.exitCode = success ? 0 : 1;
}

main().catch((err) => {
  console.error("\nSETTLE ERROR:", redact(err));
  process.exitCode = 2;
});
