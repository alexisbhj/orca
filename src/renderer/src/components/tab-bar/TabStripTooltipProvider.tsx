import { createContext, useRef, type ReactNode, type RefObject } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'

export const TAB_TOOLTIP_DELAY_MS = 500
export const TAB_TOOLTIP_SKIP_DELAY_MS = 300

type TabCardPlacement = {
  element: HTMLElement
  left: number
  top: number
  closedAt: number | null
}

export const TabCardPlacementContext = createContext<RefObject<TabCardPlacement | null> | null>(
  null
)

export function TabStripTooltipProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const placement = useRef<TabCardPlacement | null>(null)
  return (
    <TabCardPlacementContext.Provider value={placement}>
      <TooltipProvider
        delayDuration={TAB_TOOLTIP_DELAY_MS}
        skipDelayDuration={TAB_TOOLTIP_SKIP_DELAY_MS}
      >
        {children}
      </TooltipProvider>
    </TabCardPlacementContext.Provider>
  )
}
