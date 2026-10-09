// The one tab order from stored data whose three orders can disagree (written by older builds).
// Fixed precedence, no merging: group tab order, then tab-bar sortOrder, then row sortOrder, then
// creation time.

import type { TabGroup } from '../tab-types'
import type { LayoutGroup } from './workspace-layout-model'
import type { LayoutLoadNormalization } from './workspace-layout-load-types'

export type OrderCandidate = {
  id: string
  /** The group the tab-bar entry names, if any. */
  groupId?: string
  tabBarSortOrder?: number
  rowSortOrder?: number
  createdAt: number
}

function compareUnplaced(left: OrderCandidate, right: OrderCandidate): number {
  const leftOrder = left.tabBarSortOrder ?? left.rowSortOrder ?? Number.POSITIVE_INFINITY
  const rightOrder = right.tabBarSortOrder ?? right.rowSortOrder ?? Number.POSITIVE_INFINITY
  return leftOrder - rightOrder || left.createdAt - right.createdAt
}

export function resolveGroupOrder(args: {
  workspaceKey: string
  storedGroups: readonly TabGroup[]
  candidates: readonly OrderCandidate[]
  mintId: () => string
  normalizations: LayoutLoadNormalization[]
}): LayoutGroup[] {
  const { workspaceKey, normalizations } = args
  const known = new Set(args.candidates.map((candidate) => candidate.id))
  const placed = new Set<string>()
  const seenGroups = new Set<string>()
  const groups: LayoutGroup[] = []
  for (const stored of args.storedGroups) {
    if (seenGroups.has(stored.id)) {
      normalizations.push({ rule: 'duplicate_group_dropped', workspaceKey, ids: [stored.id] })
      continue
    }
    seenGroups.add(stored.id)
    const tabOrder: string[] = []
    for (const tabId of stored.tabOrder) {
      if (!known.has(tabId) || placed.has(tabId)) {
        normalizations.push({
          rule: known.has(tabId) ? 'tab_listed_twice' : 'group_lists_missing_tab',
          workspaceKey,
          ids: [stored.id, tabId]
        })
        continue
      }
      placed.add(tabId)
      tabOrder.push(tabId)
    }
    groups.push({ id: stored.id, tabOrder })
  }
  const unplaced = args.candidates.filter((candidate) => !placed.has(candidate.id))
  for (const candidate of [...unplaced].sort(compareUnplaced)) {
    let group = groups.find((entry) => entry.id === candidate.groupId) ?? groups[0]
    if (!group) {
      group = { id: args.mintId(), tabOrder: [] }
      groups.push(group)
      normalizations.push({ rule: 'group_minted', workspaceKey, ids: [group.id] })
    }
    group.tabOrder.push(candidate.id)
    normalizations.push({
      rule: 'tab_appended_to_group',
      workspaceKey,
      ids: [group.id, candidate.id]
    })
  }
  const kept = groups.filter((group) => group.tabOrder.length > 0)
  for (const group of groups) {
    if (group.tabOrder.length === 0) {
      normalizations.push({ rule: 'empty_group_dropped', workspaceKey, ids: [group.id] })
    }
  }
  return kept
}
