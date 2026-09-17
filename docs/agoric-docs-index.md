# docs.agoric.com page index for AAT

Generated 17 September 2026 from `Agoric/documentation` at `d89bd22` (upstream HEAD): the VitePress sidebar (`main/.vitepress/config.mjs`) for titles and ordering, page frontmatter or first paragraph for the one-liner. 132 pages; 90 in the sidebar, the rest reachable only by link or redirect.

## Citation convention for skills and snippets

Cite a page by its **route**, never by memory of its content. Route `/guides/zoe/contract-upgrade` resolves to:

- rendered: `https://docs.agoric.com/guides/zoe/contract-upgrade` (VitePress; `/x/` routes are directory indexes)
- source: `https://raw.githubusercontent.com/Agoric/documentation/main/main/guides/zoe/contract-upgrade.md` (a route ending in `/` maps to `.../index.md`)

Skills write `See docs:/guides/zoe/contract-upgrade` and a fetch helper expands it; the model fetches the page before answering questions that depend on it. Pages marked STALE carry a known error listed in `agoric-docs-context.md` §4; cite them with the caveat.

**AAT use** key: skills = Release 1 idioms guide; snippets = Release 1 corpus; preflight = Release 3; manifest = Format B; trace = Format A / VowScope; vstorage toolkit = Release 5; offer-lab = Release 9; deploy = `agt` deploy and project conventions; doctor = Release 2; probe = Release 4; studio = Stage 4; sentinel = Branch B; gallery = non-DeFi example gallery; plain-docs = source for non-technical explanations; — = not used.


## Core concepts (what-is, platform, glossary)

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/glossary/` | Glossary | This page lists words, expressions, or concepts used by the Agoric technology stack. | skills (terminology) · plain-docs |
| `/guides/platform/` | Agoric Platform | This document focuses on the layers beneath Zoe and ERTP, what we call the Agoric Platform. This includes "SwingSet", which can be thought of as… | plain-docs |
| `/what-is-agoric` | What is Agoric? | Agoric is a Cosmos-based Layer 1 blockchain for building cross-chain smart contracts in JavaScript. The platform’s asynchronous, multi-block… | plain-docs · STALE (IST as fee token) |

## Hardened JavaScript

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/guides/js-programming/eventual-send` *(not in sidebar)* | Eventual Send with E() | E(obj).method() sends a message to a possibly remote object and returns a promise; contrasts with fetch, explains pipelining and errors. | skills (E()) |
| `/guides/js-programming/far` *(not in sidebar)* | Far(), Remotable, and Marshaling | Far() marks objects pass-by-reference across vats; how marshaling copies data and passes remotables. | skills (Far/exo) |
| `/guides/js-programming/hardened-js` *(not in sidebar)* | Hardened JavaScript | Hardened JavaScript (SES): object capabilities, harden(), POLA, Compartments, defensive correctness; includes a video lecture. | skills (Hardened JS) · preflight |
| `/guides/js-programming/` | JavaScript Framework | The Agoric smart contract platform starts with a JavaScript framework for secure distributed computing. | skills · plain-docs |
| `/guides/js-programming/notifiers` *(not in sidebar)* | Notifiers and Subscriptions | Notifiers and subscriptions for distributed async iteration: NotifierKit, SubscriptionKit, use in Zoe and vstorage publishing. | vstorage toolkit · event relay |

