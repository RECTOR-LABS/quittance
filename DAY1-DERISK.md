# Quittance — Day-1 De-Risk Runbook

> **Purpose:** Before investing in the build, prove the riskiest assumptions in one focused day. The entire critical path depends on a **3-day-old npm package** (`@make-software/casper-x402`, published 2026-06-18) doing **Casper-flavored EIP-712 headless signing**, with the **25-calls/month free testnet facilitator quota** as the only thing between us and a wall. De-risk both first. Nothing in Phase 1+ starts until the **GO gate** below is green.

## The one-sentence risk

> If a headless agent cannot sign an EIP-712 `transfer_with_authorization` and land one settlement on `casper-test` — and if we cannot escape the 25/month quota — Quittance is not buildable as specced. Everything else is ordinary engineering.

## Timebox

~1 focused day (~6–8h). Hard stop at end of day → hit the **GO / NO-GO gate**.

## Ordered checklist (each with a fallback)

| # | Action | Success signal | If it fails |
|---|---|---|---|
| 1 | Claim the buildathon **sponsored x402 facilitator**; put URL + key in `.env`. | Facilitator reachable; quota > 25/mo. | Email organizers immediately; meanwhile use the repo's **local NCTL net** (Docker quickstart auto-deploys a CEP-18) for *all* dev so you never spend testnet quota until the final demo tx. |
| 2 | CSPR.build account → CSPR.cloud token; fund testnet wallet via `testnet.cspr.live/tools/faucet`. | `GET /accounts/<pubkey>` returns non-zero balance. | Faucet is once-per-account — make a second account, or email `casper-testnet@make.services` for top-up. Budget ~400 CSPR headroom for installs. |
| 3 | Pin toolchain: `rustup toolchain install nightly-2026-01-01`; install `wasm-strip` (wabt) + `wasm-opt` (binaryen); `cargo install cargo-odra`. Build the **Flipper** sample. | `cargo odra test` + `cargo odra build -b casper` succeed. | If `cargo-odra` 0.1.x ↔ `odra` 2.8 skew breaks the build, pin `odra` to the cargo-odra-compatible version; last resort, hand-roll the contract install via `casper-js-sdk` v5. |
| 4 | Run the `casper-x402` **3-terminal quickstart** (facilitator/resource/client) end-to-end. | Client pays the resource server; a settlement appears. | Read `casper-x402` source directly; the repo is ~6 weeks old with empty issues — expect to debug from code, not docs. |
| 5 | **THE KEY SPIKE:** headless client signs an EIP-712 `transfer_with_authorization`; `/settle` lands **one real tx on `casper-test`**. | Tx visible on `testnet.cspr.live`. **This is also the qualifying on-chain component.** | If Casper-flavored EIP-712 headless signing is blocked, fall back to a generic CEP-18 transfer via `casper-js-sdk` v5 as the agent payment (less x402-pure — flag it in the README) and raise with RECTOR. |
| 6 | Confirm the unit-of-work is **TransactionV1** on `casper-js-sdk` **v5** (not legacy Deploy, not v2 API). | A v5 `TransactionV1` confirms via `waitForFinality`. | Use the official v2→v5 migration guide; discard any v2-era snippet (most AI/tutorial output is v2). |

## Findings (capture verbatim — these feed PLAN tasks 0.4 / 0.5 / 1.5)

- **Faucet amount received:** _____  · **Account hash:** _____
- **casper-x402 client API:** constructor sig, `pay`/`fetch` method names + params: _____
- **`PaymentRequirements` shape:** _____
- **EIP-712 `ExactCasperPayload` fields:** _____
- **Payout CEP-18 token address (testnet):** _____
- **`PAYMENT-SIGNATURE` header format:** _____
- **First qualifying tx hash:** _____
- **Per-install gas cost (measured):** _____  · **Block/finality time observed:** _____
- **Sponsored facilitator quota granted:** _____

## Research capture — 2026-06-23 (Chrome + source read; API captured WITHOUT a live run)

> Captured by reading the live CSPR.cloud docs + the `make-software/casper-x402` source. **Not yet validated by an on-chain run** — that needs RECTOR's creds (or a local NCTL Docker quickstart). Treat method-level details as "read, not run."

**Facilitator — RESOLVED (no perk needed to start).** The Casper x402 facilitator is **hosted by CSPR.cloud** at **`https://x402-facilitator.cspr.cloud`** (one URL, mainnet + testnet). Endpoints: `GET /supported`, `POST /verify`, `POST /settle` (body `{ paymentPayload, paymentRequirements }`). **All require auth via a CSPR.cloud access token = the same `CSPR_CLOUD_TOKEN`** (get at console.cspr.build). The buildathon "sponsored" usage / $100k x402 credits layer on top (Discord/Telegram). We therefore **do NOT run our own facilitator** — CSPR.cloud signs+settles+pays gas. → `.env.example` updated.

**Headers (authoritative):** request → `PAYMENT-SIGNATURE`; 402 → `PAYMENT-REQUIRED` (base64 requirements); paid 200 → `PAYMENT-RESPONSE` (base64 settlement). The `casper.network/ai` marketing `X-Payment` is WRONG.

