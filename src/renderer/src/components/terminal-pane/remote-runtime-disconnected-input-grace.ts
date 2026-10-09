// Why bounded: a pane whose auto-recovery window ran out still reattaches the same terminal on its
// own (P1-3), so its held input waits for that, but never for an arbitrary later reconnect.
export const REMOTE_RUNTIME_DISCONNECTED_INPUT_GRACE_MS = 5 * 60_000

/** What outlived its grace: every held input, the cohorts through an id, or nothing. */
export type RemoteRuntimeDisconnectedInputExpiry = 'all' | number | null

/**
 * A latch opens the grace for input held so far; a retry from the latch seals that input with its
 * grace, so keys typed during the retry are only charged to a later latch. Only a recovered,
 * rebound or disposed pane resets it.
 * Why no timer: a latched pane must stay quiescent, so expiry is checked when input moves.
 */
export function createRemoteRuntimeDisconnectedInputGrace(now: () => number = Date.now): {
  start: () => void
  seal: (cohort: number) => void
  takeExpired: () => RemoteRuntimeDisconnectedInputExpiry
  reset: () => void
} {
  let openStartedAt: number | null = null
  // Ordered oldest first; later latches start later, so expiry always takes a prefix.
  let sealed: { cohort: number; startedAt: number }[] = []
  const isExpired = (startedAt: number): boolean =>
    now() - startedAt >= REMOTE_RUNTIME_DISCONNECTED_INPUT_GRACE_MS
  return {
    start() {
      openStartedAt ??= now()
    },
    seal(cohort) {
      if (openStartedAt !== null) {
        sealed.push({ cohort, startedAt: openStartedAt })
        openStartedAt = null
      }
    },
    takeExpired() {
      // Why kept open: a pane still latched past its grace must keep refusing to hold new input.
      if (openStartedAt !== null && isExpired(openStartedAt)) {
        sealed = []
        return 'all'
      }
      let through: number | null = null
      while (sealed.length > 0 && isExpired(sealed[0].startedAt)) {
        through = sealed[0].cohort
        sealed.shift()
      }
      return through
    },
    reset() {
      openStartedAt = null
      sealed = []
    }
  }
}
