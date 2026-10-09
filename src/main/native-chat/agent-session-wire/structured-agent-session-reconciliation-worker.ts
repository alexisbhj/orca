// One in-memory reconciliation worker per chat: what ended generations left, and what an earlier
// host process left, settled in the background after every signal that a generation ended.
//
// Signals: every committed revocation or supersession of a generation (the record store's
// `onGenerationEnded`), an exit this host observed (whether or not its release landed), a row an
// ended generation committed late, and startup. Each one re-derives what readers see at once (the
// operational revision, the published view, the queued-card drain), then wakes the worker.
//
// The worker coalesces: a chat has at most one attempt running and one timer waiting, and every
// attempt re-derives everything owed (`runStructuredAgentSessionReconciliationPass`). An attempt
// that finds the chat closed replays its journal in one of a few background slots outside the
// chat's lane, and publishes it; only the publish and the pass take the lane, as separate steps, so
// a send that arrived meanwhile goes first. A failure backs off from 1 s to 30 s, in memory only.
// The worker retires once a pass finds nothing owed and wrote nothing, when the chat's record is
// gone, when the database is read-only, or at shutdown. A conversation it opened itself, or one the
// idle sweep left to it, it closes again on retiring. Nothing a person does (send, start, open,
// Stop, answer) ever waits on it.

import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import type { AgentSessionGenerationEnd } from '../../runtime/agent-session-generation-end'
import { PrioritySemaphore } from '../../../shared/priority-semaphore'
import type { OpenedStructuredAgentSessionConversation } from './structured-agent-session-conversation-open'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import type { StructuredAgentSessionExitSettlement } from './structured-agent-session-leftover-settlement'
import { restoreStructuredAgentSessionRead } from './structured-agent-session-read-restore'
import {
  runStructuredAgentSessionReconciliationPass,
  type StructuredAgentSessionReconciliationDebts,
  type StructuredAgentSessionReconciliationPassContext
} from './structured-agent-session-reconciliation-pass'

const BACKGROUND_SLOTS = 4
export const RECONCILIATION_BACKOFF_MS = { first: 1_000, max: 30_000 } as const

export type StructuredAgentSessionReconciliationSignal = {
  /** Proof the lease no longer holds (`AgentSessionGenerationEnd.evidence`). */
  evidence?: AgentSessionGenerationEnd['evidence']
  /** An observed exit whose own settlement did not land. */
  exit?: StructuredAgentSessionExitSettlement
  /** Readers re-baseline at the moved fence (`publishGenerationEnded`). */
  restate?: boolean
  /** This process owes the chat its startup share. */
  startup?: true
}

export type StructuredAgentSessionReconciliationContext =
  StructuredAgentSessionReconciliationPassContext & {
    deps: StructuredAgentSessionReconciliationPassContext['deps']
    /** The chat's action lane. */
    serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
    /** Lets a quit wait for an attempt already writing. */
    track: <T>(operation: Promise<T>) => Promise<T>
    /** Indexes and publishes a journal this worker opened. */
    adopt: (sessionId: string, opened: OpenedStructuredAgentSessionConversation) => Promise<void>
    /** Publishes what is current now and wakes the queued-card drain. */
    publishGenerationEnded: (sessionId: string, options?: { restate?: boolean }) => void
    /** Exits a lease latched in recovery when present-time evidence permits; a no-op otherwise. */
    resolveRecovery: (sessionId: string) => Promise<unknown>
    /** Closes a conversation that is only a cache, as the idle sweep does; takes the lane. */
    closeAtRest: (sessionId: string) => Promise<unknown>
  }

type ChatWorker = {
  debts: StructuredAgentSessionReconciliationDebts
  running: boolean
  /** A signal arrived while an attempt ran: the next attempt follows at once. */
  dirty: boolean
  /** `soon`: an attempt queued for this turn of the event loop; else a backoff's timer. */
  timer: ReturnType<typeof setTimeout> | 'soon' | null
  failures: number
  attempted: (() => void)[]
  /** Closed at rest when this worker retires, if still open: one it opened, or one the idle sweep
   *  would have closed but for it. */
  closeOnRetire?: StructuredAgentSessionHostSession
}

export class StructuredAgentSessionReconciliation {
  private readonly workers = new Map<string, ChatWorker>()
  private readonly slots = new PrioritySemaphore(BACKGROUND_SLOTS)
  private disposed = false
  private readonly unsubscribe: () => void

