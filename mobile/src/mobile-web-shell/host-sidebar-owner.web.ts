import { usePageBridgeClientIfPresent } from '../transport/client-context.web'
import type { HostSidebarFacts } from './host-sidebar-owner'

/** Only with the `ownsHostArea` init fact, never from width: a detail-pane page sits beside the
 *  shell's sidebar. Read in render: the page mounts after `init`. */
export function useHostSidebarDrawnHere(_facts: HostSidebarFacts): boolean {
  return usePageBridgeClientIfPresent()?.getShellSession()?.ownsHostArea === true
}
