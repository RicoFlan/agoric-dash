# Live Agoric network endpoints: access and verified values

Recorded 17 September 2026.

## How Claude reaches them in this setup

The cloud workspace's shell and the linked Mac's Cowork shell both go through an egress allowlist that currently refuses `*.agoric.net` (HTTP 403 from the proxy on CONNECT). Claude's web-fetch tool also refuses these hosts because the API server returns 501 for `robots.txt`. What works is the **built-in browser pane** on the linked Mac: `main.api.agoric.net` has been granted site-wide access there, and the JSON responses read cleanly as page text.

Consequences:

- Claude can read any REST endpoint under `https://main.api.agoric.net` on request. Other hosts (`main.rpc.agoric.net`, `devnet.api.agoric.net`, `emerynet.api.agoric.net`, `main.agoric.net` for network-config) each need a one-time browser access grant; ask and Claude will request it.
- Scripts run by Claude (curl, agd, Node) cannot reach the chain until `*.agoric.net` is added to the organisation's network allowlist (Claude admin settings → Capabilities → network access, owner-only). That change is what would let `agt doctor` and the Probe be developed and tested from this session rather than from a native terminal.
- The a3p synthetic-chain image and the local Docker chain are unaffected; they run on the Mac.

## Endpoints worth knowing

| Purpose | URL |
|---|---|
| Swingset params (fees, limits) | `https://main.api.agoric.net/agoric/swingset/params` |
| Node config (min gas price) | `https://main.api.agoric.net/cosmos/base/node/v1beta1/config` |
| Node and app version | `https://main.api.agoric.net/cosmos/base/tendermint/v1beta1/node_info` |
| vstorage children / data | `https://main.api.agoric.net/agoric/vstorage/children/published` · `.../data/published.agoricNames.instance` |
| Governance proposals | `https://main.api.agoric.net/cosmos/gov/v1/proposals` |
| Network config (chain id, RPC/API lists, upgrade notes) | `https://main.agoric.net/network-config` |
| Devnet / Emerynet equivalents | replace `main` with `devnet` or `emerynet` |

## Values verified on 2026-09-17 (mainnet, `agoric-3`)

From `/agoric/swingset/params`:

- `fee_unit_price`: `1000000 ubld` — one fee unit costs 1 BLD. **Swingset fees are denominated in BLD.**
- `beans_per_unit`: feeUnit 150,000,000,000; storageByte 20,000,000; smartWalletProvision 1,500,000,000,000; minFeeDebit 200,000,000,000; inboundTx 10,000,000,000; message 1,000,000,000; messageByte 20,000,000; vatCreation 30,000,000; xsnapComputron 100; blockComputeLimit 6,500,000,000.
- Derived: storage costs 20e6 / 150e9 = **0.000133 BLD per byte, about 0.133 BLD per 1,000 bytes**, before other transaction costs. Smart wallet provisioning is 1.5e12 / 150e9 = **10 BLD** (and `power_flag_fees` for `SMART_WALLET` is 10,000,000 ubld = 10 BLD, consistent).
- `bundle_uncompressed_size_limit_bytes`: 10,000,000. `chunk_size_limit_bytes`: 490,000 — chunked bundle installation exists at the chain level, which bears on sharp-edges item 16 (the ~1 MB RPC body limit) and should be checked against the current `agd tx swingset install-bundle` options.
- `installation_deadline_seconds`: 86,400.

From `/cosmos/base/node/v1beta1/config` (this particular API node): `minimum_gas_price` = `0.025 ubld`. Only `ubld` is listed on this node; another node reportedly accepts both `ubld` and `uist`, so minimum-gas denominations are per-node configuration, not chain policy. Do not claim that IST is universally rejected for gas; do claim that swingset fees are BLD-denominated.

From `/cosmos/base/tendermint/v1beta1/node_info`: network `agoric-3`; `agd` version `0.36.0-u23.1`, git `cc25a298dc`, Go 1.24.1; CometBFT `0.38.19`; cosmos-sdk modules at the v0.53 line (`cosmossdk.io/api v0.9.2`, `x/upgrade v0.2.0`).

## What this settles for the docs-fix list

- Item 1 (fee token): confirmed by chain parameters, plus `a3p-integration/proposals/k:param-change/drop-ist.json` in the SDK ("Denominate swingset fees in BLD").
- Item 2 (install fee): the "0.02 IST per KB" figure is obsolete; current storage cost is ~0.133 BLD per KB.
- Item 6 (chain-integration page): mainnet runs upgrade-23 on cosmos-sdk v0.53 / CometBFT 0.38, not v0.45.
- `--gas auto`: not settled by any endpoint. Agoric's own `multichain-testing/tools/e2e-tools.js` uses `--gas auto` for `install-bundle` on local chains, so the devnet failures in sharp-edges 14/15 need a reproduction (tx hash, bundle size, node) before they go into a docs PR.
