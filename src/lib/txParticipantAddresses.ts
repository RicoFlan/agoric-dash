/**
 * Extract Bech32 account addresses from decoded txs for participation metrics.
 * Prefix matches Agoric mainnet accounts (`agoric1…`).
 */
import { pubkeyToAddress } from "@cosmjs/amino";
import { decodePubkey } from "@cosmjs/proto-signing";
import type { AuthInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx";

export const AGORIC_ACCOUNT_PREFIX = "agoric";

/** Primary signer addresses from auth info (order preserved). */
export function signerBech32AddressesFromAuthInfo(authInfo: AuthInfo): string[] {
  const out: string[] = [];
  for (const si of authInfo.signerInfos ?? []) {
    if (!si.publicKey) continue;
    const pk = decodePubkey(si.publicKey);
    if (!pk) continue;
    try {
      out.push(pubkeyToAddress(pk, AGORIC_ACCOUNT_PREFIX));
    } catch {
      /* unsupported multisig / pubkey layout */
    }
  }
  return out;
}

/**
 * Economic fee payer for attribution (matches Cosmos SDK `Fee` fields + default signer).
 * Precedence: `fee.granter` (fee grant payer) → `fee.payer` (explicit payer, incl. multi-signer /
 * DIRECT_AUX-style assembly) → first `signerInfos` pubkey-derived address.
 *
 * Paid fee **amounts** still come from tx result events (`extractPaidFeesFromEvents`); this picks
 * **which address** receives those attributed totals in `address_fee_day`.
 */
export function feePayerBech32FromAuthInfo(authInfo: AuthInfo): string | null {
  const granter = authInfo.fee?.granter?.trim();
  if (granter) return granter;
  const explicitPayer = authInfo.fee?.payer?.trim();
  if (explicitPayer) return explicitPayer;
  const signers = signerBech32AddressesFromAuthInfo(authInfo);
  return signers[0] ?? null;
}