## ERTP

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/guides/ertp/amount-math` | AmountMath | Depositing and withdrawing assets from a purse and manipulating payment amounts all require adding and subtracting digital assets. ERTP uses the… | skills (ERTP) · manifest |
| `/guides/ertp/amounts` | Amounts, Values, and Brands | An amount describes digital assets. There are no amount API methods, but AmountMath methods take amounts as arguments to get information about and… | skills (ERTP) · manifest |
| `/guides/ertp/` | ERTP | ERTP (_Electronic Rights Transfer Protocol_) is Agoric's token standard for transferring tokens and other digital assets in JavaScript. Using the… | skills (ERTP) · manifest |
| `/guides/ertp/issuers-and-mints` | Issuers and  Mints | Behind the scenes, an issuer maps minted digital assets to their location in a purse or payment. An issuer verifies, moves, and manipulates… | skills (ERTP) · manifest |
| `/guides/ertp/purses-and-payments` | Purses and Payments | Purses hold assets long-term; payments move them. Deposit facets, deposit/withdraw semantics, and the issuer as source of truth. | skills (ERTP) · manifest |

## Zoe guides

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/guides/zoe/contract-access-control` | Access Control Smart Contract | In our third smart contract, we will demostrate how to control access to different functions of a smart contract. So far, we have only used… | snippets (tut-03) · skills (POLA) |
| `/guides/zoe/contract-basics` | Smart Contract Basics | This guide is designed to help developers understand how to write smart contracts efficiently and securely. Here, you will find detailed examples… | skills · snippets |
| `/guides/zoe/contract-details` | Durable Contract Details | Zoe allows you to write smart contracts that manage interactions between cooperative, but possibly untrusting, parties. Some contracts perform a… | skills (durability) · manifest |
| `/guides/zoe/contract-hello` | Hello World Smart Contract | Before we look at how to make a contract such as the one in the basic dapp in the previous section, let's cover some basics by writing a simple… | snippets (tut-01) |
| `/guides/zoe/contract-requirements` *(not in sidebar)* | Contract Requirements | When writing a smart contract to run on Zoe, you need to know the proper format and other expectations. | preflight (library compatibility) · skills |
| `/guides/zoe/contract-state` | State Smart Contract | In our first hello-world smart contract, we created a greet function and exposed it using publicFacet so that it can be remotely called. However,… | snippets (tut-02) · skills |
| `/guides/zoe/contract-upgrade` | Contract Upgrade | The return value when starting a contract includes a capability to upgrade the contract instance. A call to E(zoe).startInstance(...) returns a… | skills (durability) · eval task 11 · preflight |
| `/guides/zoe/contract-walkthru` | Complete Contract Walk-Through | Line-by-line walk through of the dapp-offer-up contract: terms, mint, proposal shape, handler, invitation, public facet. | snippets · manifest (offer-up subject) |
| `/guides/zoe/` | Zoe Smart Contract Framework | The Zoe service and smart contract API support credibly trading assets with reduced risk. | skills · plain-docs |
| `/guides/zoe/offer-enforcement` *(not in sidebar)* | Zoe: Offer-Safety Enforcement | How Zoe enforces offer safety and payout liveness: escrow, seats, reallocation, with a swap example. | skills (offer safety) · eval task 9 |
| `/guides/zoe/offer-safety` *(not in sidebar)* | Offer Safety | For Zoe to enforce offer safety, the user must give Zoe a proposal. This is a description of both what they want and what they are offering, and… | skills (offer safety) · eval task 9 |
| `/guides/zoe/price-authority` *(not in sidebar)* | Price Authority | A priceAuthority can be used in contracts (usually specified in the terms of a contract) to provide a price feed, on-demand quotes, and wakeups… | — (DeFi) |
| `/guides/zoe/proposal` *(not in sidebar)* | The Structure of Offers | E(zoe).offer(invitation, proposal, payments, offerArgs): proposal structure (give/want/exit), exit rules, offer results. | skills · offer-lab |
| `/guides/zoe/pub-to-storage` *(not in sidebar)* | Publishing to chainStorage | Contracts can use notifiers and subscriptions to publish to clients. To publish data visible to vstorage queries, contracts should connect a… | vstorage toolkit · manifest (published) |

