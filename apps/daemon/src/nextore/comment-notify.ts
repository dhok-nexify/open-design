/**
 * P05 comment notification trigger (daemon side).
 *
 * The module owns delivery, dedupe (1 minute per project/member), channel
 * selection and the deep link template. The daemon only decides *whether* to
 * ask and never lets a notification failure affect the comment write.
 */

export interface CommentNoticeInput {
  projectId: string;
  commentId: string;
  authorMemberId: number;
  isReply: boolean;
  projectName?: string | null;
  /** Owner + CanManage candidates, already resolved by the caller. */
  recipientIds: readonly number[];
}

export interface CommentNoticePayload {
  commentId: string;
  authorMemberId: number;
  isReply: boolean;
  projectName: string | null;
  recipientIds: number[];
  idempotencyKey: string;
}

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
    commentId: input.commentId,
    authorMemberId: input.authorMemberId,
    isReply: input.isReply === true,
    projectName: input.projectName?.trim() || null,
    recipientIds: resolveCommentRecipients(input.recipientIds, input.authorMemberId),
    // One comment can only ever produce one notification, however many times a
    // retry runs; the module treats this key as the dedupe identity.
    idempotencyKey: input.projectId + ':' + input.commentId,
  };
}

export interface CommentNotifyDeps {
  /** Absolute module base URL incl. any path prefix, or null when unconfigured. */
  moduleBaseUrl: string | null;
  accessToken: () => Promise<string | null>;
  /**
   * Fallback used when the request itself carried no session token (e.g. a
   * background or API-token call): resolve the author's module token from the
   * session store. Returning null means "skip", never "send anonymously".
   */
  resolveMemberToken?: (memberId: number) => Promise<string | null>;
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
  if (payload.recipientIds.length === 0) return 'skipped';

  try {
    let token = await deps.accessToken();
    if (!token && deps.resolveMemberToken && Number.isInteger(input.authorMemberId) && input.authorMemberId > 0) {
      token = await deps.resolveMemberToken(input.authorMemberId);
    }
    if (!token) {
      deps.log?.('[comment-notify] no access token; skipping');
      return 'skipped';
    }
    const fetchImpl = deps.fetchImpl ?? fetch;
    const response = await fetchImpl(
      deps.moduleBaseUrl.replace(/\/+$/, '')
        + '/api/designer/projects/' + encodeURIComponent(input.projectId)
        + '/comment-notifications',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          APIkey: token,
        },
        body: JSON.stringify(payload),
      },
    );
    if (response.status === 204) return 'skipped';
    if (!response.ok) {
      deps.log?.('[comment-notify] module rejected: ' + response.status);
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    deps.log?.('[comment-notify] send failed: '
      + (error instanceof Error ? error.message : String(error)));
    return 'failed';
  }
}