  constructor(private readonly context: StructuredAgentSessionReconciliationContext) {
    this.unsubscribe = context.deps.store.onGenerationEnded((ended) =>
      this.signal(ended.sessionId, { evidence: ended.evidence })
    )
  }

  signal = (sessionId: string, signal: StructuredAgentSessionReconciliationSignal = {}): void => {
    const session = this.context.sessions.get(sessionId)
    if (session) {
      session.operationalRevision = (session.operationalRevision ?? 0) + 1
    }
    this.context.publishGenerationEnded(sessionId, signal.restate ? { restate: true } : {})
    if (this.disposed) {
      return
    }
    const worker = this.workerFor(sessionId)
    if (signal.evidence) {
      worker.debts.evidence = [...(worker.debts.evidence ?? []), signal.evidence]
    }
    if (signal.exit) {
      worker.debts.exit = signal.exit
    }
    if (signal.startup && !worker.debts.startupShare) {
      worker.debts.startupShare = { reopenMarked: false, leaseSettled: false }
    }
    if (worker.running) {
      worker.dirty = true
    } else if (worker.failures === 0 && !worker.timer) {
      // Coalesced with whatever else this tick signals; during a backoff the timer runs it.
      this.schedule(sessionId, worker, 0)
    }
  }

  /** A committed row below the lease's fence: a generation that ended wrote it late. */
  observeCommit = (sessionId: string, lowestFence: number | null): void => {
    const fence = this.context.deps.store.getRecord(sessionId)?.lease.runtimeFence
    if (lowestFence !== null && fence !== undefined && lowestFence < fence) {
      this.signal(sessionId)
    }
  }

  /** Resolves once the chat's next attempt finished, or at once when it has no worker. */
  attempted = (sessionId: string): Promise<void> => {
    const worker = this.workers.get(sessionId)
    return worker ? new Promise((resolve) => worker.attempted.push(resolve)) : Promise.resolve()
  }

  /** The chat's startup share has not yet written its reopen mark: the queue sends nothing on its
   *  own until it has, so every card the earlier process left waits for a turn first. */
  awaitingReopenMark = (sessionId: string): boolean => {
    const share = this.workers.get(sessionId)?.debts.startupShare
    return share !== undefined && !share.reopenMarked
  }

  /** Whether the chat has a worker: something was owed at its last attempt. */
  owes = (sessionId: string): boolean => this.workers.has(sessionId)

  /** The idle sweep's close of a chat this worker still owes: deferred to its retirement, so the
   *  worker does not open it again. False when nothing is owed and the close can go ahead. */
  deferCloseAtRest = (sessionId: string): boolean => {
    const worker = this.workers.get(sessionId)
    if (!worker) {
      return false
    }
    worker.closeOnRetire = this.context.sessions.get(sessionId)
    return true
  }

  /** Resolves once the chat's worker retired, or is waiting out a backoff. */
  idle = async (sessionId: string): Promise<void> => {
    for (;;) {
      const worker = this.workers.get(sessionId)
      if (!worker || (!worker.running && worker.failures > 0)) {
        return
      }
      await new Promise<void>((resolve) => worker.attempted.push(resolve))
    }
  }

  /** Shutdown: every timer stops; an attempt already writing finishes, tracked. */
  dispose = (): void => {
    this.disposed = true
    this.unsubscribe()
    for (const [sessionId, worker] of this.workers) {
      this.retire(sessionId, worker)
    }
  }

  private workerFor(sessionId: string): ChatWorker {
    let worker = this.workers.get(sessionId)
    if (!worker) {
      worker = { debts: {}, running: false, dirty: false, timer: null, failures: 0, attempted: [] }
      this.workers.set(sessionId, worker)
    }
    return worker
  }

  private attempt(sessionId: string): void {
    const worker = this.workers.get(sessionId)
    if (!worker || worker.running) {
      return
    }
    worker.timer = null
    worker.running = true
    worker.dirty = false
    void this.context
      .track(this.runAttempt(sessionId, worker))
      .then((outcome) => this.afterAttempt(sessionId, worker, outcome))
  }

