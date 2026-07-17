/**
 * Price-alert crossing logic (SPEC §13), pure for unit testing.
 *
 * An alert fires only when the price CROSSES the threshold into the alerted
 * direction — never repeatedly while it stays there, never on first sight
 * (no prior state = nothing to cross), and never inside the cooldown window.
 */

export type ThresholdState = "above" | "below";

export const ALERT_COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20 h — at most ~1/day

export interface AlertEvaluationInput {
  targetMinor: number;
  direction: ThresholdState;
  currentMinor: number | null;
  priorState: ThresholdState | null;
  lastAlertedAt: number | null;
  now: number;
}

export interface AlertEvaluationResult {
  /** New prior_threshold_state to persist (null = price unavailable, keep old). */
  newState: ThresholdState | null;
  shouldTrigger: boolean;
}

export function evaluateAlert(input: AlertEvaluationInput): AlertEvaluationResult {
  if (input.currentMinor === null) {
    // Unavailable price: no state change, no alert (graceful — SPEC §13).
    return { newState: null, shouldTrigger: false };
  }

  const state: ThresholdState = input.currentMinor >= input.targetMinor ? "above" : "below";
  const crossed = input.priorState !== null && input.priorState !== state;
  const inDirection = state === input.direction;
  const cooledDown =
    input.lastAlertedAt === null || input.now - input.lastAlertedAt >= ALERT_COOLDOWN_MS;

  return {
    newState: state,
    shouldTrigger: crossed && inDirection && cooledDown,
  };
}
