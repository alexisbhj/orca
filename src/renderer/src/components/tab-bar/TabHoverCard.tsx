import { useContext, useRef, type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TabCardPlacementContext, TAB_TOOLTIP_SKIP_DELAY_MS } from './TabStripTooltipProvider'

export function TabHoverCard({
  children,
  title,
  icon,
  description
}: {
  children: ReactNode
  title: string
  icon: ReactNode
  description?: string
}): React.JSX.Element {
  const placement = useContext(TabCardPlacementContext)
  const content = useRef<HTMLDivElement>(null)

  const handlePlaced = (): void => {
    const element = content.current
    if (!element || !placement) {
      return
    }
    const rect = element.getBoundingClientRect()
    const previous = placement.current
    if (
      previous?.closedAt !== null &&
      previous?.closedAt !== undefined &&
      performance.now() - previous.closedAt < TAB_TOOLTIP_SKIP_DELAY_MS &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      // Continue from the painted position when reversing direction during a slide.
      const origin = previous.element.isConnected
        ? previous.element.getBoundingClientRect()
        : previous
      element.animate(
        [
          { translate: `${origin.left - rect.left}px ${origin.top - rect.top}px`, opacity: 1 },
          { translate: '0 0', opacity: 1 }
        ],
        { duration: 150, easing: 'ease-out' }
      )
    }
    placement.current = { element, left: rect.left, top: rect.top, closedAt: null }
  }

  return (
    <Tooltip
      onOpenChange={(open) => {
        if (!open && placement?.current?.element === content.current) {
          const rect = content.current?.getBoundingClientRect()
          if (rect) {
            placement.current.left = rect.left
            placement.current.top = rect.top
          }
          placement.current.closedAt = performance.now()
        }
      }}
    >
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        ref={content}
        variant="tab-preview"
        showArrow={false}
        side="bottom"
        align="start"
        sideOffset={6}
        onPlaced={handlePlaced}
        data-tab-hover-card="true"
      >
        <div className="flex items-start gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
            {icon}
          </span>
          <div className="min-w-0 flex-1 space-y-1 text-left">
            <div className="break-words font-medium">{title}</div>
            {description && <div className="break-all text-muted-foreground">{description}</div>}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
