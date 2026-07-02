# Railway → Vercel Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `@quittance/dashboard` deployment from Railway (paid) to Vercel's free Hobby tier with zero downtime on `quittance.rectorspace.com`, then decommission Railway to eliminate the recurring cost.

**Architecture:** This is an infrastructure runbook, not a code feature — the only code changes are removing two Railway-specific config artifacts at the very end. The core is a *verified DNS flip*: stand Vercel up in parallel, prove it end-to-end (including on the real domain), and only then delete Railway. Railway is the live fallback until the final decommission, so rollback is a single CNAME revert at any point.

**Tech Stack:** Next.js 15.5.19 · pnpm workspace (`pnpm@10.33.2`) · Vercel Hobby (personal account, GitHub integration) · Cloudflare DNS (grey-cloud) · Casper testnet RPC.

## Global Constraints

- **Next.js floor:** must remain `>= 15.5.19` (CVE fix — never downgrade). Current: `15.5.19`.
- **Vercel account:** RECTOR's **personal** account on **Hobby** ($0). NOT a Vercel Team (Team ⇒ Pro ⇒ $20/mo, defeats the cost goal).
- **Env var:** `CASPER_NODE_URL = https://node.testnet.casper.network/rpc` (Production + Preview). No secrets involved.
- **Zero downtime:** do NOT touch or delete Railway until Verification Gate #2 (real domain served by Vercel) is green.
- **Cloudflare:** keep the `quittance` record **DNS-only (grey-cloud)** — do not enable the proxy.
- **Rollback:** revert the Cloudflare `quittance` CNAME target to `k1j5014s.up.railway.app`. Railway stays live and untouched until Task 5.
- **Commits:** GPG-sign (`-S`, key `BF47B9DC1FA320FA`), NO AI attribution (write as a human dev), **stage files explicitly** (never `git add -A` — the working tree carries unrelated `.gitignore` + `dashboard/next-env.d.ts` noise that must NOT be committed).
- **Approval gates:** the Vercel import, the Cloudflare CNAME swap, the Railway deletion, and any push/merge to `main` require RECTOR's explicit go. RECTOR clicks the irreversible buttons; CIPHER prepares and verifies.
- **Branch:** all work on `chore/vercel-migration` (already holds the spec at `e657b45`). It reaches `main` exactly once, via a single PR at Task 6 — after everything is verified.

## File Structure

Only two files change, and only in Task 6 (final cleanup, after Railway is gone):
- **Modify:** `dashboard/next.config.mjs` — drop `output: 'standalone'` (a Railway self-host artifact; a no-op on Vercel).
- **Delete:** `railway.json` — Railway build/deploy config.
- **Modify:** `README.md:101`, `README.md:115` — "Railway" → "Vercel".

No changes to app code, `lib/`, tests, or the pnpm workspace. The dashboard has **no internal workspace dependencies** (deps are `next`, `react`, `react-dom`, `lucide-react` — all external), so the Vercel build is self-contained.

---

### Task 1: Create & configure the Vercel project (GitHub integration)

**Owner:** RECTOR (account-scoped) — CIPHER supplies exact settings.
**Files:** none (Vercel dashboard configuration).
**Deliverable:** a successful Vercel build reachable at a `*.vercel.app` URL, Railway untouched.

- [ ] **Step 1: Import the repo (RECTOR).** Vercel dashboard → **Add New… → Project** → **Import Git Repository** → if prompted, install/authorize the **Vercel GitHub app on the `RECTOR-LABS` org** → select **`RECTOR-LABS/quittance`**. Ensure the importing scope is your **personal** account, not a Team.

- [ ] **Step 2: Configure build settings (RECTOR, before first deploy).**
  - **Root Directory:** `dashboard` (click *Edit* → select the `dashboard` folder). This is the critical monorepo setting.
  - **Framework Preset:** Next.js (auto-detected — leave as-is).
  - **Build & Install Commands:** leave **default/Override OFF**. Vercel detects the root `pnpm-lock.yaml` + `packageManager: pnpm@10.33.2` and installs via pnpm/Corepack.
  - **Node.js Version:** leave default (20.x/22.x — satisfies `engines.node >= 20`).

