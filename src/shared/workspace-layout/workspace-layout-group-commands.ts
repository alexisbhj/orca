// Commands on tab groups and the group split tree, built on the headless host's group moves so
// the runtime and today's headless host agree on the tree.

import type { TabGroupLayoutNode } from '../tab-types'
import { buildHeadlessTabGroupMove, buildHeadlessTabGroupSplit } from './tab-group-moves'
import { buildSplitNode, removeGroupLayoutLeaf, replaceLeaf } from './tab-group-layout-tree'
import { applied, findTab, refuse, type Applied } from './workspace-layout-command-steps'
import type { CommandOf, GroupSide, LayoutContext } from './workspace-layout-command-types'
import type { LayoutGroup, WorkspaceLayout, WorkspaceLayoutModel } from './workspace-layout-model'
import { withWorkspace } from './workspace-layout-removal'

function groupTreeOf(workspace: WorkspaceLayout): TabGroupLayoutNode | undefined {
  const first = workspace.groups[0]
  return workspace.groupLayout ?? (first ? { type: 'leaf', groupId: first.id } : undefined)
}

/** The moves keep each group's per-view selection out; only order and membership come back. */
function withGroups(
  workspace: WorkspaceLayout,
  groups: readonly { id: string; tabOrder: string[] }[],
  layout: TabGroupLayoutNode | null
): WorkspaceLayout {
  const byId = new Map(workspace.groups.map((group) => [group.id, group]))
  const next: WorkspaceLayout = {
    ...workspace,
    groups: groups.map((group): LayoutGroup => ({
      id: group.id,
      worktreeId: byId.get(group.id)?.worktreeId ?? workspace.groups[0]!.worktreeId,
      tabOrder: group.tabOrder
    }))
  }
  if (layout) {
    next.groupLayout = layout
  } else {
    delete next.groupLayout
  }
  return next
}

const asMoveGroups = (workspace: WorkspaceLayout) =>
  workspace.groups.map((group) => ({ id: group.id, activeTabId: null, tabOrder: group.tabOrder }))

export function moveTab(model: WorkspaceLayoutModel, command: CommandOf<'moveTab'>): Applied {
  const workspace = model.workspaces[command.workspace]!
  const source = workspace.groups.find((group) => group.tabOrder.includes(command.tabId))
  if (!findTab(workspace, command.tabId) || !source) {
    return refuse('tab_not_found')
  }
  if (!workspace.groups.some((group) => group.id === command.toGroupId)) {
    return refuse('group_not_found')
  }
  if (source.id === command.toGroupId) {
    const tabOrder = source.tabOrder.filter((id) => id !== command.tabId)
    tabOrder.splice(Math.max(0, Math.min(command.index, tabOrder.length)), 0, command.tabId)
    const groups = workspace.groups.map((group) =>
      group.id === source.id ? { ...group, tabOrder } : group
    )
    return applied(withWorkspace(model, command.workspace, { ...workspace, groups }))
  }
  const moved = buildHeadlessTabGroupMove({
    groups: asMoveGroups(workspace),
    layout: groupTreeOf(workspace),
    tabId: command.tabId,
    targetGroupId: command.toGroupId,
    index: command.index
  })!
  return applied(
    withWorkspace(model, command.workspace, withGroups(workspace, moved.groups, moved.layout))
  )
}

export function splitGroup(
  model: WorkspaceLayoutModel,
  command: CommandOf<'splitGroup'>,
  context: LayoutContext
): Applied {
  const workspace = model.workspaces[command.workspace]!
  if (
    !findTab(workspace, command.tabId) ||
    !workspace.groups.some((group) => group.tabOrder.includes(command.tabId))
  ) {
    return refuse('tab_not_found')
  }
  if (!workspace.groups.some((group) => group.id === command.besideGroupId)) {
    return refuse('group_not_found')
  }
  const source = workspace.groups.find((group) => group.tabOrder.includes(command.tabId))!
  if (source.tabOrder.length === 1 && source.id !== command.besideGroupId) {
    // A group's only tab moves with its group, so the group keeps its id (rule: ids never change).
    const { direction, position } = splitAxis(command.direction)
    const rest = removeGroupLayoutLeaf(groupTreeOf(workspace)!, source.id) ?? {
      type: 'leaf' as const,
      groupId: command.besideGroupId
    }
    const groupLayout = replaceLeaf(
      rest,
      command.besideGroupId,
      buildSplitNode(command.besideGroupId, source.id, direction, position)
    )
    return applied(withWorkspace(model, command.workspace, { ...workspace, groupLayout }), {
      groupId: source.id
    })
  }
  const split = buildHeadlessTabGroupSplit({
    groups: asMoveGroups(workspace),
    layout: groupTreeOf(workspace),
    tabId: command.tabId,
    targetGroupId: command.besideGroupId,
    splitDirection: command.direction,
    newGroupId: context.mintId()
  })
  if (!split) {
    // Splitting a group's only tab off itself would leave nothing behind.
    return refuse('invalid_params')
  }
  return applied(
    withWorkspace(model, command.workspace, withGroups(workspace, split.groups, split.layout)),
    {
      groupId: split.newGroupId
    }
  )
}

function splitAxis(side: GroupSide) {
  return {
    direction:
      side === 'left' || side === 'right' ? ('horizontal' as const) : ('vertical' as const),
    position: side === 'left' || side === 'up' ? ('first' as const) : ('second' as const)
  }
}

/** An empty group beside another; it is saved once a tab moves into it, as today. */
export function createGroup(
  model: WorkspaceLayoutModel,
  command: CommandOf<'createGroup'>,
  context: LayoutContext
): Applied {
  const workspace = model.workspaces[command.workspace]!
  const beside = workspace.groups.find((group) => group.id === command.besideGroupId)
  if (!beside) {
    return refuse('group_not_found')
  }
  const groupId = context.mintId()
  const { direction, position } = splitAxis(command.direction)
  const groupLayout = replaceLeaf(
    groupTreeOf(workspace)!,
    beside.id,
    buildSplitNode(beside.id, groupId, direction, position)
  )
  const group: LayoutGroup = { id: groupId, worktreeId: beside.worktreeId, tabOrder: [] }
  return applied(
    withWorkspace(model, command.workspace, {
      ...workspace,
      groups: [...workspace.groups, group],
      groupLayout
    }),
    { groupId }
  )
}

function sameGroupShape(left: TabGroupLayoutNode, right: TabGroupLayoutNode): boolean {
  if (left.type === 'leaf' || right.type === 'leaf') {
    return left.type === 'leaf' && right.type === 'leaf' && left.groupId === right.groupId
  }
  return (
    left.direction === right.direction &&
    sameGroupShape(left.first, right.first) &&
    sameGroupShape(left.second, right.second)
  )
}

export function setGroupRatios(
  model: WorkspaceLayoutModel,
  command: CommandOf<'setGroupRatios'>
): Applied {
  const workspace = model.workspaces[command.workspace]!
  const current = groupTreeOf(workspace)
  if (!current || !sameGroupShape(current, command.groupLayout)) {
    return refuse('group_set_changed')
  }
  return applied(
    withWorkspace(model, command.workspace, { ...workspace, groupLayout: command.groupLayout })
  )
}
