// Local dry-run: validate the signed payload against the REFERENCE facilitator
// verify() shipped in @make-software/casper-x402 — NO network, NO facilitator
// quota. If this passes, the live /verify should too (modulo hosted-specific
// checks). Off-chain only; never settles.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;

const esm = (sub) =>
  require
    .resolve(`@make-software/casper-x402${sub}`)
    .replace(/\/dist\/cjs\/(.*)\.js$/, "/dist/esm/$1.mjs");

const { createClientCasperSigner, ExactCasperScheme: ClientScheme } = await import(esm(""));
const { ExactCasperScheme: FacilitatorScheme } = await import(esm("/exact/facilitator"));

const PEM_PATH = resolve(__dirname, "..", process.env.CASPER_SECRET_KEY_PATH);
const ASSET = process.env.WCSPR_PACKAGE_HASH;
const NETWORK = process.env.CASPER_NETWORK ?? "casper:casper-test";
const VERSION = process.argv[2] ?? "1";
const NAME = process.argv[3] ?? "Wrapped CSPR";

const signer = await createClientCasperSigner(PEM_PATH, casperSdk.KeyAlgorithm.ED25519);
const client = new ClientScheme(signer);

const paymentRequirements = {
  scheme: "exact",
  network: NETWORK,
  asset: ASSET,
  amount: "1000000000",
  payTo: "00" + "81d557c9dcaadea97c34d79bf7b6af07aa9d760e5dd1aabf78a45fb39e072c3a",
  maxTimeoutSeconds: 300,
  extra: { name: NAME, version: VERSION },
};

const result = await client.createPaymentPayload(2, paymentRequirements);
const paymentPayload = { x402Version: result.x402Version, accepted: paymentRequirements, payload: result.payload };

// Reference facilitator verify() only touches signer.getNetworkConfig(network);
// a minimal stub satisfies it without creds/RPC.
const stubSigner = {
  async getNetworkConfig(network) {
    if (network !== NETWORK) throw new Error(`unsupported network ${network}`);
    return { chainName: "casper-test", rpcUrl: "https://node.testnet.casper.network/rpc" };
  },
};
const facilitator = new FacilitatorScheme(stubSigner, {});

const verdict = await facilitator.verify(paymentPayload, paymentRequirements, undefined);
console.log("LOCAL reference verify():", JSON.stringify(verdict, null, 2));
console.log(verdict.isValid ? "LOCAL PASS" : `LOCAL FAIL: ${verdict.invalidReason} ${verdict.invalidMessage ?? ""}`);
process.exitCode = verdict.isValid ? 0 : 1;