- [ ] **Step 3: Add the environment variable (RECTOR).** Project → **Settings → Environment Variables** (or during import): add
  `CASPER_NODE_URL` = `https://node.testnet.casper.network/rpc` for **Production** and **Preview**.

- [ ] **Step 4: Deploy.** Click **Deploy**. Wait for the build to finish.

- [ ] **Step 5: Confirm the build succeeded and capture the URL.** Build logs end with success; note the deployment URL (e.g. `https://quittance-xxxx.vercel.app`). **Paste this URL to CIPHER** — the next task's commands need it.
  - **If the build FAILS** on install (workspace/lockfile): confirm Root Directory = `dashboard`; Vercel's monorepo detection includes the repo root automatically. As a fallback, set **Install Command** to `pnpm install --frozen-lockfile` and redeploy. Railway is still serving the domain — no user impact.

---

### Task 2: 🔒 Verification Gate #1 — validate on the `*.vercel.app` URL

**Owner:** CIPHER (read-only checks). **Railway still live and serving the domain.**
**Deliverable:** documented proof the Vercel deployment is fully functional before any DNS change.
**Precondition:** `VERCEL_URL` from Task 1, Step 5.

- [ ] **Step 1: Home route + Vercel origin.**
  Run: `curl -sI "$VERCEL_URL/" | grep -iE "HTTP/|x-vercel-id"`
  Expected: `HTTP/2 200` **and** an `x-vercel-id:` header (proves Vercel is serving).

- [ ] **Step 2: Demo route.**
  Run: `curl -s -o /dev/null -w "%{http_code}\n" "$VERCEL_URL/demo"`
  Expected: `200`.

- [ ] **Step 3: Demo video asset (the 9 MB file from `public/`).**
  Run: `curl -s -o /dev/null -w "%{http_code} %{size_download}\n" "$VERCEL_URL/quittance-demo.mp4"`
  Expected: `200` and size ≈ `9200000` bytes (~9.2 MB).

- [ ] **Step 4: Live balances render (SSR proof).**
  Run: `curl -s "$VERCEL_URL/" | grep -c "CSPR"; curl -s "$VERCEL_URL/holder" | grep -c "CSPR"`
  Expected: both counts `> 0` (issuer ≈ 7 CSPR on `/`, holder ≈ 3 CSPR on `/holder` — the server-side RPC fetch resolved). If a count is `0`, open the URL in a browser to inspect; do NOT proceed to Task 3 until balances render.

- [ ] **Step 5: Gate decision.** All four steps green → proceed. Any failure → fix on Vercel (Railway unaffected) and re-run this gate. **Do not touch DNS until this gate passes.**

---

### Task 3: Point the domain at Vercel (Cloudflare CNAME swap)

**Owner:** RECTOR (DNS + Vercel domain) — CIPHER supplies exact values.
**Deliverable:** `quittance.rectorspace.com` resolves to Vercel with a valid TLS cert. **Railway still live** (rollback available).

- [ ] **Step 1: Add the domain in Vercel (RECTOR).** Project → **Settings → Domains** → add `quittance.rectorspace.com`. Vercel shows the required DNS record — **note the exact target** (for a subdomain, typically `CNAME → cname.vercel-dns.com`; Vercel may show an alternative — use whatever it displays).

- [ ] **Step 2: Swap the Cloudflare record (RECTOR).** Cloudflare dashboard → zone **`rectorspace.com`** → **DNS → Records** → edit the `quittance` **CNAME**:
  - Change **Target** from `k1j5014s.up.railway.app` → the Vercel target from Step 1.
  - **Proxy status:** keep **DNS only (grey cloud)**. Do NOT enable the orange-cloud proxy.
  - Save.

- [ ] **Step 3: Wait for Vercel to validate + issue TLS.** In Vercel → Domains, the status moves to **Valid Configuration** and a certificate is issued (seconds–few minutes). Cloudflare's low TTL makes propagation near-instant.

---

### Task 4: 🔒 Verification Gate #2 — validate on `quittance.rectorspace.com`

**Owner:** CIPHER (read-only checks). **Railway still live** — this gate decides whether it's safe to decommission.
**Deliverable:** documented proof the real domain is served by Vercel end-to-end.

