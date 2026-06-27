// Inspect the deployed ServicerVault entity's named keys (dict names) + confirm
// the pool funding. Read-only.  node e2e/inspect-vault-keys.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, "../packages/adapters/package.json"));
const casperSdk = (await import(require.resolve("casper-js-sdk"))).default;
const { RpcClient, HttpHandler, EntityIdentifier } = casperSdk;
const rpc = new RpcClient(new HttpHandler("https://node.testnet.casper.network/rpc"));
const ENT = "6a6747d294af421c11f62b400167580600329c48bfc9cce3c2a76db42b27e132";

console.log("EntityIdentifier static methods:", Object.getOwnPropertyNames(EntityIdentifier).filter((m) => !["length", "name", "prototype"].includes(m)));

let r;
for (const mk of ["fromEntityAddr", "fromFormattedString", "newEntityAddr"]) {
  if (typeof EntityIdentifier[mk] !== "function") continue;
  for (const arg of [`entity-contract-${ENT}`, `addressable-entity-${ENT}`, ENT]) {
    try {
      r = await rpc.getLatestEntity(EntityIdentifier[mk](arg));
      console.log(`got entity via ${mk}("${arg.slice(0, 24)}…")`);
      break;
    } catch (e) { /* try next */ }
  }
  if (r) break;
}

if (!r) { console.log("could not fetch contract entity"); process.exit(1); }

console.log("top keys:", Object.keys(r));
const ent = r.entity ?? {};
console.log("entity keys:", Object.keys(ent));
// named keys may be parsed or only in merkleProof
const nk = ent.namedKeys?.keys ?? ent.namedKeys ?? r.namedKeys;
if (Array.isArray(nk)) {
  console.log("PARSED named keys:", nk.map((k) => k.name ?? k.Name).join(", "));
} else {
  console.log("(named keys not parsed; extracting from merkleProof)");
}
const mp = r.merkleProof || "";
const names = [...new Set((Buffer.from(mp, "hex").toString("latin1").match(/[a-zA-Z_][a-zA-Z0-9_]{3,40}/g) || []))];
console.log("strings in merkleProof:", names.join(", "));
