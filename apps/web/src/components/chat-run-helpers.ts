import type { AgentEvent, ChatMessage } from '../types';
import { isTodoWriteToolName } from '@open-design/contracts';
import { isRetryableAssistantTerminalFailure } from '../runtime/design-delivery';
import { markHistoryReplayLanded } from './chat/useCharReveal';

/**
 * Pure chat-run helpers shared by ProjectView, the side-chat hook, and tests.
 * This module must stay free of component imports: it is the seam that keeps
 * ProjectView (and the workspace bundle behind it) out of the initial graph.
 */

export function isTerminalRunStatus(status: ChatMessage['runStatus']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

export function isActiveRunStatus(status: ChatMessage['runStatus']): boolean {
  return status === 'queued' || status === 'running';
}

export interface RetryTarget {
  failedAssistant: ChatMessage;
  userMsg: ChatMessage;
  priorMessages: ChatMessage[];
  preservedAttempts: ChatMessage[];
}

export function resolveRetryTarget(
  messages: ChatMessage[],
  failedAssistantId: string,
): RetryTarget | null {
  let failedIndex = messages.findIndex(
    (message) =>
      message.id === failedAssistantId &&
      message.role === 'assistant',
  );
  const taskId = messages[failedIndex]?.strategyTaskExecutionId;
  // ChatPane's folded task keeps the request message ID while displaying the
  // last physical Run's verdict. Resolve only contiguous successors belonging
  // to that task; a later user, another task or a new run-index-zero head is a
  // boundary, not permission to retry an older turn.
  if (taskId) {
    while (failedIndex + 1 < messages.length) {
      const successor = messages[failedIndex + 1]!;
      if (
        successor.role !== 'assistant' ||
        successor.strategyTaskExecutionId !== taskId ||
        (successor.strategyTaskRunIndex ?? 0) <= 0
      ) break;
      failedIndex += 1;
    }
  }
  if (failedIndex <= 0 || failedIndex !== messages.length - 1) return null;
  const failedAssistant = messages[failedIndex]!;
  if (!isRetryableAssistantTerminalFailure(failedAssistant)) return null;

  let userIndex = failedIndex;
  let failedAttemptTaskId: string | undefined;
  while (userIndex >= 0 && messages[userIndex]?.role === 'assistant') {
    const attemptMessage = messages[userIndex]!;
    if (isRetryableAssistantTerminalFailure(attemptMessage)) {
      // Each preserved retry may have created a new strategy task. Its own
      // failed tail is the witness that permits crossing its successful
      // internal Runs; a failure in another task cannot grant that permission.
      failedAttemptTaskId = attemptMessage.strategyTaskExecutionId;
    } else if (
      !failedAttemptTaskId ||
      attemptMessage.strategyTaskExecutionId !== failedAttemptTaskId ||
      attemptMessage.runStatus !== 'succeeded'
    ) {
      break;
    }
    // A new index-zero head starts a separate attempt even if a task ID was
    // reused. Do not retain an allowlist that could cross an earlier success.
    if ((attemptMessage.strategyTaskRunIndex ?? 0) === 0) {
      failedAttemptTaskId = undefined;
    }
    userIndex -= 1;
  }

  const userMsg = messages[userIndex];
  if (!userMsg || userMsg.role !== 'user') return null;

  return {
    failedAssistant,
    userMsg,
    priorMessages: messages.slice(0, userIndex),
    preservedAttempts: messages.slice(userIndex + 1, failedIndex + 1),
  };
}

export function isStoppableAssistantMessage(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false;
  if (isActiveRunStatus(message.runStatus)) return true;
  return message.runStatus === undefined && message.endedAt === undefined && message.startedAt !== undefined;
}

export function resolveSucceededRunStatus(status: ChatMessage['runStatus']): ChatMessage['runStatus'] {
  return status === 'failed' || status === 'canceled' ? status : 'succeeded';
}

export function finalizeActiveAssistantMessagesOnStop(
  messages: ChatMessage[],
  stoppedAt: number,
): { messages: ChatMessage[]; finalized: ChatMessage[] } {
  const finalized: ChatMessage[] = [];
  const next = messages.map((message) => {
    if (!isStoppableAssistantMessage(message)) {
      return message;
    }
    const updated = {
      ...message,
      runStatus: 'canceled' as const,
      endedAt: message.endedAt ?? stoppedAt,
    };
    finalized.push(updated);
    return updated;
  });
  return { messages: next, finalized };
}

export type BufferedTextUpdates = ReturnType<typeof createBufferedTextUpdates>;

/**
 * 重放窗口关掉的判据:这条流安静这么久,就当 daemon 的缓冲已经放完了。
 *
 * 为什么是「安静多久」而不是某个信号:`/api/runs/:id/events` 上**没有**历史与直播的
 * 分界。daemon(`runtimes/runs.ts` 的 `stream`)是先同步把 `run.events` 整个写出去,
 * 写完才把这条连接加进 `run.clients` 收直播 —— 两段同一个通道、同一套 `id`、同一种帧。
 * 客户端唯一能如实观察到的差别是**到货节奏**:重放那一段是一次灌下来的,直播那一段
 * 按模型出字的速度来。所以这里造的分界就是「第一次安静下来」。
 */
export const HISTORY_REPLAY_SETTLE_MS = 160;
/**
 * 兜底:模型此刻正在密集出字时,重放和直播的节奏可能一直分不开。窗口最多开这么久,
 * 到点无论如何都切回逐块直播 —— 宁可把开头那一小段直播也一次性铺出来,
 * 也不能把「运行中、agent 新输出」的流式效果永久关掉。
 */
export const HISTORY_REPLAY_MAX_MS = 1_200;

export function appendBufferedAgentDeltas(
  events: AgentEvent[],
  textDelta: string,
  thinkingDelta: string,
  thinkingFramesArrived = false,
): AgentEvent[] {
  let next = events;
  if (textDelta) next = appendCoalescedAgentEvent(next, { kind: 'text', text: textDelta });
  if (thinkingDelta) {
    next = appendCoalescedAgentEvent(next, { kind: 'thinking', text: thinkingDelta });
  } else if (thinkingFramesArrived && next[next.length - 1]?.kind !== 'thinking') {
    next = appendCoalescedAgentEvent(next, { kind: 'thinking', text: '' });
  }
  return next;
}

export function createBufferedTextUpdates({
  updateMessage,
  persistSoon,
  flushAndPersistNow,
  onContentDelta,
  replayingHistory = false,
}: {
  updateMessage: (updater: (prev: ChatMessage) => ChatMessage) => void;
  persistSoon: () => void;
  // Synchronous flush + persist with a transport that survives page
  // unload (PUT with keepalive). Invoked by the pagehide handler so the
  // last buffered chunk isn't lost when the user reloads mid-stream.
  flushAndPersistNow?: () => void;
  onContentDelta?: (delta: string) => void;
  /**
   * 这条流开头是 daemon 从缓冲里重推的历史(重挂时 `?after=` 不带游标,从第 0 条起)。
   * 开着的时候,落地动作全部攒住,窗口关掉时一次性提交 —— 历史不该一段一段地
   * 走一遍入场动画,那是「运行中、agent 新输出」才有的样子(OPEND-2590)。
   */
  replayingHistory?: boolean;
}) {
  let pendingContentDelta = '';
  let pendingTextEventDelta = '';
  let pendingThinkingEventDelta = '';
  /**
   * **来过几帧**思考,和它们**带了多少字**是两件事(W102,2026-09-03)。
   *
   * claude 的思考帧正文 100% 是空串,攒起来还是空串。只看 `pendingThinkingEventDelta`
   * 就等于「一帧都没来过」,于是 `{ kind: 'thinking' }` 一条都不进 `message.events`,
   * 而壳头的「思考中」(`buildTurnBlocks` 的 `shell.thinking`)**只**认这种事件 ——
   * 那一格就永远不亮,用户盯着几分钟空白。规格 W11 写死:`thinking_delta` 到达
   * **哪怕 delta 为空**也要进入思考中。所以帧数要单独记。
   */
  let pendingThinkingEventFrames = 0;
  let flushFrame: number | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let flushing = false;
  let needsFlush = false;
  const nonDeltaEventDeduper = createAdjacentAgentEventDeduper();
  const hasDocument = typeof document !== 'undefined';
  const hasWindow = typeof window !== 'undefined';

  const cancelScheduledFlush = () => {
    if (flushFrame !== null) {
      cancelAnimationFrame(flushFrame);
      flushFrame = null;
    }
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  // ── 重放窗口(OPEND-2590)────────────────────────────────────────────────
  // 窗口开着时,每一次「提交给 React」都改成排队。攒住的是 updater 函数本身,
  // 所以去重、合并、事件与正文的先后全部保持原样;关窗口时按顺序叠成一次提交。
  let replayOpen = replayingHistory;
  let replayQueue: Array<(prev: ChatMessage) => ChatMessage> = [];
  let replayContentDelta = '';
  let replaySettleTimer: ReturnType<typeof setTimeout> | null = null;
  let replayCapTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReplayTimers = () => {
    if (replaySettleTimer !== null) {
      clearTimeout(replaySettleTimer);
      replaySettleTimer = null;
    }
    if (replayCapTimer !== null) {
      clearTimeout(replayCapTimer);
      replayCapTimer = null;
    }
  };

  /** 把攒住的历史一次性交出去。队列空就什么都不做。 */
  const drainReplayQueue = () => {
    if (replayQueue.length === 0) {
      replayContentDelta = '';
      return;
    }
    const queued = replayQueue;
    const contentDelta = replayContentDelta;
    replayQueue = [];
    replayContentDelta = '';
    // 化开只服务「模型此刻正在吐的字」。这一整块是 daemon 从缓冲里重推的旧内容,
    // 打个标记让 `useCharReveal` 把它直接落地,不走入场动画。
    markHistoryReplayLanded();
    updateMessage((prev) => queued.reduce((message, updater) => updater(message), prev));
    persistSoon();
    if (contentDelta) onContentDelta?.(contentDelta);
  };

  const closeReplayWindow = () => {
    clearReplayTimers();
    if (!replayOpen) return;
    replayOpen = false;
    drainReplayQueue();
  };

  /** 又有东西到货:窗口还开着就把「安静」的判定往后推。 */
  const noteReplayActivity = () => {
    if (!replayOpen || disposed) return;
    if (replaySettleTimer !== null) clearTimeout(replaySettleTimer);
    replaySettleTimer = setTimeout(closeReplayWindow, HISTORY_REPLAY_SETTLE_MS);
  };

  /** 落地一次改动:窗口开着就排队,否则照旧直接提交。 */
  const commit = (updater: (prev: ChatMessage) => ChatMessage) => {
    if (replayOpen) {
      replayQueue.push(updater);
      return;
    }
    updateMessage(updater);
  };

  const commitPersistSoon = () => {
    if (replayOpen) return;
    persistSoon();
  };

  if (replayOpen) {
    replayCapTimer = setTimeout(closeReplayWindow, HISTORY_REPLAY_MAX_MS);
    noteReplayActivity();
  }

  const flushPending = () => {
    if (disposed) return;
    if (flushing) {
      needsFlush = true;
      return;
    }
    cancelScheduledFlush();
    if (
      !pendingContentDelta
      && !pendingTextEventDelta
      && !pendingThinkingEventDelta
      && pendingThinkingEventFrames === 0
      && !needsFlush
    ) return;
    flushing = true;
    needsFlush = false;
    const contentDelta = pendingContentDelta;
    const textEventDelta = pendingTextEventDelta;
    const thinkingEventDelta = pendingThinkingEventDelta;
    const thinkingFramesArrived = pendingThinkingEventFrames > 0;
    pendingContentDelta = '';
    pendingTextEventDelta = '';
    pendingThinkingEventDelta = '';
    pendingThinkingEventFrames = 0;
    try {
      commit((prev) => {
        const previousEvents = prev.events ?? [];
        const nextEvents = appendBufferedAgentDeltas(
          previousEvents,
          textEventDelta,
          thinkingEventDelta,
          thinkingFramesArrived,
        );
        // 一串空思考帧里只有第一帧会改动数组;其余帧什么都没变,别白换一次消息身份
        if (nextEvents === previousEvents && !contentDelta) return prev;
        return { ...prev, content: prev.content + contentDelta, events: nextEvents };
      });
      if (replayOpen) {
        replayContentDelta += contentDelta;
      } else {
        persistSoon();
        if (contentDelta) onContentDelta?.(contentDelta);
      }
    } finally {
      flushing = false;
    }
    if (
      pendingContentDelta
      || pendingTextEventDelta
      || pendingThinkingEventDelta
      || pendingThinkingEventFrames > 0
      || needsFlush
    ) {
      needsFlush = false;
      scheduleFlush();
    }
  };

  const scheduleFlush = () => {
    if (disposed || flushFrame !== null || flushTimer !== null) return;
    flushFrame = requestAnimationFrame(() => {
      flushFrame = null;
      flushPending();
    });
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPending();
    }, 250);
  };

  /**
   * 对外的 `flush()` 是「**现在**就要看到已落地的状态」—— 落盘、卸载、收尾都靠它,
   * 所以它连重放队列一起交出去。模块内部为了排序而做的 flush 走 `flushPending()`,
   * 那种只是把待定的正文变成一条 text 事件,不该把重放窗口提前关掉。
   */
  const flush = () => {
    flushPending();
    drainReplayQueue();
  };

  const appendContent = (delta: string) => {
    if (disposed) return;
    pendingContentDelta += delta;
    needsFlush = true;
    noteReplayActivity();
    scheduleFlush();
  };

  const appendTextEvent = (delta: string) => {
    if (disposed) return;
    // 攒着的思考先交出去 —— 空帧也算,否则思考与正文的先后会错位
    if (pendingThinkingEventDelta || pendingThinkingEventFrames > 0) flushPending();
    nonDeltaEventDeduper.reset();
    pendingTextEventDelta += delta;
    needsFlush = true;
    noteReplayActivity();
    scheduleFlush();
  };

  const appendEvent = (ev: AgentEvent) => {
    if (disposed) return;
    if (ev.kind === 'text') {
      appendTextEvent(ev.text);
      return;
    }
    if (ev.kind === 'thinking') {
      if (pendingTextEventDelta) flushPending();
      nonDeltaEventDeduper.reset();
      pendingThinkingEventDelta += ev.text;
      // 帧数单独记:claude 的 delta 全是空串,只看上面那行等于「一帧都没来过」
      pendingThinkingEventFrames += 1;
      needsFlush = true;
      noteReplayActivity();
      scheduleFlush();
      return;
    }
    flushPending();
    noteReplayActivity();
    if (nonDeltaEventDeduper.isDuplicate(ev)) return;
    commit((prev) => {
      const previousEvents = prev.events ?? [];
      const nextEvents = appendCoalescedAgentEvent(previousEvents, ev);
      return nextEvents === previousEvents
        ? prev
        : { ...prev, events: nextEvents };
    });
    commitPersistSoon();
  };

  const cancel = () => {
    // 攒住的历史不能跟着 buffer 一起消失:重挂开始时这条消息已经被清空了,
    // 丢掉队列等于把正文留在空白上。先交出去再拆。
    clearReplayTimers();
    replayOpen = false;
    drainReplayQueue();
    disposed = true;
    cancelScheduledFlush();
    pendingContentDelta = '';
    pendingTextEventDelta = '';
    pendingThinkingEventDelta = '';
    pendingThinkingEventFrames = 0;
    needsFlush = false;
    nonDeltaEventDeduper.reset();
    if (hasDocument) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (hasWindow) {
      window.removeEventListener('pagehide', onPageHide);
    }
  };

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  }

  function onPageHide() {
    flush();
    // persistSoon's 500ms debounce never fires once the document tears
    // down, so synchronously PUT with keepalive instead.
    flushAndPersistNow?.();
  }

  if (hasDocument) {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (hasWindow) {
    window.addEventListener('pagehide', onPageHide);
  }

  // True when text has been appended but not yet flushed into a `text` event.
  // Callers that need the soon-to-be-committed event count (e.g. pinning a live
  // tool's stream position) add 1 for this still-buffered preamble.
  const hasPendingText = () => pendingTextEventDelta.length > 0;

  return { appendContent, appendTextEvent, appendEvent, flush, cancel, hasPendingText };
}

