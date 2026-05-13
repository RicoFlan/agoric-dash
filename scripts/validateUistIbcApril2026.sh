#!/usr/bin/env bash
# Replay IBC recv `uist` for UTC calendar days 2026-04-26 .. 2026-04-29 using fixed
# height bounds (same-day boundaries as `scripts/scanIbcRecvDay.ts` + SCAN_HEIGHT_*).
# Compare stderr "Totals" lines and JSON `totals.uist` to `daily_metrics`:
#   series = ibc_transfer_amount_in, dimension = uist.
#
# Usage:
#   ./scripts/validateUistIbcApril2026.sh | tee /tmp/uist-validation.log
#   SCAN_CONCURRENCY=4 RPC_URL=https://main-a.rpc.agoric.net ./scripts/validateUistIbcApril2026.sh

set -euo pipefail
cd "$(dirname "$0")/.."

export RPC_URL="${RPC_URL:-https://main-a.rpc.agoric.net}"
export SCAN_CONCURRENCY="${SCAN_CONCURRENCY:-4}"

# First height on/after day D 00:00 UTC -> first height on/after (D+1) 00:00 UTC (exclusive end).
# Heights from CometBFT /block time binary search (agoric-3, 2026-05).
RUNS=(
  "2026-04-26:25142215:25157521"
  "2026-04-27:25157521:25172766"
  "2026-04-28:25172766:25188043"
  "2026-04-29:25188043:25203533"
)

echo "=== DB expected (ibc_transfer_amount_in / uist, minimal units) ==="
echo "2026-04-26: 296958610920"
echo "2026-04-27: 194458421936"
echo "2026-04-28: 114991047960"
echo "2026-04-29: 403412288"
echo ""
echo "=== On-chain scan (start) $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

for row in "${RUNS[@]}"; do
  IFS=: read -r DAY HS HE <<< "$row"
  blocks=$((HE - HS))
  echo ""
  echo "========== $DAY  heights ${HS} .. $((HE - 1))  (${blocks} blocks) =========="
  export SCAN_HEIGHT_START="$HS"
  export SCAN_HEIGHT_END_EXCLUSIVE="$HE"
  npx tsx scripts/scanIbcRecvDay.ts "--day=${DAY}" "--denom=uist"
done

echo ""
echo "=== Done $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
