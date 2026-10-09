import { describe, expect, it } from 'vitest'
import { applyLayoutCommand } from './workspace-layout-commands'
import type { LayoutCommand, LayoutContext } from './workspace-layout-command-types'
import {
  build,
  emptyModel,
  terminalTab,
  testContext,
  WS,
  asLoaded
} from './workspace-layout-command.test-fixture'
import type { WorkspaceLayoutModel } from './workspace-layout-model'
import { checkWorkspaceLayoutModelRules } from './workspace-layout-model-rules'
import { moveWorkspaceToPartition } from './workspace-layout-owner-transitions'
import { applyLayoutTransition, type LayoutTransition } from './workspace-layout-transitions'

/** One terminal tab split in two, the first pane running `pty-1`. */
function setup() {
  const context = testContext()
  const created = build(context, [{ type: 'createTerminalTab', workspace: WS }])
  const { tabId, leafId, paneKey } = created.results[0]!
  const split = build(
    context,
    [{ type: 'splitPane', workspace: WS, tabId: tabId!, leafId: leafId!, direction: 'vertical' }],
    created.model
  )
  const started = applyLayoutTransition(
    split.model,
    {
      type: 'processStarted',
      workspace: WS,
      paneKey: paneKey!,
      ptyId: 'pty-1',
      incarnationId: 'inc-1'
    },
    context
  )
  if (!started.ok) {
    throw new Error(started.code)
  }
  return {
    context,
    model: started.model,
    tabId: tabId!,
    leafId: leafId!,
    leaf2: split.results[0]!.leafId!
  }
}

const leavesOf = (model: WorkspaceLayoutModel, tabId: string) =>
  model.workspaces[WS]!.tabs.some((tab) => tab.id === tabId)
    ? terminalTab(model, tabId).panes?.ptyIdsByLeafId
    : 'closed'

describe('layout transitions', () => {
  it('binds a started terminal once and refuses binding it to a second pane', () => {
    const { model, context, tabId, leafId, leaf2 } = setup()
    expect(leavesOf(model, tabId)).toEqual({ [leafId]: 'pty-1' })
    expect(model.records.incarnationsByPaneKey).toEqual({ [`${tabId}:${leafId}`]: 'inc-1' })
    const twice = applyLayoutTransition(
      model,
      {
        type: 'processStarted',
        workspace: WS,
        paneKey: `${tabId}:${leaf2}`,
        ptyId: 'pty-1',
        incarnationId: 'inc-1'
      },
      context
    )
    expect(twice).toEqual({ ok: false, code: 'pane_already_bound' })
    const missing = applyLayoutTransition(
      model,
      { type: 'processStarted', workspace: WS, paneKey: `${tabId}:nope`, ptyId: 'pty-9' },
      context
    )
    expect(missing).toEqual({ ok: false, code: 'pane_not_found' })
  })

  it('retires an exited pane only while it still shows that terminal and incarnation', () => {
    const { model, context, tabId, leafId } = setup()
    const surface = { worktreeId: WS, terminalTabId: tabId, leafId, ptyId: 'pty-1' }
    const stale: LayoutTransition = {
      type: 'processExited',
      surface: { ...surface, incarnationId: 'inc-old' }
    }
    const other: LayoutTransition = {
      type: 'processExited',
      surface: { ...surface, ptyId: 'pty-other' }
    }
    for (const transition of [stale, other]) {
      const result = applyLayoutTransition(model, transition, context)
      expect(result.ok && leavesOf(result.model, tabId)).toEqual({ [leafId]: 'pty-1' })
    }
    const exited = applyLayoutTransition(
      model,
      { type: 'processExited', surface: { ...surface, incarnationId: 'inc-1' } },
      context
    )
    expect(exited.ok && exited.model.records.incarnationsByPaneKey).toEqual({})
    expect(exited.ok && terminalTab(exited.model, tabId).panes!.root).toEqual({
      type: 'leaf',
      leafId: expect.any(String)
    })
  })

  it('unbinds panes whose SSH lease ended without closing them', () => {
    const { model, context, tabId } = setup()
    const result = applyLayoutTransition(
      model,
      { type: 'sshLeaseTerminated', ptyIds: ['pty-1'] },
      context
    )
    expect(result.ok && leavesOf(result.model, tabId)).toEqual({})
  })

  it('adopts an orphan terminal into a new bound tab', () => {
    const context = testContext()
    const result = applyLayoutTransition(
      emptyModel(),
      { type: 'orphanAdopted', workspace: WS, ptyId: 'orphan-1' },
      context
    )
    expect(result.ok && checkWorkspaceLayoutModelRules([asLoaded(result.model)])).toEqual([])
    expect(result.ok && leavesOf(result.model, result.result.tabId!)).toEqual({
      [result.ok ? result.result.leafId! : '']: 'orphan-1'
    })
  })

  it('removes, renames and rehomes a workspace with the records that name it', () => {
    const { model, context, tabId, leafId } = setup()
    const renamed = applyLayoutTransition(
      model,
      { type: 'identityRenamed', from: WS, to: 'repo-1::/renamed' },
      context
    )
    expect(renamed.ok && Object.keys(renamed.model.workspaces)).toEqual(['repo-1::/renamed'])
    expect(renamed.ok && renamed.model.workspaces['repo-1::/renamed']!.worktreeId).toBe(
      'repo-1::/renamed'
    )
    const occupied = build(
      context,
      [{ type: 'createTerminalTab', workspace: 'repo-1::/other' }],
      model
    ).model
    expect(
      applyLayoutTransition(
        occupied,
        { type: 'identityRenamed', from: WS, to: 'repo-1::/other' },
        context
      )
    ).toEqual({ ok: false, code: 'workspace_exists' })
    const removed = applyLayoutTransition(
      model,
      { type: 'ownerRemoved', workspaces: [WS] },
      context
    )
    expect(removed.ok && removed.model.workspaces).toEqual({})
    expect(removed.ok && removed.model.records.incarnationsByPaneKey).toEqual({})
    const moved = moveWorkspaceToPartition(model, { ...emptyModel(), hostId: 'ssh:target-1' }, WS)
    expect(Object.keys(moved.from.workspaces)).toEqual([])
    expect(moved.to.records.incarnationsByPaneKey).toEqual({ [`${tabId}:${leafId}`]: 'inc-1' })
  })

  it('records and clears an agent launch verdict on its tab', () => {
    const { model, context, tabId, leafId } = setup()
    const set = applyLayoutTransition(
      model,
      {
        type: 'agentLaunchVerdict',
        workspace: WS,
        tabId,
        agentLaunchPane: { leafId, operationId: 'op-1' }
      },
      context
    )
    expect(set.ok && terminalTab(set.model, tabId).terminal.agentLaunchPane).toEqual({
      leafId,
      operationId: 'op-1'
    })
    const cleared =
      set.ok &&
      applyLayoutTransition(
        set.model,
        { type: 'agentLaunchVerdict', workspace: WS, tabId, agentLaunchPane: null },
        context
      )
    expect(
      cleared && cleared.ok && terminalTab(cleared.model, tabId).terminal.agentLaunchPane
    ).toBeUndefined()
    expect(
      applyLayoutTransition(
        model,
        { type: 'agentLaunchVerdict', workspace: WS, tabId: 'nope', agentLaunchPane: null },
        context
      )
    ).toEqual({ ok: false, code: 'tab_not_found' })
  })
})

