export type BucketPhase = 'past' | 'current' | 'future';

/**
 * Which buckets of a period are history, which one is in progress, and which
 * are still to come, given each bucket's start time.
 *
 * Only a period still running has a current bucket: "yesterday" or "last
 * month" are all history. A bucket's end is estimated from the spacing of the
 * two before it, which is close enough to tell "now" apart from "after the
 * period" even across months of uneven length.
 */
export function bucketPhases(starts: string[], now: Date): { phases: BucketPhase[]; currentIndex: number } {
  const nowMs = now.getTime();
  const times = starts.map((start) => new Date(start).getTime());
  const elapsed = times.filter((time) => time <= nowMs).length;

  const last = elapsed - 1;
  const width = elapsed >= 2 ? times[last] - times[last - 1] : Number.POSITIVE_INFINITY;
  const currentIndex = elapsed > 0 && nowMs < times[last] + width ? last : -1;

  return {
    phases: times.map((_, index) => (index === currentIndex ? 'current' : index < elapsed ? 'past' : 'future')),
    currentIndex,
  };
}
