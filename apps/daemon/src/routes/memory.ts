import type { Express } from 'express';
import { MEMORY_TYPES, resolveEdition, type Edition } from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import { readNextoreConfig, type NextoreConfig } from '../nextore/config.js';
import {
  memoryRootFor,
  memoryScopeId,
  nextoreFastMemoryProvider,
  readNextoreMemorySession,
} from '../nextore/memory/scoped-memory.js';

import {
  buildMemoryTree,
  composeMemoryBody,
  deleteMemoryEntry,
  extractFromMessage,
  listMemoryEntries,
  maskMemoryExtractionConfig,
  memoryDir,
  memoryEvents,
  readMemoryConfig,
  readMemoryEntry,
  readMemoryIndex,
  updateMemoryTreeNode,
  upsertMemoryEntry,
  writeMemoryConfig,
  writeMemoryIndex,
} from '../memory.js';
import {
  clearExtractions as clearMemoryExtractions,
  listExtractions as listMemoryExtractions,
  removeExtraction as removeMemoryExtraction,
} from '../memory-extractions.js';
import {
  clearVerifications as clearMemoryVerifications,
  listVerifications as listMemoryVerifications,
  removeVerification as removeMemoryVerification,
} from '../memory-verify.js';
import { distillRulesFromAnnotations } from '../memory-rules.js';
import {
  extractMemoryFromConnectors,
  suggestMemoryFromConnectors,
} from '../memory-connectors.js';

export interface RegisterMemoryRoutesDeps extends RouteDeps<'http' | 'paths' | 'appConfig'> {
  /** Injected by the daemon; tests can pin the edition without touching env. */
  nextore?: {
    edition: Edition;
    config: NextoreConfig | null;
  };
}

type UnknownRecord = Record<string, unknown>;
type MemoryType =
  | 'user'
  | 'feedback'
  | 'project'
  | 'reference'
  | 'profile'
  | 'rule';
type MemoryExtractionProvider = 'anthropic' | 'openai' | 'azure' | 'google' | 'ollama';

interface MemoryExtractionPatch {
  provider: MemoryExtractionProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  apiVersion?: string;
}

interface MemoryConfigPatch {
  enabled?: boolean;
  chatExtractionEnabled?: boolean;
  /** Two-loop memory per-hook toggles (default-on; omit to leave unchanged). */
  profileEnabled?: boolean;
  rewriteEnabled?: boolean;
  verifyEnabled?: boolean;
  extraction?: MemoryExtractionPatch | null;
}

interface MemoryEntryInput {
  id?: string;
  name: string;
  description?: string;
  type: MemoryType;
  body?: string;
}