## Zoe example contracts

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/guides/zoe/contracts/atomic-swap` | Atomic Swap Contract | If I want to trade one kind of asset for another kind, I could send you the asset and ask you to send the other kind back. But, you could behave… | gallery · skills (two-party pattern) |
| `/guides/zoe/contracts/automatic-refund` | Automatic Refund Contract | This is a very trivial contract to explain and test Zoe. AutomaticRefund just gives you back what you put in. AutomaticRefund tells Zoe to exit… | snippets (minimal contract) |
| `/guides/zoe/contracts/barter-exchange` | Barter Exchange Contract | Barter Exchange takes offers for trading arbitrary goods for one another. | gallery |
| `/guides/zoe/contracts/constantProductAMM` | ConstantProduct AMM Contract | The Constant Product AMM is an automated market maker (AMM) that supports multiple liquidity pools and direct exchanges across pools. It's called… | — (DeFi) |
| `/guides/zoe/contracts/covered-call` | Covered Call Contract | The owner of an asset can use a covered call to give someone else the right to buy the asset at a certain price, called the strike price. That… | gallery · skills (timer exit) |
| `/guides/zoe/contracts/escrow-to-vote` | Escrow To Vote Contract | This contract implements coin voting. There are two roles: the Secretary, who can determine the question (a string), make voting invitations, and… | gallery (non-DeFi) · studio |
| `/guides/zoe/contracts/fundedCallSpread` | Funded Call Spread Contract | This contract implements a fully collateralized call spread. You can use a call spread as a financial building block to create futures, puts,… | — (DeFi) |
| `/guides/zoe/contracts/` | Example Zoe Contracts | While Zoe provides the means to build custom smart contracts, there is a good chance you will want to use one that follows a commonly-used… | gallery (check currency per contract) |
| `/guides/zoe/contracts/loan` | Loan Contract | The basic loan contract has two parties, a _lender_ and a _borrower_. It lets the borrower add collateral of a particular brand and get a loan of… | — (DeFi) |
| `/guides/zoe/contracts/mint-and-sell-nfts` | Mint and Sell NFTs Contract | This contract mints non-fungible tokens and creates a selling contract instance to sell the tokens in exchange for some sort of money. | gallery (non-DeFi) |
| `/guides/zoe/contracts/mint-payments` | Mint Payments Contract | This very simple contract shows how to create a new issuer kit and mint payments from it. The contract pays out new tokens to anyone who has an… | gallery (non-DeFi) |
| `/guides/zoe/contracts/oracle` | Oracle Query Contract | This contract lets other contracts or users make single free or fee-based queries to a generic oracle node (a single instance). This provides a… | — (oracle) |
| `/guides/zoe/contracts/otc-desk` | OTC Desk Contract | This is the OTC Desk contract from the "Building a Composable DeFi Contract" episode of Cosmos Code With Us workshop. | — (DeFi) |
| `/guides/zoe/contracts/pricedCallSpread` | Priced Call Spread Contract | This contract implements a fully collateralized call spread. You can use a call spread as a financial building block to create futures, puts,… | — (DeFi) |
| `/guides/zoe/contracts/second-price-auction` | Second-Price Auction Contract | In a second-price auction, the winner is the participant with the highest bid, but the winner only pays the price corresponding to the second… | gallery (non-DeFi) |
| `/guides/zoe/contracts/sell-items` | Sell Items Contract | Sell items in exchange for money. Items may be fungible or non-fungible and multiple items may be bought at once. Money must be fungible. | gallery (non-DeFi) |
| `/guides/zoe/contracts/simple-exchange` | Simple Exchange Contract | The "simple exchange" is a very basic, un-optimized exchange. It has an order book for one asset, priced in a second asset. The order book is… | — (DeFi) |
| `/guides/zoe/contracts/use-obj-example` | Use Object Contract | This contract is an example of associating a particular ability with ownership of a non-fungible token (NFT). In this case, ownership of a… | gallery (non-DeFi) |
| `/guides/zoe/contracts/vault` | Vault Contract | The Vault is the primary mechanism for making IST (the Agoric stable-value currency) available to participants in the economy. It does this by… | — (DeFi) |

## Orchestration

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/guides/orchestration/contract-walkthroughs/cross-chain-unbond` | Cross-Chain Unbond Example | This walkthrough outlines the functionality of the Unbond Contract that enables unbonding of assets from a Cosmos-based chain and transferring… | snippets · trace |
| `/guides/orchestration/contract-walkthroughs/` | Contract Walkthroughs | This section is designed to provide detailed explanations and insights into example Orchestration smart contracts. | snippets |
| `/guides/orchestration/contract-walkthroughs/send-anywhere` | Send Anywhere Example | The "Send Anywhere" contract is designed to facilitate the transfer of assets from one chain to another using Agoric's Orchestration library. The… | snippets · manifest (send-anywhere subject) · trace (event kinds) |
| `/guides/orchestration/how-orch-works` | How Orchestration Works | Orchestration relies on protocols and mechanisms that allow blockchains to communicate and transact with each other securely and efficiently. The… | skills (orchestration primer) · probe |
| `/guides/orchestration/` | What is Agoric Orchestration? | Agoric's Orchestration SDK allows developers to easily build cross-chain interactions into existing applications or to create novel… | skills · plain-docs |
| `/guides/orchestration/key-concepts` | Key Concepts and APIs | This document provides an overview of the fundamental concepts involved in building Orchestration smart contracts, focusing on Orchestrator… | skills · manifest (account/chain surfaces) |
| `/guides/orchestration/orchestration-basics/contract` | Orca Contract walkthrough | This section provides a walkthrough of the Orca contract code, explaining its structure, key components, and functionality. The Orca contract is… | — (stale APIs) |
| `/guides/orchestration/orchestration-basics/` | Example Orchestration DApp | Walkthrough of dapp-orchestration-basics (orca contract, UI, deployment) as an Orchestration starter. | — (stale dapp; layout only) |
| `/guides/orchestration/orchestration-basics/installation` | Installation and Deployment | The dApp implements a smart contract that can be installed and deployed on any Agoric testnet. Since, the contract interacts with the remote… | deploy (multichain env) · eval harness |
| `/guides/orchestration/orchestration-basics/ui` | UI Walkthrough | The React components of the Orchestration dApp UI: wallet connection, account creation, offers. | studio (console) |
| `/guides/orchestration/txvsportfolio` | Transactional vs Portfolio | Agoric Orchestration supports both **transactional contracts** for single interactions and **portfolio contracts** for rich, persistent user… | studio (recipe design) · skills |

