import type { Edition } from '@open-design/contracts';

import { BYOK_OPENCODE_AGENT_ID } from '../runtimes/byok-opencode.js';

/**
 * How the edition constrains the agent chosen for a run.
 *
 * - `null` — upstream: the request and the detection fallback decide.
 * - `{ agentId }` — the run must use this id (the NexTore edition has exactly
 *   one execution path, the daemon-owned BYOK OpenCode runtime).
 * - `{ reject }` — the caller named a runtime this edition does not ship;
 *   answering 400 is better than silently running a different one, because the
 *   client would otherwise believe its chosen agent executed the task.
 */
export type EditionAgentGate =
  | null
  | { agentId: string }
  | { reject: string };

export function editionAgentGate(
  edition: Edition,
  requested: string | null | undefined,
): EditionAgentGate {
  if (edition !== 'nextore') return null;
  const trimmed = requested?.trim();
  if (trimmed && trimmed !== BYOK_OPENCODE_AGENT_ID) return { reject: trimmed };
  return { agentId: BYOK_OPENCODE_AGENT_ID };
}
