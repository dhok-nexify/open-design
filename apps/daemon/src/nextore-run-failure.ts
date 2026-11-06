export type NextoreFailureCode =
  | 'nextore_session_expired'
  | 'nextore_access_denied'
  | 'nextore_model_unavailable'
  | 'nextore_quota_exceeded'
  | 'nextore_content_refused';

export interface NextoreFailure {
  code: NextoreFailureCode;
  message: string;
}

/**
 * Turns a NexTore/provider failure into one actionable sentence (NXD-D16).
 *
 * The agent surfaces the module's OpenAI-shaped errors verbatim, which leaves
 * the user with "400 invalid_request_error" and no idea what to do. The
 * classification is deliberately conservative: only signatures the module is
 * known to emit are rewritten, everything else keeps the original text.
 */
export function classifyNextoreRunFailure(input: {
  error?: string | null;
  errorCode?: string | null;
}): NextoreFailure | null {
  const haystack = (String(input.errorCode ?? '') + ' ' + String(input.error ?? '')).toLowerCase();
  if (!haystack.trim()) return null;

  const has = (...needles: string[]) => needles.some((needle) => haystack.includes(needle));

  if (has('guardrail', 'content_policy', 'content policy', 'safety_violation')) {
    return {
      code: 'nextore_content_refused',
      message: 'The model refused this request on policy grounds. Rephrase it and try again.',
    };
  }
  if (has('invalid_api_key', 'unauthenticated', 'unauthorized', '401')) {
    return {
      code: 'nextore_session_expired',
      message: 'Your NexTore session is no longer valid. Sign in again and retry.',
    };
  }
  if (has('designer_access_required', 'permission_error', 'forbidden', '403')) {
    return {
      code: 'nextore_access_denied',
      message: 'You do not have permission to use Designer for this project.',
    };
  }
  if (has('model_not_found', 'model is not configured', 'does not exist or is not configured')) {
    return {
      code: 'nextore_model_unavailable',
      message:
        'The configured model is not available. Ask an administrator to check the Fast/Expert model mapping.',
    };
  }
  if (has('insufficient_quota', 'quota', 'rate limit', 'too many requests', '429')) {
    return {
      code: 'nextore_quota_exceeded',
      message:
        'NexTore reports the model quota is exhausted. Retry later or ask an administrator to raise it.',
    };
  }
  return null;
}