## Deployment (CoreEval), CLI, integration

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/guides/agoric-cli/agd-query-tx` | Using agd to make queries and transactions | agd is the Agoric Cosmos App, analagous to simd in the Cosmos SDK simapp or gaiad in the Cosmos hub. Most of the simd query commands and… | doctor · vstorage toolkit · deploy |
| `/guides/agoric-cli/` | Agoric CLI | Displays the Agoric CLI commands and arguments with brief descriptions. | doctor · deploy |
| `/guides/coreeval/` | Permissioned Contract Deployment | Until mainnet enters the Mainnet-3 phase of the multi-phase mainnet rollout, permissionless contract installation with Zoe is limited to… | deploy · plain-docs |
| `/guides/coreeval/local-testnet` | Submit Transactions | Step-by-step: bundle, fund, install-bundle, submit a swingset-core-eval proposal and vote on a local chain, with agd transcripts. | deploy · STALE (IST install fee, --gas auto) |
| `/guides/coreeval/permissions` | Declare Required Capabilities | Most contract deployments don't need everything in BootstrapPowers. Verifying by inspection that they don't use any more than they need is… | manifest (required capabilities) · preflight (capability report) · skills (POLA) |
| `/guides/coreeval/proposal` | Write Code to Deploy a Contract | When a core eval script is evaluated, the completion value is expected to be a function. The function is invoked with a _BootstrapPowers_ object… | deploy · eval task 13 · snippets |
| `/guides/getting-started/deploying` *(not in sidebar)* | Deploying Smart Contracts | The agoric deploy command in the Agoric command line tool supports deploying contracts and off-chain web applications that talk to those… | deploy |
| `/guides/getting-started/explainer-deploying-a-smart-contact` *(not in sidebar)* | Deploying a Smart Contact | In the dapp-offer-up tutorial you just went through you saw how quick and easy it was to deploy a contact on Agoric using the yarn start:contract… | plain-docs · deploy |
| `/guides/getting-started/explainer-how-to-start-a-local-chain` *(not in sidebar)* | Starting a Local Chain | Video-backed explainer for starting a local Agoric chain in Docker (yarn start:docker) and watching blocks. | doctor · deploy |
| `/guides/integration/chain-integration` | Integrating with Agoric Network | The Agoric network builds a blockchain for smart contracts in JavaScript using the cosmos-sdk. Cosmos-sdk is software that provides the… | probe · sentinel |
| `/guides/integration/name-services` | Name Services: agoricNames, namesByAddress, board | agoricNames/agoricNamesAdmin (well-known names), namesByAddress and depositFacet (per-account namespace), and the board (arbitrary names). | vstorage toolkit (board resolution) · skills |

## Getting started, tutorials, dapps

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/e2e-testing` | End-to-End Testing | Developing Decentralized Applications (DApps) on the Cosmos network often involves integrating with the Keplr wallet. Testing is key for ensuring… | studio (hosted demo tests) |
| `/guides/UIComponentLibrary/assets/asset` *(not in sidebar)* | /guides/UIComponentLibrary/assets/asset | Asset placeholder (no content). | — |
| `/guides/UIComponentLibrary/` | UI Component Library | You'll find a collection of ready-to-use or pre-coded user interface elements that help accelerate your Agoric Dapp-building. These pre-designed… | studio (console) |
| `/guides/dapps/dapp-templates` *(not in sidebar)* | /guides/dapps/dapp-templates | When creating a new dapp using agoric init, you have the option of starting from a number of templates. To use a template other than the default,… | STALE (archived dapps) |
| `/guides/dapps/` *(not in sidebar)* | Agoric Dapps | Index of dapp guides: templates, starting multiuser dapps, deployment. | plain-docs |
| `/guides/dapps/starting-multiuser-dapps` *(not in sidebar)* | Starting Multiuser Dapps | When developing a dapp, you may need to test how it behaves with multiple users before deploying it publicly. These users could have different… | studio (two-party demos) |
| `/guides/getting-started/contract-rpc` | Building Client Dapps | The Agoric Platform consists of smart contracts and services such as Zoe running in a Hardened JavaScript VM running on top of a Cosmos SDK… | offer-lab · vstorage toolkit · studio |
| `/guides/getting-started/explainer-how-to-make-an-offer` *(not in sidebar)* | Making an Offer | As you saw in the dapp-offer-up tutorial you could use the dapp UI to make an offer on up to three items. | plain-docs · offer-lab |
| `/guides/getting-started/` | Getting Started | Prerequisites and first run: Node, Yarn, Docker, cloning dapp-offer-up, starting the chain, deploying, opening the UI. | doctor · plain-docs |
| `/guides/getting-started/sell-concert-tickets-contract-explainer` *(not in sidebar)* | Sell Concert Tickets Smart Contract | This smart contract is designed to mint and sell event tickets as non-fungible tokens (NFTs) in the form of a semi-fungible asset. In this example… | gallery (non-DeFi) · snippets |
| `/guides/getting-started/start-a-project` *(not in sidebar)* | /guides/getting-started/start-a-project | Redirect stub to Getting Started (yarn create @agoric/dapp). | doctor |
| `/guides/getting-started/swaparoo-how-to-swap-assets-explainer` *(not in sidebar)* | Swaparoo Contract | This smart contract is designed to allow two parties to swap assets between themselves, with a fee charged to one of the parties. The contract is… | gallery |
| `/guides/getting-started/swaparoo-making-a-payment-explainer` *(not in sidebar)* | Sending Invitation Payments using an Address | In this document, we'll explain how to send a payment to someone using their agoric1... address from an Agoric smart contract using a deposit facet. | gallery |
| `/guides/getting-started/syncing-up` *(not in sidebar)* | Syncing Up on Mainnet | Tune in to Network Upgrades Governance in the Agoric Community Forum for changes to mainnet node operations, including deployment of new… | doctor |
| `/guides/getting-started/tutorial-dapp-agoric-basics` | dapp-agoric-basics | In this tutorial you will install the dapp-agoric-basics dapp. This dapp is a collection of basic use cases for Agoric smart contracts. | snippets · gallery (tickets, postal service) |
| `/guides/getting-started/tutorial/` | Tutorial: Dapp with Agoric | Index of dapp tutorials (dapp-agoric-basics, UI tutorial). | snippets |
| `/guides/getting-started/ui-tutorial/agoric-provider` | 2. Agoric Provider | The AgoricProvider provides a few things in the context of your app, accessible through hooks and components: | studio (console) |
| `/guides/getting-started/ui-tutorial/conclusion` | 6. Conclusion | Throughout this tutorial, you've accomplished all the basics of building an Agoric Dapp UI: | studio (console) |
| `/guides/getting-started/ui-tutorial/connect-wallet` | 3. Connect Wallet | At this point you should have an app rendering with a single "Connect Wallet" button. Try clicking on it and you should see a modal pop up with… | studio (console) |
| `/guides/getting-started/ui-tutorial/` | UI Tutorial | In this tutorial you will build your own UI from scratch. Along the way, you'll learn how to connect to a wallet, query the blockchain and smart… | studio (console) |
| `/guides/getting-started/ui-tutorial/making-an-offer` | 5. Making an Offer | If you've made it this far, you've created a React app that connects to the wallet, renders the IST purse balance of the user, and reads the chain… | studio (console) |
| `/guides/getting-started/ui-tutorial/querying-vstorage` | 4. Querying Vstorage | A fundamental part of building a Dapp UI is interacting with smart contracts. How can a UI read data from a smart contract on the Agoric… | studio (console) |
| `/guides/getting-started/ui-tutorial/starting` | 1. Starting | There are a few libraries that make building Agoric UIs more convenient, all included in the ui-kit repo: | studio (console) |

