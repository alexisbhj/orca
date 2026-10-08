import React from 'react'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { StatusBarUsageMode } from '../../../../shared/status-bar-usage-mode'
import type { UsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import { translate } from '@/i18n/i18n'
import { isVisibleStatusBarBucket } from './StatusBarProviderSegment'
import { getTightestUsageSection, getUsageHeadlineSection } from './UsageRosterPanel'

export type UsageUnitLabelState = 'absent' | 'collapsed' | 'shown'

/** Mirrors `ProviderSegment`'s branching: true when the chip renders at least one percentage. */
export function usageChipShowsPercentage(
  p: ProviderRateLimits | null,
  mode: StatusBarUsageMode
): boolean {
  if (!p || p.status === 'idle' || p.status === 'unavailable') {
    return false
  }
  const headline = mode === 'compact' ? getUsageHeadlineSection(p) : getTightestUsageSection(p)
  if (!headline) {
    return false
  }
  if (mode === 'verbose' && p.buckets && p.buckets.length > 0) {
    return (
      p.buckets.some((bucket) => isVisibleStatusBarBucket(bucket.name, p.provider)) ||
      Boolean(p.session ?? p.monthly ?? p.weekly)
    )
  }
  return true
}

export function getUsageUnitLabelState(
  providers: readonly ProviderRateLimits[],
  collapsedProviders: readonly string[],
  mode: StatusBarUsageMode
): UsageUnitLabelState {
  const withPercentage = providers.filter((p) => usageChipShowsPercentage(p, mode))
  if (withPercentage.length === 0) {
    return 'absent'
  }
  return withPercentage.every((p) => collapsedProviders.includes(p.provider))
    ? 'collapsed'
    : 'shown'
}

/** States the used/remaining unit once for the row; stays mounted while collapsed so density measuring stays stable. */
export function UsageUnitLabel({
  collapsed,
  display
}: {
  collapsed: boolean
  display: UsagePercentageDisplay
}): React.JSX.Element {
  return (
    <span
      data-usage-unit
      data-usage-collapsed={collapsed}
      aria-hidden={collapsed}
      className="text-muted-foreground data-[usage-collapsed=true]:invisible data-[usage-collapsed=true]:absolute"
    >
      {display === 'used'
        ? translate('auto.components.status.bar.usageUnitLabel.used', 'Used')
        : translate('auto.components.status.bar.usageUnitLabel.remaining', 'Remaining')}
    </span>
  )
}
