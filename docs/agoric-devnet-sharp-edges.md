# Agoric devnet sharp edges

Consolidated from the Servandum contract build (two orchestration escrow contracts, FiDeal7 and FiDealAI, deployed to agoricdev-25 across sessions 65 to 79, March to August 2026). Sources: `servandum-contracts-ref.md` (frozen 2026-08-26), the Critical Bugs table in the FiDeal master doc, and the "Agoric rules" block from the Claude Code redeploy prompt. FiDeal-specific product detail has been stripped; what remains is what any orchestration contract on the current SDK will hit.

Each item is a candidate entry for the Release 1 common-error catalogue. Where the symptom is silent (no error, nothing happens) that is noted, because those are the ones models cannot self-correct from.

## Flow-level rules (contract code)

**1. No `E()` on orchestration account methods inside flows.**
`E(holdingAccount).send(...)` never executes. `E()` wraps the call in a promise; the flow runner intercepts `await` to resolve vows, sees the outer promise resolve to a raw vow, and treats the await as complete. The send is never issued. Symptom: the flow hangs silently, the offer stays in `liveOffers` forever, no error anywhere. Applies to `send`, `transfer`, `getBalance` and every other method on an `OrchestrationAccount` called from inside a flow. Call them directly and let the flow runner handle vow resolution. This was the root cause of every failed fund movement on devnet until fixed (commit 0f2cd09).

**2. Pre-compute anything you will publish before the first `await`.**
Data read from durable record objects after an await boundary comes back as empty objects or stale proxies. Read synchronously at the top of the flow, serialise (`sanitizeForPublish` or equivalent), then await. `sanitizeValue` must recurse into nested objects rather than falling through to `String(v)`.

**3. Flow return values are `JSON.stringify(result)`, not `harden(result)`.**
The smart wallet cannot serialise hardened objects across the result path.

**4. State lives in the invitation handler, not the guest.**
Flows do asset movement and return plain results. The handler owns the durable stores.

**5. Re-read state before every `store.set()`.**
Vats are single-threaded but async flows yield at every await, so two flows can read the same status and both proceed. Re-read the record immediately before each set and throw if the status changed since the top of the flow (TOCTOU guard, commit 1e757f5).

**6. `harden()` everything that crosses a boundary.**
Objects, arrays, records.

**7. Do not call `orch.getChain('agoric')` during contract start.**
It hangs forever on devnet. Pass the pay denom (and anything else you would look up) as a contract term. Fixed Session 68.

**8. VStorage path segments use hyphens, never dots.**
`published.x.escrow-1` works. `published.x.escrow.1` is rejected silently and the publish fails with no error surfaced to the flow. Fixed Session 65.

**9. `zone.exo` interfaces freeze on first creation.**
Upgrading contract code does not change the exo shape. Adding a method to the public facet under the same label does nothing; the zone keeps the original shape. Deploy with a fresh exo label (FiDeal became FiDeal7 for this reason, Session 69). This is a critical one for the skill pack: a model that "adds a method and redeploys" will see nothing change and has no way to diagnose why.

**10. Use an id prefix contract term on redeploys.**
Counters restart at 1 on a fresh instance, so new records overwrite the previous deployment's vstorage nodes unless ids carry a prefix (`v2-1`, `v7-1`). Default `''` for backward compatibility. Drift warning: the repo source can carry one prefix while the live instance was deployed with another; treat the on-chain terms as truth.

**11. Wakeup handlers that use `async wake()` with cross-vat `E()` calls are not upgrade-safe.**
Accepted risk in the Servandum contracts. Refactoring to orchestrated flows needs seatless flows, which the SDK did not make straightforward at the time. Worth checking whether that has changed before the Preflight checks are written.

**12. Authorization by self-reported `offerArgs` address is the standard pattern, not a bug.**
The framework does not expose the signer to the contract. Flag it in reviews as an accepted limitation, not a finding.

**13. Order fund movements so a partial failure cannot double-pay.**
In a split resolution: send to the first party, set state to terminal, then send to the second party inside try/catch with a pending flag. If the second send fails the state is already terminal and a retry cannot re-send the first. (Code review finding C1.)

## Deployment and CLI rules

**14. Bundle installs need `--gas 100000000` explicitly.**
`--gas auto` and `--gas 50000000` both return success and install nothing. Silent. Query the chain for the bundle id before submitting the CoreEval.

**15. Bundle install RPC success does not mean the bundle is on chain.**
Same root cause as 14 from the other direction. Always verify.

**16. Public RPC rejects bodies over roughly 1MB (CometBFT `max_body_bytes`, HTTP 413).**
Compress the bundle and use explicit gas. Contracts larger than 1MB compressed need the multi-bundle install pattern.

**17. Wallet actions that move funds need `--allow-spend`.**
Without it the action is submitted as `MsgWalletAction` instead of `MsgWalletSpendAction`. Transaction returns code 0, the offer is silently rejected, nothing moves.

**18. Board ids and instance handles change on every deploy.**
Nothing in the client may hardcode them.

**19. Pay denom differs per network.**
Devnet uses `ibc/toyusdc` (issuer `USDC_axl`). Mainnet needs the Noble USDC IBC denom. Keep it a contract term.

## Environment and tooling

**20. Lockfiles go stale on package rename.**
`yarn.lock` and `package-lock.json` generated under an old package name or path break `npm ci` on CI and `yarn install` locally with legacy-lockfile errors. Regenerate after any rename. Yarn 4 via corepack, with `corepack enable` ordered before `setup-node` in CI.

**21. Case-sensitive constant misuse in a rarely-exercised path.**
`bpsBase` vs `BPS_BASE` in a wakeup handler would have crashed every auto-executed split. Caught by automated review, not by tests, because the wakeup path had no test coverage. Argument for the Preflight lint pass covering handlers, not only flows.

**22. Timer wakeups may not fire on devnet.**
Infrastructure issue on the shared devnet, not a contract bug. Do not spend time debugging contract timer logic against devnet before checking the timer on a local chain.

## Testing note

The Servandum test suites (`test-fideal-flows.js`, `test-fidealai-flows.js`, ~4,200 lines) call flow functions directly with hand-mocked `zcf`, seats, orchestrator and timer, under `@endo/init` but without `setUpZoeForTest` or the orchestration test harness. They pass under conditions the chain does not provide. That is exactly the failure mode listed in the Release 1 plan §2.1 and is a useful negative example when writing the testing idiom.

## Where the source lives

Contract source, tests and deploy scripts: `~/Desktop/Servandum/FiDeal-Repo/contract/repo/contract/` (remote `Servandum/Servandum`). Files: `fideal.contract.js`, `fideal.flows.js`, `fideal.schedule-flows.js`, `fideal.tap-kit.js`, `fideal.utils.js`, `fidealai.contract.js`, `fidealai.flows.js`, `start-fideal.js`, `start-fidealai.js`. Not imported here because of size and because it is not Apache-2.0 snippet material; pull individual functions when a specific example is needed.
