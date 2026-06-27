// Confirm a transaction's on-chain finality + execution result. Read-only.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const { RpcClient, HttpHandler } = casperSdk;
const rpc = new RpcClient(new HttpHandler(process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc"));

const HASH = process.argv[2];
if (!HASH) throw new Error("usage: node e2e/confirm-tx.mjs <hash>");

const deadline = Date.now() + 120_000;
for (;;) {
  let info;
  try { info = await rpc.getTransactionByTransactionHash(HASH); } catch (e) { info = null; }
  const ei = info?.executionInfo;
  if (ei && ei.blockHeight !== 0 && ei.executionResult) {
    const err = ei.executionResult.errorMessage;
    console.log("hash   :", HASH);
    console.log("block  :", ei.blockHeight);
    console.log("result :", err ? `FAILURE: ${err}` : "SUCCESS");
    console.log("cost   :", String(ei.executionResult.cost ?? ""));
    process.exitCode = err ? 1 : 0;
    break;
  }
  if (Date.now() > deadline) { console.log("timeout waiting for finality of", HASH); process.exitCode = 2; break; }
  await new Promise((r) => setTimeout(r, 4000));
}