  private async runAttempt(
    sessionId: string,
    worker: ChatWorker
  ): Promise<'retire' | 'again' | 'failed'> {
    try {
      const { store } = this.context.deps
      if (this.disposed || store.readOnly || !store.getRecord(sessionId)) {
        return 'retire'
      }
      const share = worker.debts.startupShare
      // Once per startup share, before it publishes: a lease latched in recovery is decided first,
      // as the restore decides it, so no reader sees a gone owner's turn as running.
      if (share && !share.leaseSettled) {
        await this.inSlot(() => this.context.resolveRecovery(sessionId)).catch((error: unknown) =>
          this.warn(sessionId, error)
        )
        share.leaseSettled = true
      }
      // Replayed in a background slot outside the chat's lane, and published before the pass: a
      // reader or a send never waits on the replay, and the lane is held only to publish and for
      // the pass's recheck and writes.
      if (!this.context.sessions.has(sessionId) && !(await this.load(sessionId, worker))) {
        return 'retire'
      }
      const held = this.awaitingReopenMark(sessionId)
      const pass = await this.context.serialize(sessionId, () =>
        runStructuredAgentSessionReconciliationPass(this.context, sessionId, worker.debts)
      )
      if (held && !this.awaitingReopenMark(sessionId)) {
        // The queue may send on its own again.
        this.context.publishGenerationEnded(sessionId)
      }
      // Closed while this attempt waited for the lane: the next one opens it again.
      if (pass.absent) {
        return 'again'
      }
      if (pass.failed.length > 0) {
        this.warn(sessionId, pass.failed[0])
        return 'failed'
      }
      return pass.wrote ? 'again' : 'retire'
    } catch (error) {
      this.warn(sessionId, error)
      return 'failed'
    }
  }

  private warn(sessionId: string, error: unknown): void {
    this.context.deps.logger.warn("settling a gone agent's leftover work did not finish", {
      scope: 'reconciliation',
      sessionId,
      error
    })
  }

  private async inSlot<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.slots.acquire(0)
    try {
      return await task()
    } finally {
      release()
    }
  }

  /** Replays the journal in a background slot, then publishes it; false when it has none. */
  private async load(sessionId: string, worker: ChatWorker): Promise<boolean> {
    const opened = await this.inSlot(async () => {
      // A replay is synchronous SQLite: a macrotask before each keeps a send or a read from waiting
      // behind a whole scan's worth of them.
      await yieldToEventLoop()
      return this.context.sessions.has(sessionId)
        ? null
        : restoreStructuredAgentSessionRead(this.context.deps, sessionId)
    })
    if (!opened) {
      // Open already, or no journal: nothing was ever written, so nothing is owed.
      return this.context.sessions.has(sessionId)
    }
    const replayed = opened
    // Published under the lane, so it never replaces a conversation a reader or a send opened
    // meanwhile; theirs is the conversation, and this replay is dropped.
    await this.context.serialize(sessionId, async () => {
      if (this.context.sessions.has(sessionId)) {
        await replayed.session.journal.close()
        return
      }
      await this.context.adopt(sessionId, replayed)
      worker.closeOnRetire = this.context.sessions.get(sessionId)
    })
    return true
  }

  private afterAttempt(
    sessionId: string,
    worker: ChatWorker,
    outcome: 'retire' | 'again' | 'failed'
  ): void {
    worker.running = false
    const attempted = worker.attempted.splice(0)
    attempted.forEach((resolve) => resolve())
    if (this.workers.get(sessionId) !== worker || this.disposed) {
      return
    }
    if (outcome === 'failed') {
      worker.failures += 1
      const delay = Math.min(
        RECONCILIATION_BACKOFF_MS.max,
        RECONCILIATION_BACKOFF_MS.first * 2 ** (worker.failures - 1)
      )
      this.schedule(sessionId, worker, delay)
      return
    }
    worker.failures = 0
    if (outcome === 'again' || worker.dirty) {
      this.schedule(sessionId, worker, 0)
      return
    }
    this.retire(sessionId, worker)
    // Only while it is still that conversation: a reader's reopen is theirs.
    if (worker.closeOnRetire && this.context.sessions.get(sessionId) === worker.closeOnRetire) {
      void this.context
        .closeAtRest(sessionId)
        .catch((error: unknown) => this.warn(sessionId, error))
    }
  }

  private schedule(sessionId: string, worker: ChatWorker, delay: number): void {
    if (delay === 0) {
      worker.timer = 'soon'
      queueMicrotask(() => this.attempt(sessionId))
      return
    }
    const timer = setTimeout(() => this.attempt(sessionId), delay)
    // A backoff alone never keeps the process alive.
    timer.unref?.()
    worker.timer = timer
  }

  private retire(sessionId: string, worker: ChatWorker): void {
    if (worker.timer && worker.timer !== 'soon') {
      clearTimeout(worker.timer)
    }
    worker.timer = null
    this.workers.delete(sessionId)
    if (!worker.running) {
      worker.attempted.splice(0).forEach((resolve) => resolve())
    }
  }
}
