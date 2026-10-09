import { usePageBridgeClientIfPresent } from '../transport/client-context.web'

/** Only with the `ownsHostArea` init fact, never from width: a detail-pane page sits beside the
 *  shell's sidebar. Read in render: the page mounts after `init`. */
export function useHostSidebarDrawnHere(_hostId: string): boolean {
  return usePageBridgeClientIfPresent()?.getShellSession()?.ownsHostArea === true
}