export function isSnapshotAgentEvent(event: AgentEvent): event is Extract<AgentEvent, { kind: 'tool_use' }> {
  return event.kind === 'tool_use' && isTodoWriteToolName(event.name);
}

export function agentEventsAreIdentical(left: AgentEvent, right: AgentEvent): boolean {
  if (left === right) return true;
  if (
    !isSnapshotAgentEvent(left)
    || !isSnapshotAgentEvent(right)
    || left.id !== right.id
    || left.name !== right.name
  ) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createAdjacentAgentEventDeduper() {
  let previous: AgentEvent | null = null;
  let previousJson: string | null = null;
  return {
    isDuplicate(event: AgentEvent): boolean {
      if (!isSnapshotAgentEvent(event)) {
        previous = null;
        previousJson = null;
        return false;
      }
      if (!previous || !isSnapshotAgentEvent(previous)) {
        previous = event;
        return false;
      }
      if (previous === event) return true;
      if (previous.id !== event.id || previous.name !== event.name) {
        previous = event;
        previousJson = null;
        return false;
      }
      const eventJson = JSON.stringify(event);
      const priorJson = previousJson ?? JSON.stringify(previous);
      if (eventJson === priorJson) {
        previousJson = priorJson;
        return true;
      }
      previous = event;
      previousJson = eventJson;
      return false;
    },
    reset(): void {
      previous = null;
      previousJson = null;
    },
  };
}

export function appendCoalescedAgentEvent(events: AgentEvent[], event: AgentEvent): AgentEvent[] {
  const last = events[events.length - 1];
  if (
    (event.kind === 'text' || event.kind === 'thinking')
    && last?.kind === event.kind
  ) {
    return [
      ...events.slice(0, -1),
      { ...last, text: last.text + event.text },
    ];
  }
  if (
    last
    && event.kind !== 'text'
    && event.kind !== 'thinking'
    && isSnapshotAgentEvent(last)
    && isSnapshotAgentEvent(event)
    && agentEventsAreIdentical(last, event)
  ) {
    return events;
  }
  return [...events, event];
}
