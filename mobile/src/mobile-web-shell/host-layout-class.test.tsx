import { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { useReportedHostArea, type HostLayoutClass } from './host-layout-class'

describe('a host-area session leaving the layout', () => {
  it("clears only its own report, never one another host's session made since", () => {
    const layout: { servedFor: string | null; report: HostLayoutClass['reportHostArea'] | null } = {
      servedFor: null,
      report: null
    }
    function Session({ hostId }: { hostId: string }) {
      useReportedHostArea(layout.report ?? (() => {}), hostId, true)
      return null
    }
    function Layout({ hosts }: { hosts: readonly string[] }) {
      const [servedFor, setServedFor] = useState<string | null>(null)
      layout.servedFor = servedFor
      layout.report = setServedFor
      return hosts.map((hostId) => <Session key={hostId} hostId={hostId} />)
    }
    const tree = create(<Layout hosts={[]} />)
    act(() => tree.update(<Layout hosts={['host-1']} />))
    act(() => tree.update(<Layout hosts={['host-1', 'host-2']} />))
    expect(layout.servedFor).toBe('host-2')
    act(() => tree.update(<Layout hosts={['host-2']} />))
    expect(layout.servedFor).toBe('host-2')
    act(() => tree.update(<Layout hosts={[]} />))
    expect(layout.servedFor).toBeNull()
  })
})
