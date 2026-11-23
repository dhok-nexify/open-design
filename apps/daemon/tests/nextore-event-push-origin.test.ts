import { describe, expect, it } from 'vitest';

import { isNextoreEventPushRequest } from '../src/nextore/host-access.js';

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    baseUrl: '/api',
    path: '/nextore/events',
    ...overrides,
  } as never;
}

describe('P03 event push auth-gate exception', () => {
  it('allows only the exact signed event-push route through the browser origin gate', () => {
    expect(isNextoreEventPushRequest(request())).toBe(true);
    expect(isNextoreEventPushRequest(request({ method: 'GET' }))).toBe(false);
    expect(isNextoreEventPushRequest(request({ path: '/nextore/events/other' }))).toBe(false);
    expect(isNextoreEventPushRequest(request({ baseUrl: '/artifacts' }))).toBe(false);
  });
});
