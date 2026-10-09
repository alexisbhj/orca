// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatVisualReadOutcome } from './native-chat-visual-read-client'

const read = vi.hoisted((): { next: NativeChatVisualReadOutcome; calls: number } => ({
  next: { ok: false, reason: 'unavailable' },
  calls: 0
}))

vi.mock('./native-chat-visual-read-client', () => ({
  peekCachedNativeChatVisual: () => null,
  isRetryableNativeChatVisualFailure: () => false,
  readNativeChatVisual: async () => {
    read.calls += 1
    return read.next
  }
}))

import { NativeChatVisualTab } from './NativeChatVisualTab'

const visual = {
  target: { kind: 'local' as const },
  sessionId: 'session-1',
  file: 'latency.html',
  title: 'Latency'
}

function ready(revision: string, html: string): NativeChatVisualReadOutcome {
  return { ok: true, document: { revision, html } }
}

function renderTab(isVisible: boolean, reloadNonce: number) {
  return <NativeChatVisualTab visual={visual} isVisible={isVisible} reloadNonce={reloadNonce} />
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  read.calls = 0
  read.next = ready('r1', '<p>first</p>')
})

afterEach(cleanup)

describe('NativeChatVisualTab', () => {
  it('re-asks the host when shown again but keeps the same page for an unchanged revision', async () => {
    const view = render(renderTab(true, 0))
    await waitFor(() => expect(view.container.querySelector('iframe')).not.toBeNull())
    const frame = view.container.querySelector('iframe')

    view.rerender(renderTab(false, 0))
    view.rerender(renderTab(true, 0))
    await settle()

    expect(read.calls).toBe(2)
    expect(view.container.querySelector('iframe')).toBe(frame)
  })

  it('shows the new page when a reopen finds a changed revision', async () => {
    const view = render(renderTab(true, 0))
    await waitFor(() => expect(view.container.querySelector('iframe')).not.toBeNull())

    read.next = ready('r2', '<p>second</p>')
    view.rerender(renderTab(true, 1))

    await waitFor(() =>
      expect(view.container.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
        '<p>second</p>'
      )
    )
    expect(read.calls).toBe(2)
  })

  it('recovers from unavailable when shown again after the host answers', async () => {
    read.next = { ok: false, reason: 'unavailable' }
    const view = render(renderTab(true, 0))
    await waitFor(() => expect(view.container.textContent).toContain('Visualization unavailable'))

    read.next = ready('r1', '<p>first</p>')
    view.rerender(renderTab(false, 0))
    view.rerender(renderTab(true, 0))

    await waitFor(() => expect(view.container.querySelector('iframe')).not.toBeNull())
  })
})
