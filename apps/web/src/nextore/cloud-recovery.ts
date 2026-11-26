import { isFeatureEnabled } from './features';

/**
 * Which Cloud recovery actions the run error card may offer.
 *
 * The NexTore edition has no OpenDesign Cloud account: no wallet, no cloud
 * runtime, no plan. Offering "switch to <brand> Cloud" there is not merely
 * useless - it sends the user to a settings surface this edition does not have.
 * Keeping the rule here means the card and its test read the same policy.
 */
export interface CloudRecoveryInput {
  /** Agent that produced the failed assistant message, when known. */
  failedAgentId: string | null | undefined;
  /** A retry handler exists for this failure. */
  hasRetry: boolean;
  /** A switch-to-cloud handler or settings entry point exists. */
  hasSwitchTarget: boolean;
}

export interface CloudRecoveryActions {
  /** Retry on the cloud runtime (the failed run already used it). */
  cloudRetry: boolean;
  /** Hand the turn over to the cloud runtime. */
  switchToCloud: boolean;
}

export function resolveCloudRecoveryActions(input: CloudRecoveryInput): CloudRecoveryActions {
  if (!isFeatureEnabled('cloud-amr')) return { cloudRetry: false, switchToCloud: false };
  const failedRunUsesCloud = input.failedAgentId === 'amr';
  return {
    cloudRetry: failedRunUsesCloud && input.hasRetry,
    switchToCloud: !failedRunUsesCloud && input.hasSwitchTarget,
  };
}