- [ ] **Step 1: Domain served by Vercel, not Railway.**
  Run: `curl -sI https://quittance.rectorspace.com | grep -iE "HTTP/|x-vercel-id|server:"`
  Expected: `HTTP/2 200`, an `x-vercel-id:` header present, and **no** `server: railway-hikari`.

- [ ] **Step 2: DNS resolves to the Vercel target.**
  Run: `dig +short quittance.rectorspace.com`
  Expected: the Vercel CNAME/target (e.g. `cname.vercel-dns.com.` and/or a `76.76.21.x` address) — **not** `k1j5014s.up.railway.app`.

- [ ] **Step 3: Demo + video + balances on the real domain.**
  Run: `curl -s -o /dev/null -w "%{http_code}\n" https://quittance.rectorspace.com/demo; curl -s https://quittance.rectorspace.com/ | grep -c "CSPR"`
  Expected: `200` and a `CSPR` count `> 0`.

- [ ] **Step 4: TLS validity.**
  Run: `curl -sS -o /dev/null https://quittance.rectorspace.com && echo "TLS OK"`
  Expected: `TLS OK` with no cert error.

- [ ] **Step 5: Gate decision.** All green → safe to decommission Railway (Task 5). Any failure → **ROLLBACK**: revert the Cloudflare CNAME target to `k1j5014s.up.railway.app` (grey-cloud); the domain is instantly back on Railway. Then debug Vercel and retry from Task 3.

---

### Task 5: Decommission Railway

