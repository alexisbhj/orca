import { describe, expect, it } from 'vitest'
import {
  REMOTE_RUNTIME_DISCONNECTED_INPUT_GRACE_MS,
  createRemoteRuntimeDisconnectedInputGrace
} from './remote-runtime-disconnected-input-grace'

describe('disconnected input grace', () => {
  it('expires everything once the current latch outlives its grace', () => {
    let now = 0
    const grace = createRemoteRuntimeDisconnectedInputGrace(() => now)
    grace.start()
    now = REMOTE_RUNTIME_DISCONNECTED_INPUT_GRACE_MS - 1
    expect(grace.takeExpired()).toBeNull()
    now += 1
    expect(grace.takeExpired()).toBe('all')
    // Still latched past the grace: keeps refusing.
    expect(grace.takeExpired()).toBe('all')
  })

  it('charges each sealed cohort to the latch it was held through', () => {
    let now = 0
    const grace = createRemoteRuntimeDisconnectedInputGrace(() => now)
    grace.start()
    now = 100_000
    grace.seal(0)
    // A restart of the clock on a later latch must not extend the sealed cohort.
    now = 200_000
    grace.start()
    grace.start()
    now = 250_000
    grace.seal(1)
    now = REMOTE_RUNTIME_DISCONNECTED_INPUT_GRACE_MS
    expect(grace.takeExpired()).toBe(0)
    expect(grace.takeExpired()).toBeNull()
    now = 200_000 + REMOTE_RUNTIME_DISCONNECTED_INPUT_GRACE_MS
    expect(grace.takeExpired()).toBe(1)
  })

  it('forgets every grace on reset', () => {
    let now = 0
    const grace = createRemoteRuntimeDisconnectedInputGrace(() => now)
    grace.start()
    grace.seal(0)
    grace.start()
    grace.reset()
    now = 10 * REMOTE_RUNTIME_DISCONNECTED_INPUT_GRACE_MS
    expect(grace.takeExpired()).toBeNull()
  })
})
