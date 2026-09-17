# Agoric contract deploy sequence (local chain, devnet, emerynet)

Condensed from the Servandum `DEPLOY.md` (Emerynet, March 2026, still branded PactPay) and `setup-local-chain.sh` (local Docker chain, April 2026), corrected against the gas and verification lessons recorded in `agoric-devnet-sharp-edges.md`. Names and addresses from the originals have been removed. This is the sequence the Stage 0 CLI and the Release 1 "project conventions" section should encode.

## Prerequisites

Node 20.9+ or 22.11+. Yarn 4 through corepack (`corepack enable && corepack prepare yarn@4 --activate`). Docker Desktop for the local chain and for `agd` if not installed natively. The contract `package.json` pulls `@agoric/zoe`, `@agoric/orchestration`, `@agoric/ertp`, `@agoric/time`, `@agoric/vat-data`, `@agoric/internal`, `@agoric/deploy-script-support`, `@endo/init`, `@endo/far`, `@endo/patterns`, `@endo/errors`, `@endo/eventual-send`, `@endo/bundle-source`, with ava for tests and `@endo/init` in ava's `require`.

Version pinning matters. The Servandum repo used `latest` for the Agoric packages; the Emerynet guide notes that bundling fails when package versions drift from the chain's upgrade (upgrade-21 at the time). Stage 0 should pin to the SDK version matching the target network.

## Sequence

**1. Bundle.** `agoric run src/start-<contract>.js` produces the bundle and the proposal artifacts (permit JSON and eval JS). Fallback if `agoric run` fails: call `@endo/bundle-source` directly. Bundles are 1 to 5 MB uncompressed; compress before install. Output: a bundle JSON and a bundle id of the form `b1-<hash>`.

**2. Install the bundle.**
```
agd tx swingset install-bundle @bundle.json \
  --from <key> --keyring-backend test \
  --chain-id <chain> --node <rpc> \
  --gas 100000000 -y
```
Explicit gas of 100000000. `--gas auto` and lower fixed values return success and install nothing. Public RPC rejects bodies over about 1MB (HTTP 413), so compress; contracts larger than that compressed need the multi-bundle install pattern.

**3. Verify the install landed.** Query the chain for the bundle id before going further. A successful transaction hash is not proof.

**4. Submit the CoreEval proposal.**
```
agd tx gov submit-proposal swingset-core-eval \
  <permit>.json <eval>.js \
  --title "..." --description "..." \
  --deposit 10000000ubld \
  --from <key> --keyring-backend test \
  --chain-id <chain> --node <rpc> \
  --gas auto --gas-adjustment 1.3 -y
```
The 10 BLD deposit returns after the voting period regardless of outcome. The permit declares which chain powers the eval needs; the eval starts the instance and registers it.

**5. Vote.** Find the proposal id with `agd query gov proposals --status voting_period`, then `agd tx gov vote <id> yes ...`.

On a local chain the validator key has all the voting power and a 10s voting period, so this passes immediately. On Emerynet the voting period is 2 hours and a deployer key with no stake cannot pass a proposal alone; a validator vote (Agoric team or DCF contact) or staking BLD first is needed. On devnet the same constraint applies. This is the "mainnet deployment is permissioned" point in the opportunities doc, and it applies to testnets too.

**6. Verify the instance.**
```
agd query vstorage data published.agoricNames.instance --node <rpc>
agd query vstorage children published.<contract> --node <rpc>
```
The instance appears in agoricNames and the contract's vstorage root exists with the expected children.

**7. Verify vbank assets when the contract needs a specific denom.** `agd query vstorage data published.agoricNames.vbankAsset` lists what the chain knows. Devnet pay denom is `ibc/toyusdc`; Emerynet USDC was `ibc/FE98AAD68F02F03565E9FA39A5E627946699B2B07115889ED812D8BA639576A9` at the time; mainnet is the Noble USDC denom. Keep this a contract term.

## Local chain

`setup-local-chain.sh` automates the whole sequence against `ghcr.io/agoric/agoric-sdk:latest` in Docker: start the chain (`agd start`), wait for block height, locate the validator key, create and fund test keys with `agd tx bank send`, bundle, install, propose, vote, verify. Chain id `agoriclocal`, container-local `agd` via `docker exec`. This script is the closest thing in the folder to what `aat` should become, and it is worth reading whole (544 lines) when Stage 0 day 2 starts.

## Redeploy rules

Every redeploy is a fresh instance with fresh board ids and instance handle. Client configuration must not hardcode them. Use a fresh exo label if the public facet shape changed (the zone freezes the shape under the old label). Use an id prefix contract term so new records do not overwrite the previous instance's vstorage nodes.

## Troubleshooting

"account sequence mismatch": previous transaction not yet in a block; wait and retry.
"out of gas": use explicit gas as above rather than raising `--gas-adjustment`.
"key not found": keyring not mounted or wrong `--keyring-backend`.
413 Payload Too Large: compress the bundle; if still over 1MB, multi-bundle install.
Offer returns code 0 but nothing happens: missing `--allow-spend` on a fund-moving wallet action.
Bundle "installed" but CoreEval fails to find it: the install silently failed on gas; reinstall with explicit gas and verify.
