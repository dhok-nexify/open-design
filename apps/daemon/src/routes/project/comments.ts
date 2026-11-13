import type { Express, Request } from 'express';
import type {
  PreviewComment,
  WorkspaceCollabContext,
} from '@open-design/contracts';
import { projectKindFromMetadataToTrackingOrLegacyDefault } from '@open-design/contracts/analytics';
import type { RouteDeps } from '../../server-context.js';
import type { BoundWorkspaceResourceMutationGate } from '../../collab/workspace-resource-mutation.js';
import type {
  AuthorizeProjectRequest,
  AuthorizeProjectRequestOptions,
} from '../../collab/project-request-authority.js';
import { getProject, isProjectCommentAnchorConversationId } from '../../db.js';

/**
 * The signed-in NexTore member id the edition gate attached to this request
 * (NXD-D22), or null off the edition. Comment authorship reads this instead of
 * the workspace identity, which the edition never has: members sign in through
 * NexTore, not through the collab workspace.
 */
function nextoreMemberIdOf(res: unknown): number | null {
  const session = (res as { locals?: { nextoreSession?: { memberId?: unknown } } })
    .locals?.nextoreSession;
  const id = session?.memberId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

export type ProjectCommentWorkspaceContextResolution =
  | { ok: true; context: WorkspaceCollabContext | null }
  | {
      ok: false;
      status: 400 | 401 | 403 | 503;
      code: string;
      message: string;
      retryable?: true;
    };

export interface RegisterProjectCommentRoutesDeps extends RouteDeps<'db' | 'projectStore' | 'conversations'> {
  /** Optional in focused CRUD fixtures; production supplies request-scoped analytics. */
  telemetry?: RouteDeps<'telemetry'>['telemetry'];
  /**
   * Gate POST (create/edit)/PATCH status/DELETE on the caller's WORKSPACE
   * identity, before the author-identity logic below ever runs (spec 04 §10
   * fix #4/#6 — recvqbklNGDqYY: a comment had zero `enforceWorkspace*`
   * coverage, the one fully-unguarded write path among the four resource
   * types). A comment has no workspace binding of its own, so this borrows
   * the PARENT PROJECT's binding via `getWorkspaceProject`/
   * `getWorkspaceProjectByProjectId` (both already available on
   * `ctx.projectStore`) — the same instance `routes/project/index.ts` built
   * for its own project routes (cross-check against the daemon's own
   * last-known membership included), threaded down through
   * `registerProjectConversationRoutes` rather than re-derived here.
   *
   * Optional, and a no-op when omitted, so fixtures that only exercise
   * comment CRUD semantics (most of this file's existing tests, which use
   * plain non-workspace-bound projects) keep compiling and behaving exactly
   * as before — an unbound project's comments were never gated either way,
   * since `enforceWorkspaceResourceMutation` itself passes a `row === null`
   * lookup straight through regardless of ctx.
   */
  enforceWorkspaceProjectMutation?: BoundWorkspaceResourceMutationGate;
  /** Paired with `enforceWorkspaceProjectMutation` above — see that field. */
  sendApiError?: (res: any, status: number, code: string, message: string) => unknown;
  /**
   * Resolve and authorize the PERSISTED project's Workspace scope. Production
   * wiring verifies request headers against the membership directory and then
   * checks that the resulting workspace id matches the project's binding.
   * Directory failure is returned as a typed error and must fail closed before
   * any local mutation or relay call.
   */
  resolveWorkspaceContext?: (
    req: Request,
    projectId: string,
  ) => Promise<ProjectCommentWorkspaceContextResolution>;
  /**
   * Bounded successful authority lease for pure comment-list reads. Production
   * uses the same cached verifier as other project GET routes. Comment
   * mutations continue to use `resolveWorkspaceContext` above, which is fresh
   * and fail-closed on every write.
   */
  resolveReadWorkspaceContext?: (
    req: Request,
    projectId: string,
  ) => Promise<ProjectCommentWorkspaceContextResolution>;
  /**
   * Fresh cloud authority used only before pulling remote comment state. Local
   * list/create/edit/delete paths use the persisted project binding and must
   * remain available while the membership directory is offline.
   */
  resolveFreshWorkspaceContext?: (
    req: Request,
    projectId: string,
  ) => Promise<ProjectCommentWorkspaceContextResolution>;
  /**
   * Resolve the CURRENT caller's workspaceMemberId from the request identity
   * (workspace context). Server-authoritative — used both to stamp the author on
   * a new/edited comment and to gate status/delete on the caller's identity.
   * Optional: off-team it returns undefined and comments are stored without an
   * author and no permission gating applies.
   */
  resolveAuthorMemberId?: (authorization: string | undefined) => Promise<string | undefined>;
  /**
   * Resolve a shared project's OWNER workspaceMemberId (server-authoritative,
   * from the team hub). Used to let the project owner delete / send-to-agent on
   * another member's comment. Null off-team / when the project is not shared.
   */
  resolveProjectOwnerMemberId?: (
    projectId: string,
    context?: WorkspaceCollabContext | null,
  ) => Promise<string | null>;
  /**
   * Server-authoritative shared-project test. Legacy comments without an
   * author remain mutable in personal/unshared projects, but in a shared
   * project they are owner-only. Resolution failure must deny rather than
   * degrading open.
   */
  isSharedProject?: (
    projectId: string,
    context?: WorkspaceCollabContext | null,
  ) => Promise<boolean>;
  /**
   * Project-level authority used for the send-to-agent transition (NXD-D22):
   * handing a note to the agent starts a run against the project, so it needs
   * project edit rights rather than authorship alone. Optional so comment-CRUD
   * fixtures keep compiling; production threads the NexTore-aware authorizer
   * from the conversations context (a no-op off the edition).
   */
  authorizeProjectRequest?: AuthorizeProjectRequest;
  /** Whether the caller holds CanManage on this project (NXD-D22 manager edits). */
  resolveProjectCanManage?: (
    req: Request,
    res: unknown,
    projectId: string,
  ) => Promise<boolean>;
  /**
   * Fired after a comment is created OR edited (body upsert), so the collab-cloud
   * service can push it to the cross-daemon relay (best-effort — a push failure
   * must not fail the local save). No-op off-team / when the collab cloud is
   * unconfigured.
   */
  onCommentCreated?: (
    comment: PreviewComment,
    context: WorkspaceCollabContext | null,
  ) => boolean | void;
  /**
   * Fired after a comment's status changes (the send-to-agent lifecycle), so the
   * new status propagates to other members. Best-effort.
   */
  onCommentUpdated?: (
    comment: PreviewComment,
    context: WorkspaceCollabContext | null,
  ) => boolean | void;
  /**
   * Fired after a comment is deleted, with the comment as it last existed, so a
   * tombstone can be pushed to the relay. Best-effort.
   */
  onCommentDeleted?: (
    comment: PreviewComment,
    context: WorkspaceCollabContext | null,
  ) => boolean | void;
  /**
   * Fired when the comment list is read. The hub push channel marks closed
   * projects comment-dirty instead of pulling eagerly; the first read after
   * opening consumes that mark and awaits an immediate cloud pull before the
   * list is serialized, so an opened project catches up in its first response
   * instead of requiring a second read after the next poll tick.
   */
  onCommentsRead?: (
    projectId: string,
    context: WorkspaceCollabContext | null,
    resolveFreshWorkspaceContext: () => Promise<ProjectCommentWorkspaceContextResolution>,
  ) => Promise<void> | void;
}

export function registerProjectCommentRoutes(app: Express, ctx: RegisterProjectCommentRoutesDeps): void {
  const { db } = ctx;
  const { updateProject, getWorkspaceProject, getWorkspaceProjectByProjectId } = ctx.projectStore;
  const {
    getConversation,
    listPreviewComments,
    listProjectPreviewComments,
    upsertPreviewComment,
    getPreviewComment,
    getProjectPreviewComment,
    updatePreviewCommentStatus,
    updatePreviewCommentAnchor,
    deletePreviewComment,
    reorderPreviewComment,
  } = ctx.conversations;
  const getRoutableConversation = (projectId: string, conversationId: string) => {
    if (isProjectCommentAnchorConversationId(conversationId)) return null;
    const conversation = getConversation(db, conversationId);
    return conversation?.projectId === projectId ? conversation : null;
  };

  /**
   * Resolve the conversation a project-scoped comment belongs to. Readers
   * cannot list conversations, so the project-level comment route either
   * honours an explicit id from the client or falls back to the newest
   * routable conversation the project owns.
   */
  const resolveProjectCommentConversationId = (
    projectId: string,
    requested: string,
  ): string | null => {
    if (requested) {
      return getRoutableConversation(projectId, requested) ? requested : null;
    }
    const rows = db.prepare(
      `SELECT id FROM conversations WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC`,
    ).all(projectId) as Array<{ id?: unknown }>;
    for (const row of rows) {
      if (typeof row.id === 'string' && getRoutableConversation(projectId, row.id)) {
        return row.id;
      }
    }
    return null;
  };

  function commentsAreProjectScoped(
    projectId: string,
    context: WorkspaceCollabContext | null,
  ): boolean {
    if (typeof getWorkspaceProjectByProjectId !== 'function') return false;
    const binding = getWorkspaceProjectByProjectId(db, projectId) as {
      workspaceId?: string;
      visibility?: string;
      resourceState?: string;
    } | undefined;
    if (
      !binding
      || binding.visibility !== 'team'
      || binding.resourceState === 'deleted'
    ) {
      return false;
    }
    if ((ctx.resolveReadWorkspaceContext || ctx.resolveWorkspaceContext) && !context) {
      return false;
    }
    // The null case preserves narrow local fixtures that deliberately omit
    // Workspace auth; production requires an exact context match.
    return !context || binding.workspaceId === context.workspaceId;
  }

  function getRequestPreviewComment(
    projectId: string,
    conversationId: string,
    commentId: string,
    context: WorkspaceCollabContext | null,
  ): PreviewComment | null {
    return (commentsAreProjectScoped(projectId, context)
      && typeof getProjectPreviewComment === 'function'
      ? getProjectPreviewComment(db, projectId, commentId)
      : getPreviewComment(db, projectId, conversationId, commentId)) as PreviewComment | null;
  }

  /**
   * Workspace-identity gate for a comment mutation, borrowing the PARENT
   * PROJECT's binding (see `enforceWorkspaceProjectMutation` on
   * `RegisterProjectCommentRoutesDeps` above). Writes the 401/403 response
   * itself and returns false when denied — callers return immediately on
   * `false` without running their own author-identity logic. A no-op (always
   * allows) when the gate wasn't wired up, matching how an unbound project's
   * comments behaved before this fix existed either way.
   */
  async function enforceCommentWorkspaceMutation(
    req: Request,
    res: any,
    projectId: string,
  ): Promise<boolean> {
    if (!ctx.enforceWorkspaceProjectMutation || !ctx.sendApiError) return true;
    return ctx.enforceWorkspaceProjectMutation(
      req,
      res,
      ctx.sendApiError,
      getWorkspaceProject,
      getWorkspaceProjectByProjectId,
      db,
      projectId,
      // NOT `writeFiles`: a comment is not an artifact edit. Sharing a
      // project into the team grants every active member comment standing
      // (the read-only banner promises "view and comment"), so this gate
      // checks the wider `comment` capability; author-level rules
      // (`callerMayMutate` below) still restrict status/delete per comment.
      'comment',
    );
  }

  async function resolveRequestWorkspaceContext(
    req: Request,
    projectId: string,
  ): Promise<ProjectCommentWorkspaceContextResolution> {
    if (!ctx.resolveWorkspaceContext) return { ok: true, context: null };
    try {
      return await ctx.resolveWorkspaceContext(req, projectId);
    } catch {
      return {
        ok: false,
        status: 503,
        code: 'WORKSPACE_AUTHORITY_UNAVAILABLE',
        message: 'workspace membership authority is temporarily unavailable',
        retryable: true,
      };
    }
  }

  async function resolveReadRequestWorkspaceContext(
    req: Request,
    projectId: string,
  ): Promise<ProjectCommentWorkspaceContextResolution> {
    if (!ctx.resolveReadWorkspaceContext) {
      return resolveRequestWorkspaceContext(req, projectId);
    }
    try {
      return await ctx.resolveReadWorkspaceContext(req, projectId);
    } catch {
      return {
        ok: false,
        status: 503,
        code: 'WORKSPACE_AUTHORITY_UNAVAILABLE',
        message: 'workspace membership authority is temporarily unavailable',
        retryable: true,
      };
    }
  }

  function sendWorkspaceResolutionError(
    res: any,
    resolution: Extract<ProjectCommentWorkspaceContextResolution, { ok: false }>,
  ): unknown {
    if (ctx.sendApiError) {
      return ctx.sendApiError(
        res,
        resolution.status,
        resolution.code,
        resolution.message,
      );
    }
    return res.status(resolution.status).json({
      error: resolution.code,
      message: resolution.message,
      ...(resolution.retryable ? { retryable: true } : {}),
    });
  }

  /** The caller's workspaceMemberId, or undefined off-team / personal mode. */
  async function resolveCaller(
    req: Request,
    context: WorkspaceCollabContext | null,
  ): Promise<string | undefined> {
    if (ctx.resolveWorkspaceContext) {
      return context?.workspaceMemberId || undefined;
    }
    if (!ctx.resolveAuthorMemberId) return undefined;
    return ctx.resolveAuthorMemberId(req.headers.authorization);
  }

  function isLocalTeamRelayCandidate(
    projectId: string,
    context: WorkspaceCollabContext | null,
    callbackConfigured: boolean,
  ): boolean {
    if (!ctx.resolveWorkspaceContext) return callbackConfigured;
    if (
      !callbackConfigured
      || !context
      || context.workspaceType !== 'team'
      || context.memberStatus !== 'active'
      || context.lifecycleState === 'deleted'
    ) return false;
    const binding = getWorkspaceProjectByProjectId(db, projectId);
    return Boolean(
      binding
      && binding.workspaceId === context.workspaceId
      && binding.visibility === 'team'
      && binding.resourceState !== 'deleted',
    );
  }

  function requireRelayEnqueued(result: boolean | void): void {
    if (result === false) {
      throw new Error('failed to persist Team comment relay delivery');
    }
  }

  /**
   * Server-authoritative permission gate for status change + delete. Both are
   * allowed for the comment's author and the project owner (owner drives
   * send-to-agent and may delete any comment). Degrades open only when the
   * comment itself has no author (legacy/personal comments). Authored shared
   * comments fail closed if the current caller cannot be resolved.
   */
  async function callerMayMutate(
    req: Request,
    res: unknown,
    projectId: string,
    comment: PreviewComment,
    context: WorkspaceCollabContext | null,
  ): Promise<boolean> {
    // NEXTORE (NXD-D22): an edition comment belongs to exactly one NexTore
    // member, so only that member may change or delete it. Project rights are
    // enforced separately on the project routes; this is the per-comment half,
    // and it fails closed when the session cannot be read.
    const nextoreAuthor = comment.authorNextoreMemberId;
    if (typeof nextoreAuthor === 'number') {
      const caller = nextoreMemberIdOf(res);
      if (caller !== null && caller === nextoreAuthor) return true;
      return ctx.resolveProjectCanManage
        ? ctx.resolveProjectCanManage(req, res, projectId)
        : false;
    }
    const author = comment.authorMemberId;
    if (!author) {
      if (!ctx.isSharedProject) return true;
      let shared: boolean;
      try {
        shared = await ctx.isSharedProject(projectId, context);
      } catch {
        return false;
      }
      if (!shared) return true;
    }
    let me: string | undefined;
    try {
      me = await resolveCaller(req, context);
    } catch {
      return false;
    }
    if (!me) return false;
    if (author && me === author) return true;
    if (ctx.resolveProjectOwnerMemberId) {
      try {
        const owner = await ctx.resolveProjectOwnerMemberId(projectId, context);
        if (owner && owner === me) return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // ---- Preview comments ----------------------------------------------------

  /**
   * The project ACL gate for comment traffic (NXD-D07). A comment has no
   * workspace binding of its own in the edition, so without this the routes
   * answered for any project id the caller could name. Reading notes is a
   * plain project read and writing one is the `comment` right — a reader may
   * annotate — while handing a note to the agent still needs CanEdit (below).
   * Optional, so storage-only comment-CRUD fixtures keep working unchanged.
   */
  async function allowCommentAction(
    req: Request,
    res: any,
    projectId: string,
    options: AuthorizeProjectRequestOptions,
  ): Promise<boolean> {
    if (!ctx.authorizeProjectRequest) return true;
    return ctx.authorizeProjectRequest(req, res, projectId, options);
  }

  app.get('/api/projects/:id/conversations/:cid/comments', async (req, res) => {
    if (!await allowCommentAction(req, res, req.params.id, { mode: 'read' })) return;
    const conv = getRoutableConversation(req.params.id, req.params.cid);
    if (!conv) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    const workspaceResolution = await resolveReadRequestWorkspaceContext(
      req,
      req.params.id,
    );
    if (!workspaceResolution.ok) {
      return sendWorkspaceResolutionError(res, workspaceResolution);
    }
    await ctx.onCommentsRead?.(
      req.params.id,
      workspaceResolution.context,
      () => ctx.resolveFreshWorkspaceContext
        ? ctx.resolveFreshWorkspaceContext(req, req.params.id)
        : resolveRequestWorkspaceContext(req, req.params.id),
    );
    res.json({
      comments: commentsAreProjectScoped(
        req.params.id,
        workspaceResolution.context,
      ) && typeof listProjectPreviewComments === 'function'
        ? listProjectPreviewComments(db, req.params.id)
        : listPreviewComments(db, req.params.id, req.params.cid),
    });
  });

  const upsertConversationComment = async (req: any, res: any) => {
    if (!await allowCommentAction(
      req,
      res,
      req.params.id,
      { mode: 'write', capability: 'comment' },
    )) return;
    const conv = getRoutableConversation(req.params.id, req.params.cid);
    if (!conv) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    if (!await enforceCommentWorkspaceMutation(req, res, req.params.id)) return;
    const workspaceResolution = await resolveRequestWorkspaceContext(
      req,
      req.params.id,
    );
    if (!workspaceResolution.ok) {
      return sendWorkspaceResolutionError(res, workspaceResolution);
    }
    const workspaceContext = workspaceResolution.context;
    try {
      // Server-authoritative author: stamp the current member id so the stored
      // (and pushed) comment carries who wrote it, rather than trusting the body.
      // New comments do not use a natural element key; editing requires an id
      // and is author-only.
      const body = { ...(req.body || {}) };
      // Authorship is server-owned. A client must not be able to leave a
      // forged workspace or NexTore author on the row.
      delete body.authorMemberId;
      delete body.authorNextoreMemberId;
      const authorMemberId = await resolveCaller(req, workspaceContext);
      const nextoreMemberId = nextoreMemberIdOf(res);
      const requestedId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
      let existing: PreviewComment | null = null;
      if (requestedId) {
        existing = getRequestPreviewComment(
          req.params.id,
          req.params.cid,
          requestedId,
          workspaceContext,
        );
        if (!existing) {
          return res.status(404).json({ error: 'comment not found' });
        }
        const existingAuthor = existing.authorMemberId ?? null;
        if (existingAuthor) {
          if (!authorMemberId || existingAuthor !== authorMemberId) {
            return res.status(403).json({ error: 'not permitted' });
          }
          body.authorMemberId = existingAuthor;
        } else if (authorMemberId) {
          body.authorMemberId = authorMemberId;
        }
      } else if (authorMemberId) {
        body.authorMemberId = authorMemberId;
      }
      // NEXTORE (NXD-D22): the edition's author is the NexTore member id, in
      // its own column. Editing is author-only — an existing author is
      // preserved and a mismatched caller is refused; a legacy row with no
      // author is claimed by whoever the session says is editing it.
      const existingNextoreAuthor = existing?.authorNextoreMemberId ?? null;
      if (existingNextoreAuthor !== null) {
        if (nextoreMemberId === null || existingNextoreAuthor !== nextoreMemberId) {
          return res.status(403).json({ error: 'not permitted' });
        }
        body.authorNextoreMemberId = existingNextoreAuthor;
      } else if (nextoreMemberId !== null) {
        body.authorNextoreMemberId = nextoreMemberId;
      }
      // Resolved BEFORE the upsert (not just before the push below) so a
      // genuinely new comment's pin_seq starts unconfirmed on a team-shared
      // project — see UpsertPreviewCommentOptions in db.ts. Ignored on the
      // edit branch, so computing it here for an edit-via-POST is harmless.
      const syncEnabled = isLocalTeamRelayCandidate(
        req.params.id,
        workspaceContext,
        Boolean(ctx.onCommentCreated),
      );
      const targetConversationId = requestedId
        ? existing?.conversationId ?? req.params.cid
        : req.params.cid;
      // Local row + durable relay intent commit atomically. Network delivery is
      // still asynchronous, so a Vela outage never delays this transaction.
      const comment = db.transaction(() => {
        const saved = upsertPreviewComment(db, req.params.id, targetConversationId, body, {
          pinPendingCloudConfirm: syncEnabled,
        });
        updateProject(db, req.params.id, {});
        if (saved && syncEnabled) {
          requireRelayEnqueued(ctx.onCommentCreated?.(
            saved as unknown as PreviewComment,
            workspaceContext,
          ));
        }
        return saved;
      })();
      // Only a genuinely new, successfully persisted comment is counted.
      // Edits reuse this POST route with an id and must not inflate creation.
      if (comment && !requestedId) {
        const project = getProject(db, req.params.id);
        const localBinding = typeof getWorkspaceProjectByProjectId === 'function'
          ? getWorkspaceProjectByProjectId(db, req.params.id) as
              | { createdByWorkspaceMemberId?: string | null }
              | undefined
          : undefined;
        let ownerMemberId = localBinding?.createdByWorkspaceMemberId ?? null;
        if (!ownerMemberId && ctx.resolveProjectOwnerMemberId) {
          ownerMemberId = await ctx.resolveProjectOwnerMemberId(
            req.params.id,
            workspaceContext,
          ).catch(() => null);
        }
        const targetProjectRelation =
          authorMemberId && ownerMemberId
            ? authorMemberId === ownerMemberId
              ? 'self'
              : 'other'
            : 'unknown';
        const planId = workspaceContext?.planId?.trim().toLowerCase();
        void ctx.telemetry?.captureProductEvent?.(
          req,
          'project_comment_create_result',
          {
            page_name: 'artifact',
            area: 'comments',
            result: 'success',
            target_project_relation: targetProjectRelation,
            comment_level: 'top_level',
            project_id: req.params.id,
            project_kind: projectKindFromMetadataToTrackingOrLegacyDefault(project?.metadata),
            ...(workspaceContext
              ? {
                  workspace_key: workspaceContext.workspaceId,
                  workspace_type: workspaceContext.workspaceType,
                  workspace_role: workspaceContext.role,
                  workspace_lifecycle: workspaceContext.lifecycleState,
                  billing_state: workspaceContext.billingState,
                  plan_bucket: !planId || planId === 'free' ? 'free' : 'paid',
                  provider_mode: workspaceContext.providerMode,
                  seat_state: workspaceContext.seatSummary.isSeatFull ? 'full' : 'available',
                  $groups: { workspace: workspaceContext.workspaceId },
                }
              : {}),
          },
        );
      }
      res.json({ comment });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || err) });
    }
  };

  app.post('/api/projects/:id/conversations/:cid/comments', upsertConversationComment);

  // Project-scoped comment surface. Read-only NexTore members can annotate a
  // shared project but cannot list its conversations, so their comment panel
  // must not depend on a conversation id supplied by the shell.
  app.get('/api/projects/:id/comments', async (req, res) => {
    if (!await allowCommentAction(req, res, req.params.id, { mode: 'read' })) return;
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    const workspaceResolution = await resolveReadRequestWorkspaceContext(
      req,
      req.params.id,
    );
    if (!workspaceResolution.ok) {
      return sendWorkspaceResolutionError(res, workspaceResolution);
    }
    await ctx.onCommentsRead?.(
      req.params.id,
      workspaceResolution.context,
      () => ctx.resolveFreshWorkspaceContext
        ? ctx.resolveFreshWorkspaceContext(req, req.params.id)
        : resolveRequestWorkspaceContext(req, req.params.id),
    );
    const fallbackConversationId = resolveProjectCommentConversationId(req.params.id, '');
    const comments = typeof listProjectPreviewComments === 'function'
      ? listProjectPreviewComments(db, req.params.id)
      : fallbackConversationId
        ? listPreviewComments(db, req.params.id, fallbackConversationId)
        : [];
    res.json({ comments });
  });

  app.post('/api/projects/:id/comments', async (req, res) => {
    const projectId = req.params.id;
    const requested = typeof req.body?.conversationId === 'string'
      ? req.body.conversationId.trim()
      : '';
    // An edit must stay in the comment's own conversation, even when the
    // project's newest conversation has moved on.
    const existingCommentId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const existingConversationId = existingCommentId
      ? (db.prepare(
          'SELECT conversation_id FROM preview_comments WHERE project_id = ? AND id = ?',
        ).get(projectId, existingCommentId) as { conversation_id?: unknown } | undefined)
          ?.conversation_id
      : null;
    const conversationId =
      typeof existingConversationId === 'string' && existingConversationId
        ? existingConversationId
        : resolveProjectCommentConversationId(projectId, requested);
    if (!conversationId) {
      return res.status(404).json({
        error: { code: 'CONVERSATION_NOT_FOUND', message: 'No conversation is available for this project.' },
      });
    }
    (req.params as Record<string, string>).cid = conversationId;
    return upsertConversationComment(req, res);
  });


  app.patch(
    '/api/projects/:id/conversations/:cid/comments/:commentId',
    async (req, res) => {
      if (!await allowCommentAction(
        req,
        res,
        req.params.id,
        { mode: 'write', capability: 'comment' },
      )) return;
      const conv = getRoutableConversation(req.params.id, req.params.cid);
      if (!conv) {
        return res.status(404).json({ error: 'conversation not found' });
      }
      if (!await enforceCommentWorkspaceMutation(req, res, req.params.id)) return;
      const workspaceResolution = await resolveRequestWorkspaceContext(
        req,
        req.params.id,
      );
      if (!workspaceResolution.ok) {
        return sendWorkspaceResolutionError(res, workspaceResolution);
      }
      const workspaceContext = workspaceResolution.context;
      try {
        const existing = getRequestPreviewComment(
          req.params.id,
          req.params.cid,
          req.params.commentId,
          workspaceContext,
        );
        if (!existing) return res.status(404).json({ error: 'comment not found' });
        // Status change is the send-to-agent lifecycle: allowed for the author
        // and the project owner, blocked for other members.
        if (!(await callerMayMutate(
          req,
          res,
          req.params.id,
          existing,
          workspaceContext,
        ))) {
          return res.status(403).json({ error: 'not permitted' });
        }
        // NEXTORE (NXD-D22): only a member who may edit the project can hand a
        // note to the agent — that transition starts a run against the project.
        if (
          req.body?.status === 'applying'
          && ctx.authorizeProjectRequest
          && !await ctx.authorizeProjectRequest(req, res, req.params.id, {
            mode: 'write',
            capability: 'writeFiles',
          })
        ) return;
        // This route is the status lifecycle only. Without a guard the storage
        // helper rejects a missing status with "invalid comment status", which
        // reads as if the caller sent a bad value when the real mistake is that
        // note edits belong to the POST upsert. Blank counts as missing: an empty
        // string is the same client error, not a status the module forgot to list.
        const requestedStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
        if (!requestedStatus) {
          const message = 'This endpoint changes a comment status; edit the note through the comment upsert.';
          if (ctx.sendApiError) {
            return ctx.sendApiError(res, 400, 'COMMENT_STATUS_REQUIRED', message);
          }
          return res.status(400).json({ error: 'COMMENT_STATUS_REQUIRED', message });
        }
        const syncEnabled = isLocalTeamRelayCandidate(
          req.params.id,
          workspaceContext,
          Boolean(ctx.onCommentUpdated),
        );
        const comment = db.transaction(() => {
          const saved = updatePreviewCommentStatus(
            db,
            req.params.id,
            existing.conversationId,
            req.params.commentId,
            req.body?.status,
          );
          if (!saved) return null;
          updateProject(db, req.params.id, {});
          if (syncEnabled) {
            requireRelayEnqueued(ctx.onCommentUpdated?.(
              saved as unknown as PreviewComment,
              workspaceContext,
            ));
          }
          return saved;
        })();
        if (!comment)
          return res.status(404).json({ error: 'comment not found' });
        res.json({ comment });
      } catch (err: any) {
        res.status(400).json({ error: String(err?.message || err) });
      }
    },
  );

  app.patch(
    '/api/projects/:id/conversations/:cid/comments/:commentId/anchor',
    async (req, res) => {
      const conv = getRoutableConversation(req.params.id, req.params.cid);
      if (!conv) {
        return res.status(404).json({ error: 'conversation not found' });
      }
      const workspaceResolution = await resolveRequestWorkspaceContext(
        req,
        req.params.id,
      );
      if (!workspaceResolution.ok) {
        return sendWorkspaceResolutionError(res, workspaceResolution);
      }
      const workspaceContext = workspaceResolution.context;
      try {
        // Drift-ladder write-back: the client resolves anchor state each render
        // and reports it here. This is a per-daemon DERIVED read-back (each
        // daemon anchors against its own content), not a user edit or a synced
        // field — so it is neither permission-gated nor pushed to the relay, and
        // it does not bump updated_at.
        const existing = getRequestPreviewComment(
          req.params.id,
          req.params.cid,
          req.params.commentId,
          workspaceContext,
        );
        if (!existing) return res.status(404).json({ error: 'comment not found' });
        const comment = updatePreviewCommentAnchor(
          db,
          req.params.id,
          existing.conversationId,
          req.params.commentId,
          req.body || {},
        );
        if (!comment) return res.status(404).json({ error: 'comment not found' });
        res.json({ comment });
      } catch (err: any) {
        res.status(400).json({ error: String(err?.message || err) });
      }
    },
  );

  app.patch(
    '/api/projects/:id/conversations/:cid/comments/:commentId/reorder',
    async (req, res) => {
      const conv = getRoutableConversation(req.params.id, req.params.cid);
      if (!conv) {
        return res.status(404).json({ error: 'conversation not found' });
      }
      const workspaceResolution = await resolveRequestWorkspaceContext(
        req,
        req.params.id,
      );
      if (!workspaceResolution.ok) {
        return sendWorkspaceResolutionError(res, workspaceResolution);
      }
      const workspaceContext = workspaceResolution.context;
      const sortKey = Number(req.body?.sortKey);
      if (!Number.isFinite(sortKey)) {
        return res.status(400).json({ error: 'sortKey must be a finite number' });
      }
      try {
        // Sidebar display order is a per-daemon viewing preference, not a
        // content edit: unlike status change/delete, it is not gated on
        // authorship (any member may reorder their OWN view of a shared
        // project's comments), does not bump updated_at, and is never pushed
        // to the collab-cloud relay — see PreviewComment.sortKey.
        const existing = getRequestPreviewComment(
          req.params.id,
          req.params.cid,
          req.params.commentId,
          workspaceContext,
        );
        if (!existing) return res.status(404).json({ error: 'comment not found' });
        const comment = reorderPreviewComment(
          db,
          req.params.id,
          existing.conversationId,
          req.params.commentId,
          sortKey,
        );
        if (!comment) return res.status(404).json({ error: 'comment not found' });
        res.json({ comment });
      } catch (err: any) {
        res.status(400).json({ error: String(err?.message || err) });
      }
    },
  );

  app.delete(
    '/api/projects/:id/conversations/:cid/comments/:commentId',
    async (req, res) => {
      if (!await allowCommentAction(
        req,
        res,
        req.params.id,
        { mode: 'write', capability: 'comment' },
      )) return;
      const conv = getRoutableConversation(req.params.id, req.params.cid);
      if (!conv) {
        return res.status(404).json({ error: 'conversation not found' });
      }
      if (!await enforceCommentWorkspaceMutation(req, res, req.params.id)) return;
      const workspaceResolution = await resolveRequestWorkspaceContext(
        req,
        req.params.id,
      );
      if (!workspaceResolution.ok) {
        return sendWorkspaceResolutionError(res, workspaceResolution);
      }
      const workspaceContext = workspaceResolution.context;
      // Load before deleting so we can gate on the author and build the tombstone.
      const existing = getRequestPreviewComment(
        req.params.id,
        req.params.cid,
        req.params.commentId,
        workspaceContext,
      );
      if (!existing) return res.status(404).json({ error: 'comment not found' });
      // Delete is allowed for the comment's author and the project owner.
      if (!(await callerMayMutate(
        req,
        res,
        req.params.id,
        existing,
        workspaceContext,
      ))) {
        return res.status(403).json({ error: 'not permitted' });
      }
      const syncEnabled = isLocalTeamRelayCandidate(
        req.params.id,
        workspaceContext,
        Boolean(ctx.onCommentDeleted),
      );
      let ok = false;
      try {
        ok = db.transaction(() => {
          const deleted = deletePreviewComment(
            db,
            req.params.id,
            existing.conversationId,
            req.params.commentId,
          );
          if (!deleted) return false;
          updateProject(db, req.params.id, {});
          if (syncEnabled) {
            requireRelayEnqueued(ctx.onCommentDeleted?.(existing, workspaceContext));
          }
          return true;
        })();
      } catch (err: any) {
        return res.status(400).json({ error: String(err?.message || err) });
      }
      if (!ok) return res.status(404).json({ error: 'comment not found' });
      res.json({ ok: true });
    },
  );
}
