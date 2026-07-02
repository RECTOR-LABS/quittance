# Design — Dashboard Deployment Migration: Railway → Vercel

- **Date:** 2026-07-01
- **Status:** Approved (design) — pending implementation plan
- **Owner:** RECTOR
- **Scope:** `@quittance/dashboard` (Next.js app) only. Contracts, agent, verifiers, e2e are unaffected.

## Context & Motivation

The Quittance dashboard is currently deployed on **Railway** (paid $5/mo Hobby after the trial), auto-deploying from `main`, and serving the production domain `quittance.rectorspace.com`.

**Driver: cost.** Move to **Vercel's free Hobby tier** and fully decommission Railway so the recurring charge goes away.

**Hard constraint: the domain is under active judging.** The DoraHacks BUIDL (`dorahacks.io/buidl/46076`) is in the community-vote phase through **Jul 19**, and its links point at `quittance.rectorspace.com`. **Downtime on that domain is not acceptable.** The migration must be zero-downtime with an instant rollback path.

## Verified Current State (2026-07-01)

| Aspect | Detail |
|---|---|
| App | `@quittance/dashboard` — Next.js `15.5.19`, React `19`, in `dashboard/` of a pnpm workspace |
| Monorepo | Root `pnpm-workspace.yaml` + `pnpm-lock.yaml` (135 KB) · `packageManager: pnpm@10.33.2` · **no** Turborepo |
| Railway build | `railway.json`: NIXPACKS · build `pnpm --filter @quittance/dashboard build` · start `pnpm --filter @quittance/dashboard start` |
| Next config | `dashboard/next.config.mjs`: `output: 'standalone'` (self-host/Docker oriented — for Railway) |
| Env | Only `CASPER_NODE_URL` (public testnet RPC). Code has a hardcoded fallback → **no secrets to migrate** |
| Static assets | `dashboard/public/quittance-demo.mp4` (9.2 MB) + `demo-poster.png` (133 KB) → served at `/demo` |
| Domain / DNS | `quittance.rectorspace.com` — Cloudflare **DNS-only (grey-cloud)** CNAME → `k1j5014s.up.railway.app`. Confirmed via `dig` (raw CNAME returned) + response header `server: railway-hikari`, no `cf-ray`. **Not proxied.** |

> **Correction to prior handoff:** the record was documented as "Cloudflare proxied → Railway." It is actually **DNS-only**. This simplifies the cutover to a single CNAME target swap — no proxy/SSL-mode toggling, no double-proxy risk.

## Goals

1. Dashboard served entirely from Vercel Hobby (free) on the same domain.
2. Railway service deleted → recurring cost eliminated.
3. Zero downtime on `quittance.rectorspace.com` throughout.
4. Instant rollback available until the final decommission step.
5. Push-to-deploy retained (GitHub integration, deploy from `main`).

## Non-Goals / Out of Scope

- Moving the 9 MB demo video off `public/` (Blob / YouTube / Cloudflare Stream). Hobby's 100 GB/mo bandwidth covers thousands of views; revisit only if bandwidth becomes a concern.
- Migrating contracts, agent, verifiers, or e2e packages.
- Setting up staging/preview environments beyond the free per-PR preview URLs that GitHub integration provides automatically.
- Cloudflare Pages as the host (viable $0 alternative, noted for the record; Vercel chosen for Next-native DX).

## Target Architecture (A)

- **Host:** Vercel **Hobby**, under RECTOR's **personal** account (Team = Pro = $20/mo, which would defeat the cost goal). The `RECTOR-LABS`-org repo is accessed via Vercel's GitHub app from the personal account — supported.
- **Deploy:** GitHub integration → auto-deploy on push to `main`; free preview URLs per PR.
- **Project config:** Root Directory = `dashboard`; Framework = Next.js (auto-detected); pnpm via Corepack honoring the `packageManager` pin; monorepo detected via root `pnpm-lock.yaml`.
- **Static:** 9 MB video served from `public/` over Vercel's CDN.
- **Domain:** `quittance.rectorspace.com`, unchanged, with Vercel-managed Let's Encrypt TLS.
- **ToS note:** Hobby is non-commercial use; a no-revenue hackathon project qualifies.

## Migration Plan (zero-downtime, verified DNS flip)

