/**
 * Participation / “active address” semantics for `participant_day`, `address_volume_day`,
 * `address_fee_day` (populated by `scripts/indexer.ts` from successful txs only).
 */

/** Stored in `participant_day.role`; must match indexer strings exactly. */
export const PARTICIPANT_ROLES = {
  SIGNER: "signer",
  FEE_PAYER: "fee_payer",
} as const;

/**
 * Plain-language policy (mirrored in METHODOLOGY_BLURB).
 *
 * Roles: signer addresses come from every pubkey in `auth_info.signer_infos` (multiple entries when
 * the tx lists multiple signers). Fee payer follows fee.granter → fee.payer → first signer
 * (`feePayerBech32FromAuthInfo`).
 *
 * Scope: successful txs only (ABCI code 0). No inference of end-user identity; one entity may use
 * many accounts. Module accounts, contracts, relayers, and vaults appear like any other account if
 * they sign or pay fees — there is no exclusion list.
 *
 * KPI distinct signers / distinct fee payers count unique addresses **within each role** across the
 * selected UTC day range. “Active 1 day only” vs “2+ days” counts unique addresses by how many UTC
 * calendar days they appear in **either** role (`participant_day`). The distinct-accounts line chart
 * uses COUNT DISTINCT address **per UTC day** across **both** roles (same address twice as signer +
 * fee payer that day counts once).
 *
 * Gross concentration uses sender-side transfer legs (`address_volume_day`), not IBC recv attribution.
 */
