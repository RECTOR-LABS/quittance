// Dump the FULL arg set + target of a known real WCSPR deposit transaction, so
// we can replicate the exact calling convention. Read-only. NEVER logs token.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;

const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const { RpcClient, HttpHandler } = casperSdk;
const rpc = new RpcClient(new HttpHandler(RPC_URL));
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

const DH = process.argv[2] ?? "3984baa905bb615865a743a4ad4ae1b3e8f30ee4cb80fd50d1ecd062e9d7342a";

const info = await rpc.getTransactionByTransactionHash(DH);
const raw = info?.rawJSON ?? info;
const v1 = raw?.transaction?.Version1 ?? raw?.Version1;
const payload = v1?.payload ?? {};
const fields = payload?.fields ?? {};

console.log("=== deposit tx", DH, "===");
console.log("initiator:", j(payload.initiator_addr));
console.log("pricing:", j(payload.pricing_mode));

// target + entry_point reveal whether this is a stored-contract call or a session
console.log("\n--- target ---");
console.log(j(fields?.target ?? "(none)"));
console.log("\n--- entry_point field ---");
console.log(j(fields?.entry_point ?? "(none)"));

// FULL named args: name + cl_type + parsed (the crux: the purse arg name)
console.log("\n--- args.Named (ALL) ---");
const named = fields?.args?.Named ?? [];
for (const [name, clv] of named) {
  console.log(`  • ${name}: cl_type=${j(clv?.cl_type)}  parsed=${j(clv?.parsed)?.slice(0, 120)}`);
}

// execution result: did it succeed?
console.log("\n--- execution ---");
const ei = raw?.execution_info ?? info?.executionInfo;
const er = ei?.execution_result ?? ei?.executionResult;
console.log("block:", ei?.block_height ?? ei?.blockHeight, "errorMessage:", j(er?.error_message ?? er?.errorMessage ?? null));
console.log("\n=== done ===");