/** Two clients' commands for the same tab or pane: both arrival orders end in a valid layout. */
describe('concurrent commands, both orders', () => {
  type Step = { command: LayoutCommand } | { transition: LayoutTransition }
  type Run = { model: WorkspaceLayoutModel; codes: string[] }
  function run(model: WorkspaceLayoutModel, steps: Step[], context: LayoutContext): Run {
    let next = model
    const codes: string[] = []
    for (const step of steps) {
      const result =
        'command' in step
          ? applyLayoutCommand(next, step.command, context)
          : applyLayoutTransition(next, step.transition, context)
      codes.push(result.ok ? 'ok' : result.code)
      if (result.ok) {
        expect(checkWorkspaceLayoutModelRules([asLoaded(result.model)], [asLoaded(next)])).toEqual(
          []
        )
        next = result.model
      }
    }
    return { model: next, codes }
  }

  it('close tab vs split pane', () => {
    const { model, tabId, leafId, context } = setup()
    const close: Step = { command: { type: 'closeTabs', workspace: WS, tabIds: [tabId] } }
    const split: Step = {
      command: { type: 'splitPane', workspace: WS, tabId, leafId, direction: 'horizontal' }
    }
    expect(run(model, [close, split], context).codes).toEqual(['ok', 'tab_not_found'])
    const splitFirst = run(model, [split, close], context)
    expect(splitFirst.codes).toEqual(['ok', 'ok'])
    expect(leavesOf(splitFirst.model, tabId)).toBe('closed')
  })

  it('close pane vs drag the pane out', () => {
    const { model, tabId, leafId, context } = setup()
    const close: Step = { command: { type: 'closePane', workspace: WS, tabId, leafId } }
    const drag: Step = { command: { type: 'movePaneToNewTab', workspace: WS, tabId, leafId } }
    expect(run(model, [close, drag], context).codes).toEqual(['ok', 'pane_not_found'])
    const dragFirst = run(model, [drag, close], context)
    expect(dragFirst.codes).toEqual(['ok', 'ok'])
    // The close found nothing in the old tab: the dragged pane keeps running in its new tab.
    expect(
      dragFirst.model.workspaces[WS]!.tabs.some(
        (tab) => tab.kind === 'terminal' && tab.panes?.ptyIdsByLeafId?.[leafId] === 'pty-1'
      )
    ).toBe(true)
  })

  it('process exit vs close tab', () => {
    const { model, tabId, leafId, context } = setup()
    const exit: Step = {
      transition: {
        type: 'processExited',
        surface: { worktreeId: WS, terminalTabId: tabId, leafId, ptyId: 'pty-1' }
      }
    }
    const close: Step = { command: { type: 'closeTabs', workspace: WS, tabIds: [tabId] } }
    for (const order of [
      [exit, close],
      [close, exit]
    ]) {
      const result = run(model, order, context)
      expect(result.codes).toEqual(['ok', 'ok'])
      expect(leavesOf(result.model, tabId)).toBe('closed')
    }
  })
})
