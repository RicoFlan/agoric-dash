/**
 * Where a day-at-a-time backfill's coverage has to stop.
 *
 * A backfill writes a checkpoint, and the read path treats everything up to it as covered — so a
 * day the run could not get an answer for must not end up behind the checkpoint. If it does, the
 * dashboard renders a hole as an observed zero, which is the failure mode the coverage floors exist
 * to prevent (coverageFloors.ts).
 *
 * The rule is not "stop at the first unanswered day". Days before the source began publishing are
 * unanswerable and always come first; stopping there would mean never checkpointing anything.
 * Coverage begins at the first ANSWERED day, and stops at the first unanswered day after it.
 */
export type DayAnswer = "answered" | "unanswered";

/**
 * The first day coverage must NOT include, or null when every day from the first answered one
 * onwards was answered.
 */
export function coverageCutoffDay(days: readonly string[], answerOf: (day: string) => DayAnswer): string | null {
  let started = false;
  for (const day of days) {
    if (answerOf(day) === "unanswered") {
      if (started) return day;
      continue;
    }
    started = true;
  }
  return null;
}
