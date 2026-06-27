// ===========================================================================
// Quittance de-risk spike — prove a headless Casper client can sign an EIP-712
// `transfer_with_authorization` payload that the LIVE CSPR.cloud facilitator
// accepts via POST /verify.
//
//   OFF-CHAIN ONLY. This NEVER calls /settle, never submits a tx, never moves
//   funds. It signs an authorization and asks the facilitator to validate it.
//
// Usage:  node e2e/verify-spike.mjs [version] [name]
//   version  EIP-712 domain version  (default "1")
//   name     EIP-712 domain name     (default "Wrapped CSPR")
//
// Each run makes exactly ONE /verify call (quota-conscious: free testnet
// facilitator allows ~25 calls/month). Reads config from ../.env.
//
// SECURITY: the CSPR.cloud token is read into a variable and used ONLY as the
// Authorization header. It is NEVER printed/logged; errors are token-redacted.
// ===========================================================================
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));

// ---- packages live in packages/adapters/node_modules (pnpm, not hoisted). ----
// casper-js-sdk is CJS-only; the casper-x402 CJS build has a broken SDK interop,
// so we import its ESM build by absolute path (its internal bare imports resolve
// via pnpm's nested layout, exactly like the @quittance/adapters package).
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const x402EsmPath = require
  .resolve("@make-software/casper-x402")
  .replace("/dist/cjs/index.js", "/dist/esm/index.mjs");
const { createClientCasperSigner, ExactCasperScheme } = await import(x402EsmPath);

// --------------------------------- config ---------------------------------
const TOKEN = req("CSPR_CLOUD_TOKEN");
const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://x402-facilitator.cspr.cloud";
const PEM_PATH = resolve(__dirname, "..", req("CASPER_SECRET_KEY_PATH"));
const ASSET = req("WCSPR_PACKAGE_HASH"); // 64-hex CEP-18 package hash, no prefix
const NETWORK = process.env.CASPER_NETWORK ?? "casper:casper-test";

// x402 protocol version advertised by GET /supported (verified: 2).
const X402_VERSION = 2;
// payTo = the facilitator's testnet fee-payer account hash, "00"-prefixed to the
// 66-char account-hash address form the scheme requires. Recipient of the (never
// settled) authorization. Distinct from our own `from` account.
const FACILITATOR_TESTNET_FEEPAYER = "81d557c9dcaadea97c34d79bf7b6af07aa9d760e5dd1aabf78a45fb39e072c3a";
const PAY_TO = "00" + FACILITATOR_TESTNET_FEEPAYER;
const AMOUNT = "1000000000"; // 1 WCSPR = 1e9 motes (decimals = 9, confirmed on-chain)
const MAX_TIMEOUT_SECONDS = 300;

// EIP-712 domain name/version — the crux. name confirmed on-chain ("Wrapped
// CSPR"); version defaults to the casper-eip-712 convention "1". Overridable
// via argv to iterate without thrashing quota.
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

// ------------------------------- run spike --------------------------------
async function main() {
  const signer = await createClientCasperSigner(PEM_PATH, casperSdk.KeyAlgorithm.ED25519);
  const scheme = new ExactCasperScheme(signer);

  /** @type {import("@x402/core/types").PaymentRequirements} */
  const paymentRequirements = {
    scheme: "exact",
    network: NETWORK,
    asset: ASSET,
    amount: AMOUNT,
    payTo: PAY_TO,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { name: DOMAIN_NAME, version: DOMAIN_VERSION },
  };

  // Client signs the EIP-712 transfer_with_authorization over the domain built
  // from paymentRequirements.extra (name/version/network/asset).
  const result = await scheme.createPaymentPayload(X402_VERSION, paymentRequirements);

  // Assemble the wire PaymentPayload: the facilitator reads `accepted.scheme` /
  // `accepted.network` plus the signed `payload`.
  const paymentPayload = {
    x402Version: result.x402Version,
    accepted: paymentRequirements,
    payload: result.payload,
  };

  console.log("── spike inputs ──");
  console.log("facilitator   :", FACILITATOR + "/verify");
  console.log("network       :", NETWORK);
  console.log("x402Version   :", X402_VERSION);
  console.log("asset (WCSPR) :", ASSET);
  console.log("amount        :", AMOUNT, "motes (1 WCSPR)");
  console.log("payer (from)  :", paymentPayload.payload.authorization.from);
  console.log("payTo (to)    :", PAY_TO);
  console.log("DOMAIN name   :", JSON.stringify(DOMAIN_NAME));
  console.log("DOMAIN version:", JSON.stringify(DOMAIN_VERSION));
  console.log("publicKey     :", paymentPayload.payload.publicKey);
  console.log("signature len :", paymentPayload.payload.signature.length / 2, "bytes");

  const res = await fetch(`${FACILITATOR}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN },
    body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements }),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  console.log("\n── /verify response ──");
  console.log("HTTP status   :", res.status, res.statusText);
  console.log("body          :", JSON.stringify(body, null, 2));

  const isValid = body?.isValid === true;
  console.log("\n========================================");
  if (isValid) {
    console.log(`RESULT: PASS  (isValid: true)`);
    console.log(`domain used: name=${JSON.stringify(DOMAIN_NAME)} version=${JSON.stringify(DOMAIN_VERSION)}`);
  } else {
    console.log(`RESULT: FAIL  (isValid: ${body?.isValid})`);
    console.log(`invalidReason : ${body?.invalidReason ?? "(none)"}`);
    console.log(`invalidMessage: ${body?.invalidMessage ?? "(none)"}`);
    console.log(`domain tried  : name=${JSON.stringify(DOMAIN_NAME)} version=${JSON.stringify(DOMAIN_VERSION)}`);
  }
  console.log("========================================");
  process.exitCode = isValid ? 0 : 1;
}

main().catch((err) => {
  console.error("\nSPIKE ERROR:", redact(err));
  process.exitCode = 2;
});