**Owner:** RECTOR (irreversible) — CIPHER verifies after.
**Deliverable:** Railway service deleted, recurring cost eliminated, domain still up on Vercel.
**Precondition:** Task 4 fully green and stable (recommend re-running Gate #2 once more, a few minutes apart, to confirm no flapping).

- [ ] **Step 1: Final pre-delete check (CIPHER).** Re-run Task 4, Step 1. Confirm `x-vercel-id` present and no `server: railway-hikari`. Nothing points at Railway anymore.

- [ ] **Step 2: Delete the Railway service (RECTOR).** Railway dashboard → project (`quittance`, id `2f00fade…`) → **`quittance` service → Settings → Delete Service** (or delete the whole project if it only holds this service). This stops billing.

- [ ] **Step 3: Confirm the domain is unaffected (CIPHER).**
  Run: `curl -sI https://quittance.rectorspace.com | grep -iE "HTTP/|x-vercel-id"`
  Expected: still `200` + `x-vercel-id` (Vercel unaffected by Railway deletion).

---

### Task 6: Remove Railway-specific config + merge to `main`

**Owner:** CIPHER (edits) + RECTOR (PR merge).
**Files:** Modify `dashboard/next.config.mjs`; Delete `railway.json`; Modify `README.md` (lines 101, 115).
**Deliverable:** repo free of Railway config; final state merged to `main`; Vercel redeploys clean.

- [ ] **Step 1: Drop `output: 'standalone'`.** Edit `dashboard/next.config.mjs` to:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 2: Remove the Railway config.**
  Run: `git rm railway.json`

- [ ] **Step 3: Update the README (2 lines).**
  - `README.md:101`: change the table cell `Next.js 15, Railway` → `Next.js 15, Vercel`.
  - `README.md:115`: change `# Next.js dashboard (issuer + holder views), deployed on Railway` → `# Next.js dashboard (issuer + holder views), deployed on Vercel`.

- [ ] **Step 4: Verify the build still passes locally.**
  Run: `pnpm --filter @quittance/dashboard build`
  Expected: build completes successfully (no standalone output, no errors).

- [ ] **Step 5: Commit (staged files only, GPG-signed).**

```bash
git add dashboard/next.config.mjs railway.json README.md
git commit -S -m "chore(deploy): migrate dashboard to Vercel, drop Railway config"
```
  (Do NOT `git add -A` — leave `.gitignore` and `dashboard/next-env.d.ts` unstaged. The spec + this plan were already committed earlier on this branch.)

- [ ] **Step 6: Push + open PR (RECTOR nod).**
  Run: `git push -u origin chore/vercel-migration` then open a PR `chore/vercel-migration → main`.

- [ ] **Step 7: Merge (RECTOR).** Merge with `--merge --delete-branch` (per convention), deleting the branch local + remote. This lands the spec, this plan, and the cleanup on `main`.

- [ ] **Step 8: Confirm the post-merge Vercel deploy (CIPHER).** Vercel auto-deploys the new `main` (a no-op cleanup — Vercel already ignored `output: 'standalone'`). After it completes:
  Run: `curl -sI https://quittance.rectorspace.com | grep -iE "HTTP/|x-vercel-id"`
  Expected: `200` + `x-vercel-id`.

---

### Task 7: Finalize docs & memory

**Owner:** CIPHER.
**Deliverable:** spec marked done, project memory updated.

- [ ] **Step 1: Mark the spec status Done.** Edit `docs/superpowers/specs/2026-07-01-railway-to-vercel-migration-design.md` header `Status:` → `Done — migrated <date>`. (Fold into a small follow-up commit or the Task 6 commit if not yet merged.)

- [ ] **Step 2: Update project memory.** Record in the Claude memory dir that the dashboard is now on Vercel Hobby (not Railway): custom domain via Cloudflare grey-cloud CNAME → Vercel; Railway decommissioned; supersede the Railway gotchas in `MEMORY.md` / the quittance memory files.

- [ ] **Step 3: Update the session handoff / ledger** (`.superpowers/sdd/progress.md` if used) with the migration outcome and the new hosting facts.

---

## Self-Review

**Spec coverage** (each spec section → task):
- Target Architecture (A) → Task 1 (Vercel project, root dir, env, Hobby/personal).
- Code changes (B) → Task 6 (standalone removal, railway.json delete). *(Deferred to the end vs the spec's "step B first": safe because `output: 'standalone'` is a no-op on Vercel — verified reasoning in the spec — so one clean cleanup PR beats a mid-migration merge. Contingency: if Gate #1 shows a standalone-related build issue, pull the removal forward into Task 1.)*
- Vercel setup (C) → Task 1. Gate #1 (D) → Task 2. DNS cutover (E) → Task 3. Gate #2 (F) → Task 4. Decommission (G) → Task 5. Rollback (H) → Global Constraints + Task 4 Step 5. Division of labor (I) → per-task **Owner** tags.
- Success criteria → Tasks 4, 5, 6 verification steps. Risks → gates + rollback baked into task ordering.

**Placeholder scan:** No TBD/TODO. `VERCEL_URL` and the Vercel DNS target are runtime-discovered values (Task 1 Step 5, Task 3 Step 1), explicitly captured — not placeholders. README line numbers and the exact before/after strings are given.

**Type/consistency:** No code interfaces to drift. The env var name (`CASPER_NODE_URL`), the RPC value, the Railway CNAME (`k1j5014s.up.railway.app`), and the branch name are identical everywhere they appear.

**Deviation from spec ordering** is documented above (code cleanup batched to the end) with its justification and contingency — the only intentional divergence.

---

## Execution Notes (2026-07-02)

Executed inline. Actual course vs. the plan as written:

- **Deploy method: Vercel CLI, then Git integration** (not the dashboard import). Project `quittance` created under the `rectors-projects` **Hobby** team (both the personal account and that team are `hobby`/free). After cutover, connected to `RECTOR-LABS/quittance` via `vercel git connect` — production branch `main`, `rootDirectory=dashboard`, `framework=nextjs` — for push-to-deploy. Git builds run from the repo root with pnpm + the frozen lockfile.
- **Two fixes were REQUIRED, not optional** (the plan hedged `output: 'standalone'` removal as low-stakes cleanup — it is load-bearing):
  1. Removed `output: 'standalone'` — on Vercel it diverts Next's output so **every app route 404s** (static `public/` assets still serve). Caught at Gate #1.
  2. Set project **`framework=nextjs`** — a bare `vercel project add` leaves the framework unset, so Vercel served the build as a static site (routes 404). Set via the projects API.
- **Railway self-terminated** (service status **Failed**) mid-window — the domain was already returning `404 Application not found`, so "zero-downtime" became a **restore**. Rollback-to-Railway was void; the live Vercel CLI deployment was the safety net during the git-connect step.
- **DNS cutover:** Cloudflare grey-cloud CNAME → `dbd257d35fdce21a.vercel-dns-017.com` (Vercel per-account target). Propagated + Let's Encrypt TLS issued in ~20s.
- **Final step:** delete the Railway `quittance` project (id `1da66400-…`), already Failed/dead.
