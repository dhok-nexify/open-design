/**
 * P05 comment notification trigger (daemon side).
 *
 * The module owns recipient resolution, channel selection and the deep link
 * template. The daemon signs the typed payload when a service secret is
 * configured; otherwise it falls back to the author's stored member session.
 * A notification failure never affects the comment write.
 */

import {
  canonicalNotificationFields,
  encodeServiceField,
  notificationHeaders,
  stableNotificationEventId,
} from './notification-auth.js';

export interface CommentNoticeInput {
  /** The local Designer project id used by the deep link. */
  projectId: string;
  /** The NexTore project id the module route and existence check use. */
  nextoreProjectId?: string | null;
  commentId: string;
  authorMemberId: number;
  isReply: boolean;
  projectName?: string | null;
  /** Comment body, quoted in the email excerpt. Truncated before sending. */
  commentText?: string | null;
  /** ISO-8601 creation time for the email's timestamp line. */
  createdAt?: string | null;
  /** Owner + CanManage candidates, already resolved by the caller. */
  recipientIds: readonly number[];
}

export interface CommentNoticePayload {
  projectId: string;
  commentId: string;
  authorMemberId: number;
  isReply: boolean;
  projectName: string | null;
  /** Empty string when the daemon has no body to quote. */
  commentText: string;
  /** ISO-8601, or null when unknown. */
  createdAt: string | null;
  recipientIds: number[];
  idempotencyKey: string;
}

/** The email quotes at most this many characters; the module renders what it gets. */
const MAX_NOTICE_TEXT = 1000;

export type CommentNoticeOutcome = 'sent' | 'skipped' | 'failed';