**Alternatives considered:** (②) hard cutover — flip DNS and delete Railway at once; rejected: any Vercel hiccup darkens the domain during judging. (③) run Vercel on `*.vercel.app` and leave the domain on Railway until judging ends Jul 19; rejected: doesn't achieve the cost goal now and floats two URLs. This plan (①) verifies Vercel end-to-end — including on the real domain — **before** Railway is touched, so it kills the bill today at near-zero risk.

Steps continue the (A) architecture lettering above.

### B. Code changes (2 files)
- `dashboard/next.config.mjs` → **remove** `output: 'standalone'`. Exists only for Railway's self-host build; Vercel uses its own output tracing. Safe for the Railway fallback too — `next start` does not require standalone output.
- `railway.json` → **keep during cutover**; delete only after decommission (step G).
- Vercel env → add `CASPER_NODE_URL` (Production + Preview). Explicit even though the code falls back. No secrets.
- No `vercel.json` — Root Directory is a Vercel project setting, not file-expressible.

### C. Vercel project setup (GitHub integration) — RECTOR-driven, CIPHER-guided
Import `RECTOR-LABS/quittance` into the personal Vercel account → authorize Vercel's GitHub app on the org → set Root Directory `dashboard` → add `CASPER_NODE_URL` → deploy. Produces a `*.vercel.app` URL.

### D. 🔒 Verification gate #1 — on `*.vercel.app` (Railway still live)
- Home `200`; `/demo` `200` and video plays; live balances render (7 / 3 CSPR from the RPC); Vercel build logs clean.
- Railway untouched → any failure here has zero user impact; fix forward on Vercel.

### E. DNS cutover (single CNAME swap) — RECTOR-driven
- Add `quittance.rectorspace.com` in the Vercel project.
- In Cloudflare, change the `quittance` CNAME target `k1j5014s.up.railway.app` → the Vercel target Vercel displays (typically `cname.vercel-dns.com`). **Keep it DNS-only (grey-cloud).**
- Vercel auto-issues the TLS cert once it observes the record.

### F. 🔒 Verification gate #2 — on the real domain
- `quittance.rectorspace.com` served by Vercel — confirm via `x-vercel-id` response header + valid TLS cert; `/demo` video plays; balances render.

### G. Decommission Railway (only after gate #2 passes) — RECTOR-driven
- Delete the Railway `quittance` service → billing stops (the cost goal).
- Remove `railway.json` from the repo → commit.

### H. Rollback (available any time before G)
- Revert the Cloudflare CNAME to `k1j5014s.up.railway.app`. Railway is live and untouched → immediate recovery. This is why Railway is not touched until gate #2 is green.

### I. Division of labor
- **CIPHER:** code changes (next.config, railway.json removal), CLI steps where authed, verification commands, exact click-by-click for the manual steps.
- **RECTOR (irreversible / account-scoped buttons):** the Vercel import (personal account), the Cloudflare CNAME swap, the Railway service deletion. Nothing outward-facing happens without RECTOR's nod.

## Success Criteria

- [ ] `curl -sI https://quittance.rectorspace.com` shows an `x-vercel-id` header (served by Vercel), valid cert, `200`.
- [ ] `/demo` returns `200` and the video plays; `/` renders live 7 / 3 CSPR balances.
- [ ] Vercel auto-deploys a push to `main`.
- [ ] Railway `quittance` service deleted; no further billing.
- [ ] `railway.json` removed; `output: 'standalone'` removed; repo builds clean on Vercel.
- [ ] Zero observed downtime on the domain during the whole cutover.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Vercel build fails (monorepo/root-dir misconfig) | Caught at gate #1 on `*.vercel.app`; Railway still serving the domain. |
| TLS cert not yet issued after CNAME swap | Gate #2 waits for a valid cert before proceeding; rollback = revert CNAME. |
| Domain briefly misconfigured | DNS-only CNAME swap + low Cloudflare TTL → near-instant propagation and rollback. |
| Video bandwidth on Hobby | 100 GB/mo covers thousands of views; monitor, move to Blob/YouTube only if needed. |
| Accidental commit of unrelated working-tree noise (`.gitignore`, `next-env.d.ts`) | Stage files explicitly; never `git add -A`. |

## Open Questions

None blocking. Optional follow-ups deferred to Non-Goals (video hosting, staging env).
