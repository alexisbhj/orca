import { useNativeHostSidebar } from './shell-switch-decision'

/** Natively: unless the desktop's page owns the host area. The page reads `init` instead. */
export function useHostSidebarDrawnHere(hostId: string): boolean {
  return useNativeHostSidebar(hostId)
}
