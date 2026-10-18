/**
 * Duplicate-read protection for a camera that decodes several times a second.
 *
 * The same code is not rung up again until it has been out of view for
 * `releaseMs` *and* `cooldownMs` has passed since it was last accepted.
 * Holding a pack under the camera therefore adds it once; lifting it away and
 * presenting it again adds another. A different code is admitted at once.
 */

export interface LastRead {
  code: string;
  acceptedAt: number;
  seenAt: number;
}

export interface ScanGateTiming {
  cooldownMs: number;
  releaseMs: number;
}

/**
 * Whether `code` read at `now` counts as a new scan. Records the sighting on
 * `last` either way, so a code held steadily in view keeps itself locked.
 */
export function admitRead(last: LastRead | null, code: string, now: number, timing: ScanGateTiming): boolean {
  if (!last || last.code !== code) return true;

  const leftView = now - last.seenAt >= timing.releaseMs;
  const cooledDown = now - last.acceptedAt >= timing.cooldownMs;
  last.seenAt = now;
  return leftView && cooledDown;
}
