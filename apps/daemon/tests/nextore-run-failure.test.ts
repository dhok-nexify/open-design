import { describe, expect, it } from 'vitest';

import { classifyNextoreRunFailure } from '../src/nextore-run-failure.js';

describe('classifyNextoreRunFailure', () => {
  it('maps an expired key to a sign-in prompt', () => {
    expect(classifyNextoreRunFailure({ errorCode: 'invalid_api_key' })).toMatchObject({
      code: 'nextore_session_expired',
    });
  });

  it('maps DesignerAccess failures', () => {
    expect(classifyNextoreRunFailure({ error: '403 designer_access_required' })).toMatchObject({
      code: 'nextore_access_denied',
    });
  });

  it('maps an unconfigured tier to the model mapping hint', () => {
    expect(classifyNextoreRunFailure({
      error: "The model 'expert' does not exist or is not configured.",
    })).toMatchObject({ code: 'nextore_model_unavailable' });
  });

  it('maps quota and rate limits', () => {
    expect(classifyNextoreRunFailure({ errorCode: 'insufficient_quota' })).toMatchObject({
      code: 'nextore_quota_exceeded',
    });
    expect(classifyNextoreRunFailure({ error: 'HTTP 429 too many requests' })).toMatchObject({
      code: 'nextore_quota_exceeded',
    });
  });

  it('maps guardrail refusals', () => {
    expect(classifyNextoreRunFailure({ error: 'blocked by guardrail' })).toMatchObject({
      code: 'nextore_content_refused',
    });
  });

  it('prefers a policy refusal over the status code it arrived with', () => {
    expect(classifyNextoreRunFailure({ error: '400 guardrail: content policy' })).toMatchObject({
      code: 'nextore_content_refused',
    });
  });

  it('leaves unknown failures alone', () => {
    expect(classifyNextoreRunFailure({ error: 'process exited with code 1' })).toBeNull();
    expect(classifyNextoreRunFailure({})).toBeNull();
  });
});