## Governance, indexing, wallet, other guides

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/guides/assets/` *(not in sidebar)* | /guides/assets/ | Image storage folder for the guides (no content). | — |
| `/guides/chainlink-integration` *(not in sidebar)* | /guides/chainlink-integration | How Chainlink oracle nodes feed price data to Agoric contracts via the oracle contract. | — (oracle) |
| `/guides/governance/` | Contract Governance | To help build systems with a good balance of decentralization and executive control, the Agoric platform includes, in addition to chain-wide… | studio (recipe 1) · governance autopilot |
| `/guides/subquery-indexing` | SubQuery Indexing | This document explains how to index Agoric blockchain data with SubQuery's open source data indexer. | sentinel · event relay |
| `/guides/wallet/` *(not in sidebar)* | Agoric Wallet | This page documents the _Agoric Wallet_, including its use of _petnames_ and its place in the Agoric Platform architecture. See also tour of the… | — (legacy wallet) |
| `/guides/wallet/ui` *(not in sidebar)* | Wallet UI | Legacy wallet UI opened via agoric open; dashboard, dapps, purses, contacts, issuers. | — (legacy wallet) |
| `/guides/zoe/actual-contracts/PSM` | PSM Contract | The Parity Stability Module (PSM) contract allows users to convert Inter Stable Tokens (ISTs) to external stable tokens at a specified fixed… | — (Inter Protocol, sunset) |
| `/guides/zoe/actual-contracts/` | Deployed Zoe Contracts | In the mainnet-1B release of agoric-sdk, the chain is configured to automatically deploy the following Zoe contracts. A community post on Inter… | — (Inter Protocol, sunset) |

## Reference

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/reference/assets/` *(not in sidebar)* | /reference/assets/ | Image storage folder for the reference (no content). | — |
| `/reference/ertp-api/amount-math` | AmountMath Object | AmountMath functions: make, add, subtract, isEmpty, isGTE, isEqual, coerce, min, max, over NAT, SET and COPY_BAG asset kinds. | manifest · offer-lab (API reference) |
| `/reference/ertp-api/brand` | Brand Object | A **Brand** identifies the asset type of the **Issuer** and **Mint** associated with the **Brand**. A given **Brand** has a one-to-one… | manifest · offer-lab (API reference) |
| `/reference/ertp-api/ertp-data-types` | ERTP Data Types | ERTP data types: Amount, AmountValue, AssetKind, DisplayInfo, IssuerKit, and related records. | manifest · offer-lab (API reference) |
| `/reference/ertp-api/` | ERTP API | ERTP API index: Issuer, Mint, Brand, Purse, Payment, AmountMath and data types. | manifest · offer-lab |
| `/reference/ertp-api/issuer` | Issuer Object | An **Issuer** is the authority on what holds digital assets of its kind. While it cannot create new value by creating digital assets like a… | manifest · offer-lab (API reference) |
| `/reference/ertp-api/mint` | Mint Object | Mint object: mintPayment, getIssuer; the sole creator of assets of a brand. | manifest · offer-lab (API reference) |
| `/reference/ertp-api/payment` | Payment Object | A **Payment** holds digital assets that are in transit or expected to soon be in transit. It can be deposited in **Purses**, split into or… | manifest · offer-lab (API reference) |
| `/reference/ertp-api/purse` | Purse Object | Purse object: getCurrentAmount, deposit, withdraw, getDepositFacet, getAllegedBrand. | manifest · offer-lab (API reference) |
| `/reference/repl/board` *(not in sidebar)* | /reference/repl/board | Stub pointing at the Board name service section of name-services. | — (REPL era) |
| `/reference/repl/` *(not in sidebar)* | Agoric REPL | Index of REPL-era reference pages (board, networking, priceAuthority, scratch, timerServices). | — (REPL era) |
| `/reference/repl/networking` *(not in sidebar)* | Network API | Suitably-empowered code inside a vat can access a "network API" that works vaguely like the BSD socket API. This code can: | — (REPL era) |
| `/reference/repl/priceAuthority` *(not in sidebar)* | /reference/repl/priceAuthority | Stub pointing at the Price Authority guide and API. | — (REPL era) |
| `/reference/repl/scratch` *(not in sidebar)* | Scratch | You use scratch to save key-value pairs for later. It is only on the ag-solo and is not accessible from the chain, making it private to the… | — (REPL era) |
| `/reference/repl/timerServices` *(not in sidebar)* | Timer Services | chainTimerService and manual timers: getCurrentTimestamp, setWakeup, makeRepeater, delay, TimeMath; block-time semantics. | skills (timer) |
| `/reference/vstorage-ref` *(not in sidebar)* | VStorage Reference | Full vstorage key layout: top-level keys, published.*, agoricNames hubs, well-known contracts and assets, boardAux, provisionPool, wallet paths. | vstorage toolkit (schemas) · manifest (published) · sentinel |
| `/reference/wallet-api/` *(not in sidebar)* | Wallet API | You can interact with a Wallet via the JavaScript _REPL_ (_Read-Eval-Print Loop_), which is visible at the bottom of the Wallet UI display. In the… | — (legacy wallet) |
| `/reference/wallet-api/wallet-bridge` *(not in sidebar)* | WalletBridge API Commands | These methods can be used by an untrusted Dapp without breaching the wallet's integrity. They are also exposed via the iframe/WebSocket bridge… | — (legacy wallet) |
| `/reference/wallet-api/wallet-commands` *(not in sidebar)* | Wallet API Commands | Returns the wallet bridge that bypasses Dapp-authorization. This should only be used within the REPL or deployment scripts that want to use the… | — (legacy wallet) |
| `/reference/zoe-api/` | Zoe API | The Zoe framework provides a way to write smart contracts without having to worry about offer safety. To use Zoe, we put things in terms of… | manifest · offer-lab |
| `/reference/zoe-api/mutable-quote` *(not in sidebar)* | NOT CURRENTLY INCLUDED IN THE PUBLISHED DOCS; PLEASE IGNORE | Use a **MutableQuote** when you expect to make multiple calls, replacing the trigger value. If you just need a single quote, and won't change the… | — (DeFi) |
| `/reference/zoe-api/price-authority-admin` *(not in sidebar)* | /reference/zoe-api/price-authority-admin | • **registerPriceAuthority**: (pa: ERef\<PriceAuthority\>, brandIn: Brand\<AssetKind\>, brandOut: Brand\<AssetKind\>, force?: boolean) =>… | — (DeFi) |
| `/reference/zoe-api/price-authority` | PriceAuthority Object | PriceAuthority object: quoteGiven, quoteWanted, quoteAtTime, quoteWhenGT and related price-quote methods. | — (DeFi) |
| `/reference/zoe-api/ratio-math` | Ratio Math Functions | These functions let you apply a **Ratio** (a fraction) to an amount, multiplying or dividing an amount by a ratio of two natural numbers. | manifest · offer-lab (API reference) |
| `/reference/zoe-api/user-seat` | UserSeat Object | Within Zoe, **seats** are used by contracts and users to access or manipulate offers. Zoe has two kinds of seats. **ZCFSeats** are used within… | manifest · offer-lab (API reference) |
| `/reference/zoe-api/zcfmint` | ZCFMint Object | An object used by the **Zoe Contract Facet** to issue digital assets. It's very similar to the **Mint** object, but it has a more limited set of… | manifest · offer-lab (API reference) |
| `/reference/zoe-api/zcfseat` | ZCFSeat Object | Zoe uses **seats** to access or manipulate offers. Seats represent active offers and let contracts and users interact with them. Two kinds of… | manifest · offer-lab (API reference) |
| `/reference/zoe-api/zoe-contract-facet` | Zoe Contract Facet (ZCF) | A Zoe Contract Facet is an API object for a running contract instance to access the Zoe state for that instance. A Zoe Contract Facet is accessed… | manifest · offer-lab (API reference) |
| `/reference/zoe-api/zoe-data-types` | Zoe Data Types | Zoe data types: Allocation, Instance, Installation, Invitation, Keyword, Proposal, ProposalRecord, Seat kinds, TransferPart, and more. | manifest · offer-lab (API reference) |
| `/reference/zoe-api/zoe-helpers` | ZoeHelper Functions | The ZoeHelper functions provide convenient abstractions for accessing Zoe functionality from within contracts. In most cases, you pass a reference… | manifest · offer-lab (API reference) |
| `/reference/zoe-api/zoe` | Zoe Service | Zoe provides a framework for deploying and working with smart contracts. It is accessed as a long-lived and well-trusted service that enforces… | manifest · offer-lab (API reference) |

## Landing pages

| Route | Title | One line | AAT use |
|---|---|---|---|
| `/guides/` | Guides index | This is the non-API section of the Agoric documentation. | plain-docs |
| `/` | Home | Landing page (component-rendered; no prose). | — |
