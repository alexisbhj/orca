export type HostSidebarFacts = {
  hostId: string
  pathname: string
  /** The host whose host-area page is serving, reported by its shell screen. */
  hostAreaServedFor: string | null
}

/** Natively: everywhere except the host route while that host's page owns the area. Detail routes
 *  keep it, and a page there draws none (no init fact), so there is always exactly one. */
export function useHostSidebarDrawnHere(facts: HostSidebarFacts): boolean {
  return !(facts.pathname === `/h/${facts.hostId}` && facts.hostAreaServedFor === facts.hostId)
}