interface MemoryAppConfigLike {
  agentId?: string;
  agentModels?: Record<string, { model?: string }>;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMemoryType(value: unknown): value is MemoryType {
  // Sourced from the shared contract so the new `profile` / `rule` buckets
  // can't be rejected here while the type union already allows them.
  return (
    typeof value === 'string'
    && (MEMORY_TYPES as readonly string[]).includes(value)
  );
}

function isExtractionProvider(value: unknown): value is MemoryExtractionProvider {
  return (
    value === 'anthropic'
    || value === 'openai'
    || value === 'azure'
    || value === 'google'
    || value === 'ollama'
  );
}

export function registerMemoryRoutes(app: Express, ctx: RegisterMemoryRoutesDeps) {
  const { RUNTIME_DATA_DIR, PROJECT_ROOT, PROJECTS_DIR } = ctx.paths;
  const { createSseResponse, requireLocalDaemonRequest } = ctx.http;
  const { readAppConfig } = ctx.appConfig;
  const edition: Edition = ctx.nextore?.edition ?? resolveEdition(process.env.OD_EDITION);
  const nextoreConfig = ctx.nextore
    ? ctx.nextore.config
    : readNextoreConfig(process.env, edition);

  // ----- Memory scope (NXD-D19) -------------------------------------------
  // Upstream keeps one global markdown store. The NexTore edition scopes the
  // whole store to the signed-in member and honors the module's global
  // `MemoryEnabled` switch. Resolving it once per request keeps every route
  // below from re-parsing the session (and from forgetting the check).
  app.use('/api/memory', (_req, res, next) => {
    if (edition !== 'nextore') {
      res.locals.memoryScope = {
        dataDir: RUNTIME_DATA_DIR,
        memberId: null,
        moduleEnabled: true,
      };
      next();
      return;
    }
    const session = readNextoreMemorySession(res);
    if (!session) {
      res.status(401).json({
        error: { code: 'SESSION_REQUIRED', message: 'A NexTore session is required.' },
      });
      return;
    }
    res.locals.memoryScope = {
      dataDir: memoryRootFor(RUNTIME_DATA_DIR, session.memberId),
      memberId: session.memberId,
      moduleEnabled: session.memoryEnabled,
    };
    next();
  });

  type MemoryRouteScope = {
    dataDir: string;
    memberId: number | null;
    moduleEnabled: boolean;
  };
  const scopeOf = (res: any): MemoryRouteScope => res.locals.memoryScope as MemoryRouteScope;
  const rejectWhenDisabled = (res: any): boolean => {
    if (scopeOf(res).moduleEnabled) return false;
    res.status(403).json({
      error: {
        code: 'MEMORY_DISABLED',
        message: 'Memory is disabled by the NexTore administrator.',
      },
    });
    return true;
  };
  const currentAccessToken = (res: any): string =>
    typeof res.locals?.nextoreSession?.accessToken === 'string'
      ? res.locals.nextoreSession.accessToken
      : '';
  // Registered BEFORE requireLocalDaemonRequest so the edition answers 404 no
  // matter which proxy origin reached the daemon. Upstream keeps the routes.
  const rejectConnectorMemoryInEdition = (req: any, res: any, next: any): void => {
    if (edition === 'nextore') {
      res.status(404).json({ error: 'feature_disabled', feature: 'connectors' });
      return;
    }
    next();
  };

  // ----- Memory store -----------------------------------------------------
  // Markdown-on-disk memory under <dataDir>/memory/. The daemon folds these
  // into every system prompt (gated by `enabled`) and the chat run loop
  // calls `/api/memory/extract` after each turn to sediment new facts.
  app.get('/api/memory', async (_req, res) => {
    const scope = scopeOf(res);
    try {
      if (!scope.moduleEnabled) {
        res.json({
          enabled: false,
          moduleEnabled: false,
          chatExtractionEnabled: false,
          profileEnabled: false,
          rewriteEnabled: false,
          verifyEnabled: false,
          rootDir: memoryDir(scope.dataDir),
          index: '',
          entries: [],
          extraction: null,
        });
        return;
      }
      const [config, index, entries] = await Promise.all([
        readMemoryConfig(scope.dataDir),
        readMemoryIndex(scope.dataDir),
        listMemoryEntries(scope.dataDir),
      ]);
      res.json({
        enabled: config.enabled,
        moduleEnabled: true,
        chatExtractionEnabled: config.chatExtractionEnabled,
        profileEnabled: config.profileEnabled,
        rewriteEnabled: config.rewriteEnabled,
        verifyEnabled: config.verifyEnabled,
        rootDir: memoryDir(scope.dataDir),
        index,
        entries,
        extraction: maskMemoryExtractionConfig(config.extraction),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Static sub-resources (`/index`, `/config`, `/extract`) registered
  // BEFORE the `:id` catch-alls so an `index` / `config` / `extract` slug
  // can't shadow the real handlers.
  app.get('/api/memory/tree', async (_req, res) => {
    const scope = scopeOf(res);
    try {
      if (!scope.moduleEnabled) {
        res.json({
          enabled: false,
          moduleEnabled: false,
          rootDir: memoryDir(scope.dataDir),
          tree: [],
        });
        return;
      }
      const [config, tree] = await Promise.all([
        readMemoryConfig(scope.dataDir),
        buildMemoryTree(scope.dataDir),
      ]);
      res.json({
        enabled: config.enabled,
        moduleEnabled: true,
        rootDir: memoryDir(scope.dataDir),
        tree,
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.patch('/api/memory/tree/:id', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      const body = asRecord(req.body);
      const entry = await updateMemoryTreeNode(
        scope.dataDir,
        req.params.id,
        body,
      );
      const tree = await buildMemoryTree(scope.dataDir);
      res.json({ entry, tree });
    } catch (err) {
      const message = errorMessage(err);
      res.status(message === 'memory not found' ? 404 : 400).json({ error: message });
    }
  });

  app.put('/api/memory/index', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      const body = asRecord(req.body);
      const index = typeof body.index === 'string' ? body.index : '';
      await writeMemoryIndex(scope.dataDir, index, undefined);
      res.json({ index });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  app.patch('/api/memory/config', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      const body = asRecord(req.body);
      const patch: MemoryConfigPatch = {};
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (typeof body.chatExtractionEnabled === 'boolean') {
        patch.chatExtractionEnabled = body.chatExtractionEnabled;
      }
      if (typeof body.profileEnabled === 'boolean') {
        patch.profileEnabled = body.profileEnabled;
      }
      if (typeof body.rewriteEnabled === 'boolean') {
        patch.rewriteEnabled = body.rewriteEnabled;
      }
      if (typeof body.verifyEnabled === 'boolean') {
        patch.verifyEnabled = body.verifyEnabled;
      }
      // Three-state extraction handling so the UI can: (a) leave the
      // override alone (omit `extraction`), (b) clear it back to
      // auto-pick (`extraction: null`), or (c) commit a custom override
      // (`extraction: { provider, ... }`). For the apiKey field we
      // need *four* states because the masked GET surfaces only an
      // `apiKeyTail` (the secret never round-trips):
      //   - field absent      → preserve the stored key (UI re-saves
      //                          a settings form without re-typing
      //                          the secret).
      //   - field === ''      → CLEAR the stored key (the picker's
      //                          drift-resync effect fires this when
      //                          the user clears their BYOK chat
      //                          API key — keeping the old daemon-
      //                          side credential would silently keep
      //                          calling the provider after the user
      //                          intentionally removed it from the
      //                          chat picker, which the reviewer
      //                          flagged as a credential-sync bug).
      //   - field === 'sk-…'  → replace with the new key.
      //   - provider differs  → ignore stored key entirely.
      if (Object.prototype.hasOwnProperty.call(body, 'extraction')) {
        if (body.extraction === null) {
          patch.extraction = null;
        } else if (body.extraction && typeof body.extraction === 'object') {
          const incoming = body.extraction as UnknownRecord;
          const current = await readMemoryConfig(scope.dataDir);
          const currentExtraction = current.extraction as MemoryExtractionPatch | null;
          const apiKeyOmitted = !Object.prototype.hasOwnProperty.call(
            incoming,
            'apiKey',
          );
          const sameProvider =
            !!currentExtraction
            && currentExtraction.provider === incoming.provider;
          let nextApiKey = '';
          if (typeof incoming.apiKey === 'string' && incoming.apiKey) {
            nextApiKey = incoming.apiKey;
          } else if (apiKeyOmitted && sameProvider) {
            nextApiKey = currentExtraction?.apiKey ?? '';
          }
          if (!isExtractionProvider(incoming.provider)) {
            throw new Error('invalid extraction provider');
          }
          const nextExtraction: MemoryExtractionPatch = {
            provider: incoming.provider,
            apiKey: nextApiKey,
          };
          if (typeof incoming.model === 'string') nextExtraction.model = incoming.model;
          if (typeof incoming.baseUrl === 'string') nextExtraction.baseUrl = incoming.baseUrl;
          // Azure-only; ignored by the validator for the other providers.
          // We forward whatever the UI sent (or the previously-stored
          // value when the UI omits the field) so re-saving an azure
          // override without re-typing the api-version doesn't blank it.
          const apiVersion =
            typeof incoming.apiVersion === 'string'
              ? incoming.apiVersion
              : currentExtraction?.apiVersion;
          if (typeof apiVersion === 'string') nextExtraction.apiVersion = apiVersion;
          patch.extraction = nextExtraction;
        }
      }
      const next = await writeMemoryConfig(scope.dataDir, patch);
      res.json({
        enabled: next.enabled,
        chatExtractionEnabled: next.chatExtractionEnabled,
        profileEnabled: next.profileEnabled,
        rewriteEnabled: next.rewriteEnabled,
        verifyEnabled: next.verifyEnabled,
        extraction: maskMemoryExtractionConfig(next.extraction),
      });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  // SSE feed of memory mutations. The web settings panel subscribes to
  // this and re-fetches on every event; toast UIs can listen for
  // `kind === 'extract'` and surface a small "Memory updated (N new)"
  // notification. Payload shape: MemoryChangeEvent (see ./memory.ts).
  //
  // The same connection also forwards `extraction` events — one per LLM
  // extraction phase transition — so the settings panel can render a
  // live "recent extractions" list. We multiplex on a single SSE stream
  // so the browser opens one connection instead of two.
  app.get('/api/memory/events', async (_req, res) => {
    const scope = scopeOf(res);
    if (!scope.moduleEnabled) {
      // 204 tells EventSource to stop reconnecting; a 403 would retry forever.
      res.status(204).end();
      return;
    }
    const scopeId = memoryScopeId(scope.dataDir);
    // The daemon-wide bus is shared by every member, so the stream itself is
    // the only place that can keep one member's extraction previews and edits
    // out of another member's settings panel. Upstream events carry no member
    // scope and stay unfiltered.
    const belongsToScope = (event: unknown): boolean => {
      if (edition !== 'nextore') return true;
      if (!event || typeof event !== 'object') return true;
      const eventScope = (event as { scope?: unknown }).scope;
      return eventScope === undefined || eventScope === scopeId;
    };
    const sse = createSseResponse(res);
    sse.send('connected', { at: Date.now() });
    const onChange = (event: unknown) => {
      if (belongsToScope(event)) sse.send('change', event);
    };
    const onExtraction = (event: unknown) => {
      if (belongsToScope(event)) sse.send('extraction', event);
    };
    // `verify` events carry POST self-verify enforcement outcomes (THREAD 2),
    // one per enforced turn. Multiplexed on the same connection as `change`
    // and `extraction` so the settings panel opens a single stream.
    const onVerify = (event: unknown) => {
      if (belongsToScope(event)) sse.send('verify', event);
    };
    memoryEvents.on('change', onChange);
    memoryEvents.on('extraction', onExtraction);
    memoryEvents.on('verify', onVerify);
    res.on('close', () => {
      memoryEvents.off('change', onChange);
      memoryEvents.off('extraction', onExtraction);
      memoryEvents.off('verify', onVerify);
    });
  });

  // Recent LLM-extraction attempts (newest first; capped server-side).
  // Surfaces skip reasons, in-flight calls, success counts, and errors
  // so the settings panel can show "why didn't memory update?" at a
  // glance instead of leaving the user to guess.
  app.get('/api/memory/extractions', async (_req, res) => {
    try {
      res.json({
        extractions: listMemoryExtractions(memoryScopeId(scopeOf(res).dataDir)),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Drop the entire extraction history. Registered BEFORE the `:id`
  // catch-all so a literal "/api/memory/extractions" can still be
  // cleared with `curl -X DELETE`.
  app.delete('/api/memory/extractions', async (_req, res) => {
    if (rejectWhenDisabled(res)) return;
    try {
      const removed = clearMemoryExtractions(memoryScopeId(scopeOf(res).dataDir));
      res.json({ removed });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  app.delete('/api/memory/extractions/:id', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    try {
      const removed = removeMemoryExtraction(
        req.params.id,
        memoryScopeId(scopeOf(res).dataDir),
      );
      res.json({ removed });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  // Recent POST self-verify enforcement outcomes (THREAD 2; newest first,
  // capped server-side). Surfaces `missing` (model skipped the scorecard) and
  // `fail` (a rule failed or was left uncovered) so the user can see that
  // verification is actually enforced, not honour-system.
  app.get('/api/memory/verifications', async (_req, res) => {
    try {
      res.json({
        verifications: listMemoryVerifications(memoryScopeId(scopeOf(res).dataDir)),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Drop the entire verification history. Registered BEFORE the `:id`
  // catch-all so a literal "/api/memory/verifications" can be cleared.
  app.delete('/api/memory/verifications', async (_req, res) => {
    if (rejectWhenDisabled(res)) return;
    try {
      const removed = clearMemoryVerifications(memoryScopeId(scopeOf(res).dataDir));
      res.json({ removed });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  app.delete('/api/memory/verifications/:id', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    try {
      const removed = removeMemoryVerification(
        req.params.id,
        memoryScopeId(scopeOf(res).dataDir),
      );
      res.json({ removed });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  // Distil a batch of in-canvas/in-deck annotations into candidate rule
  // proposals (THREAD 1). Display-only: the response feeds the existing
  // rule-proposal Keep gate; nothing is written until the user confirms a
  // proposal through `POST /api/memory` (`type: 'rule'`). Runs a heuristic
  // pass always, and an LLM pass when an extraction provider is configured.
  app.post('/api/memory/rules/suggest', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      const body = asRecord(req.body);
      const rawAnnotations = Array.isArray(body.annotations) ? body.annotations : [];
      const annotations = rawAnnotations
        .map((item: unknown) => {
          const a = asRecord(item);
          const note = typeof a.note === 'string' ? a.note : '';
          if (!note.trim()) return null;
          return {
            note,
            ...(typeof a.targetLabel === 'string' ? { targetLabel: a.targetLabel } : {}),
            ...(typeof a.filePath === 'string' ? { filePath: a.filePath } : {}),
            ...(typeof a.currentText === 'string' ? { currentText: a.currentText } : {}),
            ...(typeof a.selectionKind === 'string' ? { selectionKind: a.selectionKind } : {}),
            ...(typeof a.htmlHint === 'string' ? { htmlHint: a.htmlHint } : {}),
          };
        })
        .filter((a): a is { note: string } => a !== null);
      const appConfig = (await readAppConfig(RUNTIME_DATA_DIR).catch(() => ({}))) as MemoryAppConfigLike;
      const chatAgentId =
        typeof body.chatAgentId === 'string' && body.chatAgentId.trim()
          ? body.chatAgentId.trim()
          : typeof appConfig.agentId === 'string' && appConfig.agentId.trim()
            ? appConfig.agentId.trim()
            : null;
      const chatModel =
        typeof body.chatModel === 'string' && body.chatModel.trim()
          ? body.chatModel.trim()
          : (chatAgentId && appConfig.agentModels?.[chatAgentId]?.model
            ? appConfig.agentModels[chatAgentId].model ?? null
            : null);
      const result = await distillRulesFromAnnotations(
        scope.dataDir,
        { annotations },
        {
          projectRoot: PROJECT_ROOT,
          ...(chatAgentId ? { chatAgentId } : {}),
          ...(chatModel ? { chatModel } : {}),
          ...(edition !== 'nextore'
            && body.chatProvider
            && typeof body.chatProvider === 'object'
            ? { chatProvider: body.chatProvider }
            : {}),
          ...(edition === 'nextore'
            ? {
                nextoreExtraction: {
                  provider: nextoreFastMemoryProvider(
                    nextoreConfig,
                    currentAccessToken(res),
                  ),
                },
              }
            : {}),
        },
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/memory/connectors/suggest', rejectConnectorMemoryInEdition, requireLocalDaemonRequest, async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      const body = asRecord(req.body);
      const connectorIds = Array.isArray(body.connectorIds)
        ? body.connectorIds
          .filter((id: unknown): id is string => typeof id === 'string')
          .map((id: string) => id.trim())
          .filter(Boolean)
          .slice(0, 12)
        : undefined;
      const query =
        typeof body.query === 'string' ? body.query.trim().slice(0, 240) : '';
      const projectId =
        typeof body.projectId === 'string' && body.projectId.trim()
          ? body.projectId.trim()
          : null;
      const appConfig = (await readAppConfig(RUNTIME_DATA_DIR).catch(() => ({}))) as MemoryAppConfigLike;
      const chatAgentId =
        typeof body.chatAgentId === 'string' && body.chatAgentId.trim()
          ? body.chatAgentId.trim()
          : typeof appConfig.agentId === 'string' && appConfig.agentId.trim()
            ? appConfig.agentId.trim()
            : null;
      const requestChatModel =
        typeof body.chatModel === 'string' && body.chatModel.trim()
          ? body.chatModel.trim()
          : null;
      const chatModel =
        requestChatModel
        || (chatAgentId && appConfig.agentModels?.[chatAgentId]?.model
          ? appConfig.agentModels[chatAgentId].model ?? null
          : null);
      const options = {
        projectsRoot: PROJECTS_DIR,
        projectRoot: PROJECT_ROOT,
        ...(projectId ? { projectId } : {}),
        ...(connectorIds ? { connectorIds } : {}),
        ...(query ? { query } : {}),
        ...(chatAgentId ? { chatAgentId } : {}),
        ...(chatModel ? { chatModel } : {}),
      };
      const result = await suggestMemoryFromConnectors(scope.dataDir, options);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/memory/connectors/extract', rejectConnectorMemoryInEdition, requireLocalDaemonRequest, async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      const body = asRecord(req.body);
      const connectorIds = Array.isArray(body.connectorIds)
        ? body.connectorIds
          .filter((id: unknown): id is string => typeof id === 'string')
          .map((id: string) => id.trim())
          .filter(Boolean)
          .slice(0, 12)
        : undefined;
      const query =
        typeof body.query === 'string' ? body.query.trim().slice(0, 240) : '';
      const projectId =
        typeof body.projectId === 'string' && body.projectId.trim()
          ? body.projectId.trim()
          : null;
      const appConfig = (await readAppConfig(RUNTIME_DATA_DIR).catch(() => ({}))) as MemoryAppConfigLike;
      const chatAgentId =
        typeof body.chatAgentId === 'string' && body.chatAgentId.trim()
          ? body.chatAgentId.trim()
          : typeof appConfig.agentId === 'string' && appConfig.agentId.trim()
            ? appConfig.agentId.trim()
            : null;
      const requestChatModel =
        typeof body.chatModel === 'string' && body.chatModel.trim()
          ? body.chatModel.trim()
          : null;
      const chatModel =
        requestChatModel
        || (chatAgentId && appConfig.agentModels?.[chatAgentId]?.model
          ? appConfig.agentModels[chatAgentId].model ?? null
          : null);
      const options = {
        projectsRoot: PROJECTS_DIR,
        projectRoot: PROJECT_ROOT,
        ...(projectId ? { projectId } : {}),
        ...(connectorIds ? { connectorIds } : {}),
        ...(query ? { query } : {}),
        ...(chatAgentId ? { chatAgentId } : {}),
        ...(chatModel ? { chatModel } : {}),
      };
      const result = await extractMemoryFromConnectors(scope.dataDir, options);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  // Imperative extract — used by CLI chats internally and by BYOK /
  // API-mode chats from the web app, which never reach the chat-run
  // path on the daemon. Mirrors the two-phase hook the daemon's chat
  // route applies inline:
  //
  //   - Pre-turn (only `userMessage` supplied): run the synchronous
  //     heuristic regex pack so explicit "remember: X" / "我是 X"
  //     markers land in memory before the prompt is composed, and the
  //     same turn's assistant reply already reflects them.
  //   - Post-turn (`userMessage` + `assistantMessage` supplied): queue
  //     the LLM extractor in the background — it speaks SSE /
  //     extraction-history on its own and may take several seconds, so
  //     we don't block the HTTP response on it. The heuristic is
  //     skipped on this branch because the caller already ran it
  //     pre-turn; running it twice would double the
  //     `recordHeuristic({...})` rows in the extraction history for
  //     every turn.
  //
  // External callers (curl, replay tools) that pass only
  // `userMessage` keep the legacy behaviour: heuristic-only.
  app.post('/api/memory/extract', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      const body = asRecord(req.body);
      const userMessage =
        typeof body.userMessage === 'string' ? body.userMessage : '';
      const assistantMessage =
        typeof body.assistantMessage === 'string' ? body.assistantMessage : '';
      const hasAssistant = assistantMessage.trim().length > 0;
      const memoryConfig = await readMemoryConfig(scope.dataDir);
      if (memoryConfig.chatExtractionEnabled === false) {
        return res.json({ changed: [], attemptedLLM: false });
      }
      const changed = hasAssistant
        ? []
        : await extractFromMessage(scope.dataDir, userMessage);
      // BYOK chat config — only forwarded by the web app for API-mode
      // chats. We strip the surface to the five fields pickProvider()
      // actually consumes and validate the provider against the four
      // shapes the extractor speaks; an unknown / missing provider
      // means "let the legacy chain decide" so a malformed payload
      // can't override the env / media-config fallbacks. The edition
      // ignores this field entirely (NXD-D19): extraction always uses
      // the signed-in member's Fast tier.
      const rawChat = edition === 'nextore' ? null : body.chatProvider;
      let chatProvider = null;
      if (rawChat && typeof rawChat === 'object') {
        const chatConfig = rawChat as UnknownRecord;
        const provider = chatConfig.provider;
        if (
          provider === 'anthropic'
          || provider === 'openai'
          || provider === 'azure'
          || provider === 'google'
          || provider === 'ollama'
        ) {
          chatProvider = {
            provider,
            apiKey: typeof chatConfig.apiKey === 'string' ? chatConfig.apiKey : '',
            baseUrl: typeof chatConfig.baseUrl === 'string' ? chatConfig.baseUrl : '',
            apiVersion:
              typeof chatConfig.apiVersion === 'string' ? chatConfig.apiVersion : '',
            model: typeof chatConfig.model === 'string' ? chatConfig.model : '',
          };
        }
      }
      const chatModel =
        typeof body.chatModel === 'string' && body.chatModel.trim()
          ? body.chatModel.trim()
          : '';
      let attemptedLLM = false;
      if (userMessage.trim().length > 0 && hasAssistant) {
        attemptedLLM = true;
        void import('../memory-llm.js')
          .then(({ extractWithLLM }) =>
            extractWithLLM(
              scope.dataDir,
              { userMessage, assistantMessage },
              {
                projectRoot: PROJECT_ROOT,
                chatAgentId: null,
                chatProvider,
                ...(chatModel ? { chatModel } : {}),
                ...(edition === 'nextore'
                  ? {
                      nextoreExtraction: {
                        provider: nextoreFastMemoryProvider(
                          nextoreConfig,
                          currentAccessToken(res),
                        ),
                      },
                    }
                  : {}),
              },
            ),
          )
          .catch((err) =>
            console.warn('[memory-llm] background failed (http extract)', err),
          );
      }
      res.json({ changed, attemptedLLM });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  // Composed memory body for the system prompt. Daemon-side chat runs
  // call `composeMemoryBody()` directly; the web app (BYOK / API mode)
  // can't import daemon internals, so this endpoint exposes the same
  // string the daemon would have folded into the system prompt for a
  // CLI run. `ProjectView.composedSystemPrompt()` calls it before each
  // BYOK turn and passes the result into `composeSystemPrompt`'s
  // `memoryBody` field — without this, the Memory tab is a no-op for
  // BYOK users even though the UI saves model/index/entries for them.
  app.get('/api/memory/system-prompt', async (_req, res) => {
    const scope = scopeOf(res);
    try {
      if (!scope.moduleEnabled) {
        res.json({ body: '' });
        return;
      }
      const body = await composeMemoryBody(scope.dataDir);
      res.json({ body });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/memory', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      const body = asRecord(req.body);
      if (!isMemoryType(body.type) || typeof body.name !== 'string') {
        throw new Error('memory entry requires `name` and a valid `type`');
      }
      const entry = await upsertMemoryEntry(
        scope.dataDir,
        body as unknown as MemoryEntryInput,
        undefined,
      );
      res.json({ entry });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/memory/:id', async (req, res) => {
    const scope = scopeOf(res);
    if (!scope.moduleEnabled) {
      return res.status(404).json({ error: 'memory not found' });
    }
    try {
      const entry = await readMemoryEntry(scope.dataDir, req.params.id);
      if (!entry) return res.status(404).json({ error: 'memory not found' });
      res.json({ entry });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  app.put('/api/memory/:id', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      const body = asRecord(req.body);
      if (!isMemoryType(body.type) || typeof body.name !== 'string') {
        throw new Error('memory entry requires `name` and a valid `type`');
      }
      const entry = await upsertMemoryEntry(
        scope.dataDir,
        {
          ...(body as unknown as MemoryEntryInput),
          id: req.params.id,
        },
        undefined,
      );
      res.json({ entry });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  app.delete('/api/memory/:id', async (req, res) => {
    if (rejectWhenDisabled(res)) return;
    const scope = scopeOf(res);
    try {
      await deleteMemoryEntry(scope.dataDir, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

}
