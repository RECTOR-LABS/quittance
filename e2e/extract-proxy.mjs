// Extract the Odra "Call" proxy wasm + the exact inner-args byte layout from a
// known-good WCSPR deposit tx, so we can replicate the deposit for our account
// and validate our serialization byte-for-byte. Read-only. NEVER logs token.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(__dirname, "../.env"));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;

const RPC_URL = process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";
const { RpcClient, HttpHandler } = casperSdk;
const rpc = new RpcClient(new HttpHandler(RPC_URL));
const DH = process.argv[2] ?? "3984baa905bb615865a743a4ad4ae1b3e8f30ee4cb80fd50d1ecd062e9d7342a";

const info = await rpc.getTransactionByTransactionHash(DH);
const raw = info?.rawJSON ?? info;
const v1 = raw?.transaction?.Version1;
const fields = v1?.payload?.fields ?? {};

// 1. proxy wasm module_bytes -> binary file
const moduleHex = fields?.target?.Session?.module_bytes;
if (!moduleHex) throw new Error("no module_bytes in tx");
const wasm = Buffer.from(moduleHex, "hex");
const outPath = resolve(__dirname, "proxy_caller.wasm");
writeFileSync(outPath, wasm);
console.log("proxy wasm bytes:", wasm.length, "-> wrote", outPath);
console.log("is_install_upgrade:", fields?.target?.Session?.is_install_upgrade);
console.log("entry_point:", JSON.stringify(fields?.entry_point));

// 2. the named args of the proxy call: name -> {cl_type, bytes}
console.log("\n--- proxy runtime args (name: cl_type | bytes) ---");
const named = fields?.args?.Named ?? [];
const real = {};
for (const [name, clv] of named) {
  real[name] = clv;
  const b = clv?.bytes ?? "";
  console.log(`  ${name}: ${JSON.stringify(clv?.cl_type)} | bytes(${b.length / 2})=${b.slice(0, 120)}${b.length > 120 ? "…" : ""}`);
}

// 3. decode the inner `args` List<U8> -> these are the serialized RuntimeArgs
//    forwarded to deposit. Print as hex so we can match our own serialization.
const innerHex = real["args"]?.bytes;
console.log("\n--- inner forwarded args (the deposit call's RuntimeArgs), hex ---");
console.log(innerHex);
console.log("\n(parsed preview):", JSON.stringify(real["args"]?.parsed?.slice?.(0, 40)));
console.log("\namount    =", real["amount"]?.parsed);
console.log("attached_value =", real["attached_value"]?.parsed);
console.log("package_hash   =", real["package_hash"]?.parsed);
console.log("\n=== done ===");