**We build TWO sides only (client + server); the hosted facilitator is the third:**
- **Client (agent pays):** `@x402/fetch` → `const client = new x402Client(selector).register("casper:*", new ExactCasperScheme(await createClientCasperSigner(pemPath, KeyAlgorithm.ED25519|SECP256K1)))`; `const paidFetch = wrapFetchWithPayment(fetch, client)`; `await paidFetch(url, {method:"GET"})` auto-handles 402→sign→retry; settlement via `new x402HTTPClient(client).getPaymentSettleResponse(n => res.headers.get(n))`. Imports: `@x402/fetch`, `@make-software/casper-x402` (`createClientCasperSigner`), `@make-software/casper-x402/exact/client` (`ExactCasperScheme`).
- **Server (verifiers, x402-gated):** Express + `@make-software/casper-x402/exact/server` `ExactCasperScheme` + `@x402/core/server` `HTTPFacilitatorClient` pointed at `https://x402-facilitator.cspr.cloud`. Declares `PaymentRequirements` (network `casper:casper-test`, `asset`=WCSPR package, amount, payTo, **token name/version in `extra`** — must match the CEP-18's EIP-712 domain or settlement fails `invalid_signature`).
- **Signer API** (`ClientCasperSigner`): `accountAddress()` → `"00"+accountHashHex`; `publicKey()` → algo-prefixed hex; `signEIP712(digest)` → 65 bytes `[1 algo | 64 sig]`. From `casper-js-sdk` v5 `PrivateKey.fromPem(pem, algo)`.

**ChainClient — casper-js-sdk v5 contract-call pattern (from the facilitator scheme):**
`const rpc = new RpcClient(new HttpHandler(rpcUrl))`; build a `TransactionV1` with `.entryPoint("<name>").runtimeArgs(casperSdk.Args.fromMap({ arg: casperSdk.CLValue.newCL* }))`; `tx.sign(privateKey)`; `const hash = (await rpc.putTransaction(tx)).transactionHash.toHex()`; poll `rpc.getTransactionByTransactionHash(hash).executionInfo` until `blockHeight !== 0 && executionResult` (surface `executionResult.errorMessage`). CLValue v5 API: `CLValue.newCLKey / newCLUInt256 / newCLUint64 / newCLList / newCLUint8 / newCLPublicKey` (+ `CLTypeUInt8` for list elem); `Key.newKey("account-hash-"+hex)`; `Args.fromMap({...})`. **Builder (captured 2026-06-23):** `new ContractCallBuilder().from(pubKey).byPackageHash(pkgHex).entryPoint(name).runtimeArgs(args).chainName(chainNameFromNetwork(...)).payment(motes).build()` → `signer.signTransaction(tx)` → `rpc.putTransaction(tx)` → poll `rpc.getTransactionByTransactionHash(hash).executionInfo`. **queryDictItem:** `RpcClient.getDictionaryItem` / `getDictionaryItemByIdentifier` (+ `ParamDictionaryIdentifierContractNamedKey`). **wasm install:** `SessionBuilder` (Task 1.5, creds-gated). Full ChainClient API is now in hand.

**EIP-712 `transfer_with_authorization` (CEP-18 entrypoint args):** `from`(Key), `to`(Key), `amount`(U256), `valid_after`(u64), `valid_before`(u64), `nonce`(List<u8>), `public_key`(PublicKey), `signature`(List<u8>). `ExactCasperPayload = { authorization: { value, validAfter, validBefore, nonce, from, to }, signature, publicKey }`. Domain via `buildDomain(tokenName, version, network, "0x"+asset)` + `CASPER_DOMAIN_TYPES`.

**Testnet WCSPR (payment token):** CEP-18 package hash `3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e`, RPC `https://node.testnet.casper.network/rpc` (public). Examples in repo: `js/examples/{facilitator:4022, server:4021, client}`.

**⚠️ ARCHITECTURE FINDING (decision needed):** `wrapFetchWithPayment` couples *payment* to the *HTTP fetch* — a single paid GET returns the verifier's verdict (body) AND the settlement (header) together. So the clean real adapter is the agent's **`VerifierClient`** (pay+verdict in one), NOT the PLAN's standalone `CasperX402PaymentClient` (core `PaymentClient`), which would pay and throw away the verdict. **Recommend reframing Task 0.4: implement the real `VerifierClient` against `wrapFetchWithPayment`; demote `PaymentClient` to an internal detail or drop it.** Confirm before building.

## GO / NO-GO gate (end of Day 1)

- ✅ **GO** if step 5 is green (one tx landed) **and** step 1 or its fallback gives us enough quota for development → proceed to Phase 1 (ServicerVault).
- 🟡 **CONDITIONAL** if step 5 used the CEP-18-transfer fallback (not pure x402) → proceed, but flag the deviation; revisit pure x402 during the Jul 6–19 Final Round.
- 🛑 **NO-GO** if step 5 cannot land any agent-driven tx after the timebox → stop, escalate to RECTOR with the exact blocker. Do **not** sink Days 2–9 into a build whose foundation is unproven. The qualifier bar (one on-chain tx) is itself unmet, so this is existential, not cosmetic.

## Why this ordering

Steps 1–2 unblock everything (infra + funds). Step 3 de-risks the contract toolchain in parallel. Steps 4–5 attack the single highest risk early, while there's still time to fall back or pivot. We spend the *least* effort to retire the *most* risk — and step 5 doubles as the qualifying transaction, so a green Day 1 means we're already eligible.
