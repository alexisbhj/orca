import { WorkspaceDetailPlaceholder } from '../../../src/components/WorkspaceDetailPlaceholder'
import { HostScreen } from '../../../src/host-screen/HostScreen'
import { useResponsiveLayout } from '../../../src/layout/responsive-layout'
import { useHostSidebarDrawnHere } from '../../../src/mobile-web-shell/host-sidebar-owner'

/**
 * Web sibling for the worktree list.
 *
 * This page is what the shell renders for this route, so there is no shell to mount here and no
 * flag to read: the switch already happened natively. Its native file also reaches
 * OrcaMobileWebShellView, whose module calls requireNativeViewManager at import and throws in a
 * browser, and one throwing route module takes the whole bundle down because the manifest imports
 * them all.
 */
export default function HostWorktreeRoute() {
  const { isWideLayout } = useResponsiveLayout()
  // The placeholder only beside the page's own sidebar: without the host area this is the list.
  const sidebarHere = useHostSidebarDrawnHere('')
  if (isWideLayout && sidebarHere) {
    return <WorkspaceDetailPlaceholder />
  }
  return <HostScreen />
}