/** Distinct positive ids with the author removed; order preserved. */
export function resolveCommentRecipients(
  candidates: readonly number[],
  authorMemberId: number,
): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of candidates) {
    if (!Number.isInteger(id) || id <= 0 || id === authorMemberId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function buildCommentNoticePayload(input: CommentNoticeInput): CommentNoticePayload {
  return {
    projectId: input.projectId,
    commentId: input.commentId,
    authorMemberId: input.authorMemberId,
    isReply: input.isReply === true,
    projectName: input.projectName?.trim() || null,
    commentText: (input.commentText ?? '').trim().slice(0, MAX_NOTICE_TEXT),
    createdAt: input.createdAt?.trim() || null,
    recipientIds: resolveCommentRecipients(input.recipientIds, input.authorMemberId),
    // One comment can only ever produce one notification, however many times a
    // retry runs; the module treats this key as the dedupe identity.
    idempotencyKey: input.projectId + ':' + input.commentId,
  };
}

/** Signed field list must match DesignerCommentNotificationController.Canonical exactly. */
export function commentCanonicalBody(
  eventId: string,
  nextoreProjectId: string,
  payload: CommentNoticePayload,
): string {
  return canonicalNotificationFields([
    ['event_id', encodeServiceField(eventId)],
    ['project_id', encodeServiceField(payload.projectId)],
    ['nextore_project_id', encodeServiceField(nextoreProjectId)],
    ['comment_id', encodeServiceField(payload.commentId)],
    ['author_member_id', encodeServiceField(payload.authorMemberId)],
    ['is_reply', encodeServiceField(payload.isReply)],
    ['project_name', encodeServiceField(payload.projectName)],
    ['comment_text', encodeServiceField(payload.commentText)],
    ['created_at', encodeServiceField(payload.createdAt)],
    ['recipient_ids', encodeServiceField(payload.recipientIds.join(','))],
    ['idempotency_key', encodeServiceField(payload.idempotencyKey)],
  ]);
}

export interface CommentNotifyDeps {
  /** Absolute module base URL incl. any path prefix, or null when unconfigured. */
  moduleBaseUrl: string | null;
  /** Shared HMAC secret for service-to-module calls. Unset keeps the session fallback. */
  notificationSecret?: string | null;
  /** Clock seam for deterministic signature tests. */
  now?: () => number;
  /**
   * Resolve the author's module credential from the daemon's own member session
   * store. There is deliberately no request-token variant: a notification is a
   * system action, so it must not adopt the bearer credential that arrived on
   * the HTTP request. Returning null means "skip", never "send anonymously".
   */
  resolveMemberToken: (memberId: number) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

/**
 * Fire one notification request. Returns 'skipped' when there is nothing to do
 * (no module, no token, no recipients, or the module answered 204) and never
 * throws: the caller has already committed the comment.
 */
export async function notifyComment(
  deps: CommentNotifyDeps,
  input: CommentNoticeInput,
): Promise<CommentNoticeOutcome> {
  const payload = buildCommentNoticePayload(input);
  if (!deps.moduleBaseUrl) return 'skipped';
  const authorMemberId = Number.isInteger(input.authorMemberId) ? input.authorMemberId : 0;
  if (authorMemberId <= 0) {
    deps.log?.('[comment-notify] no author member; skipping');
    return 'skipped';
  }
  if (payload.recipientIds.length === 0) {
    // The module is the permission authority and resolves CanManage itself when
    // the payload lists nobody, so an empty list must still reach it.
    deps.log?.('[comment-notify] empty recipients; asking the module to resolve');
  }
  // The module route is keyed by the NexTore project id; the local Designer id
  // travels in the body so the notice links back to the project the person uses.
  const nextoreProjectId = typeof input.nextoreProjectId === 'string'
    ? input.nextoreProjectId.trim()
    : '';
  if (!/^\d+$/.test(nextoreProjectId)) return 'skipped';

  try {
    const secret = deps.notificationSecret?.trim() || null;
    const token = secret ? null : await deps.resolveMemberToken(authorMemberId);
    if (!secret && !token) {
      deps.log?.('[comment-notify] no stored member session member=' + authorMemberId + '; skipping');
      return 'skipped';
    }
    const eventId = stableNotificationEventId('cmt_', payload.idempotencyKey);
    const canonical = commentCanonicalBody(eventId, nextoreProjectId, payload);
    const headers: Record<string, string> = secret
      ? { 'content-type': 'application/json', accept: 'application/json',
          ...notificationHeaders(secret, eventId, canonical, (deps.now ?? Date.now)()) }
      : { 'content-type': 'application/json', accept: 'application/json', APIkey: token! };
    const fetchImpl = deps.fetchImpl ?? fetch;
    const response = await fetchImpl(
      deps.moduleBaseUrl.replace(/\/+$/, '')
        + '/api/designer/projects/' + encodeURIComponent(nextoreProjectId)
        + '/comment-notifications',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        // The APIkey must never be forwarded to another origin by a redirect,
        // and a hung module must not keep the request (and its token) alive.
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (response.status === 204) {
      // Legacy module build: accepted without a receipt.
      deps.log?.('[comment-notify] module accepted (204)');
      return 'skipped';
    }
    if (response.status === 202) {
      deps.log?.('[comment-notify] module accepted (202)');
      return 'sent';
    }
    if (!response.ok) {
      // The module's own code is what makes the next log readable; the body is
      // bounded and never contains a credential.
      let detail = '';
      try {
        const text = (await response.text()).slice(0, 512);
        const payload = text ? JSON.parse(text) as { error?: unknown; message?: unknown } : null;
        const code = typeof payload?.error === 'string' ? payload.error : '';
        const message = typeof payload?.message === 'string' ? payload.message : '';
        detail = [code, message].filter(Boolean).join(' ');
        if (!detail && text) detail = text;
      } catch {
        detail = '';
      }
      deps.log?.('[comment-notify] module rejected: ' + response.status
        + (detail ? ' ' + detail : ''));
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    deps.log?.('[comment-notify] send failed: '
      + (error instanceof Error ? error.message : String(error)));
    return 'failed';
  }
}

/**
 * Never-throwing wrapper used by the comment route.
 *
 * The route only needs "did we try"; a notification failure must not surface
 * as an HTTP error after the comment was already written.
 */
export async function notifyCommentSafely(
  deps: CommentNotifyDeps,
  input: CommentNoticeInput,
): Promise<CommentNoticeOutcome> {
  try {
    return await notifyComment(deps, input);
  } catch {
    return 'failed';
  }
}
