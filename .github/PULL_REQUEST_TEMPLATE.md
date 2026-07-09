<!-- Thanks for contributing to Quittance! Fill in the sections below. -->

## Summary

<!-- What does this PR do, and why? One or two sentences. -->

## Change type

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `chore` — tooling, deps, CI, config
- [ ] `docs` — documentation only
- [ ] `refactor` — no behavior change
- [ ] `test` — tests only

## Checklist

- [ ] Branch follows convention (`feat/` `fix/` `chore/` `docs/` `refactor/`) and targets `main`.
- [ ] **Tests added** for any new behavior, and the existing suite still passes:
  ```bash
  pnpm --recursive build && pnpm --recursive test
  ```
- [ ] Commits are conventional, focused (one logical change each), and **GPG-signed**.
- [ ] **No secrets** committed (`.env`, `*.pem`, keys). Staged files explicitly — no `git add -A`.
- [ ] **No AI attribution** anywhere (commits, PR body, code comments, docs).
- [ ] Casper constraints respected: `casper-js-sdk` v5 only · TransactionV1 · Next.js ≥ 15.5.19 · x402 header is `PAYMENT-SIGNATURE`.

## Testnet proof (if this changes on-chain behavior)

<!-- If this touches the contract, agent cycle, or verifiers, paste the casper-test
     deploy hash(es) proving the change behaves correctly. Leave N/A otherwise. -->

## Notes for reviewer

<!-- Anything non-obvious, edge cases handled, or follow-ups parked in an issue. -->
