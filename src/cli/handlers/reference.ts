import type {
  RuntimeReferenceFindResult,
  RuntimeReferenceListResult
} from '../../shared/runtime-reference-contracts'
import type { WorkspaceAttachment } from '../../shared/worktree/types'
import {
  getWorkspaceReferenceIdentity,
  parseWorkspaceReferenceQuery
} from '../../shared/workspace-reference-identity'
import type { CommandHandler, HandlerContext } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import { assertReferenceWritesSupported, parseReferenceUrls } from '../reference-input'
import { RuntimeClientError } from '../runtime-client'

function workspaceTarget({ flags, client, cwd }: HandlerContext, required = true) {
  const selector = required
    ? getRequiredStringFlag(flags, 'worktree')
    : getOptionalStringFlag(flags, 'worktree')
  if (selector !== 'current' && selector !== 'active') {
    return {
      worktree: selector,
      ...(!client.isRemote && selector?.startsWith('path:') ? { cwd } : {})
    }
  }
  if (client.isRemote) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${selector} is a local cwd shortcut. Pass an explicit worktree selector on the remote host.`
    )
  }
  return { worktree: 'current', cwd }
}

function label(item: WorkspaceAttachment): string {
  return (
    item.url ??
    item.identifier ??
    item.linearIdentifier ??
    item.jiraIdentifier ??
    `${item.provider}:${item.type}:${item.number}`
  )
}

function formatList(result: RuntimeReferenceListResult): string {
  return result.references.length
    ? result.references.map((item) => `${label(item)}\t${item.key}`).join('\n')
    : 'No linked references.'
}

function formatFind(result: RuntimeReferenceFindResult): string {
  const rows = result.matches.map(({ workspace, reference, agents }) => {
    const targets = agents.map(
      (agent) =>
        `  ${agent.linked ? 'linked' : 'workspace'} ${agent.liveness}${agent.terminal ? ` terminal=${agent.terminal}` : ''}${agent.mailbox ? ` mailbox=${agent.mailbox}` : ''}`
    )
    return [`${workspace.name}\t${workspace.id}\t${label(reference)}`, ...targets].join('\n')
  })
  if (result.truncated) {
    rows.push('More workspaces match. Increase --limit or narrow --repo/--worktree.')
  }
  return rows.join('\n') || 'No matching references.'
}

async function mutateReferences(context: HandlerContext, operation: 'add' | 'remove') {
  const { flags, client, json } = context
  const target = workspaceTarget(context)
  const input = parseReferenceUrls(getRepeatedStringFlag(flags, 'url'))
  const keys = operation === 'remove' ? getRepeatedStringFlag(flags, 'key') : []
  if (input.length === 0 && keys.length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      operation === 'add' ? 'Pass at least one full URL.' : 'Pass at least one full URL or --key.'
    )
  }
  await assertReferenceWritesSupported(client)
  const before = await client.call<RuntimeReferenceListResult>('reference.list', target)
  const base = before.result.references.map(({ key: _key, selected: _selected, ...item }) => item)
  const byKey = new Map(base.map((item) => [getWorkspaceReferenceIdentity(item), item]))
  const requestedKeys = new Set([...input.map(getWorkspaceReferenceIdentity), ...keys])
  const changes = [...requestedKeys].map((key) => {
    const changed = operation === 'add' ? !byKey.has(key) : byKey.has(key)
    return {
      key,
      operation,
      changed,
      ...(!changed ? { reason: operation === 'add' ? 'already_linked' : 'not_linked' } : {})
    }
  })
  if (changes.some((change) => change.changed)) {
    if (operation === 'add') {
      for (const item of input) {
        const key = getWorkspaceReferenceIdentity(item)
        if (!byKey.has(key)) {
          byKey.set(key, item)
        }
      }
    } else {
      for (const key of requestedKeys) {
        byKey.delete(key)
      }
    }
    const updates = {
      linkedItemsBase: base,
      linkedItems: [...byKey.values()],
      linkedItemsSelectionChanged: false
    }
    const { worktree } = before.result
    await (worktree.kind === 'folder'
      ? client.call('folderWorkspace.update', {
          folderWorkspaceId: worktree.id.slice('folder:'.length),
          updates
        })
      : client.call('worktree.set', {
          worktree: worktree.identity ? `identity:${worktree.identity.key}` : `id:${worktree.id}`,
          ...updates
        }))
  }
  const workspace = before.result.worktree
  const result = await client.call<RuntimeReferenceListResult>('reference.list', {
    worktree: workspace.identity ? `identity:${workspace.identity.key}` : `id:${workspace.id}`
  })
  printResult({ ...result, result: { ...result.result, changes } }, json, () =>
    changes
      .map(({ key, changed, reason }) => `${operation}\t${changed ? 'changed' : reason}\t${key}`)
      .join('\n')
  )
}

export const REFERENCE_HANDLERS: Record<string, CommandHandler> = {
  'reference list': async (context) => {
    const result = await context.client.call<RuntimeReferenceListResult>(
      'reference.list',
      workspaceTarget(context)
    )
    printResult(result, context.json, formatList)
  },
  'reference add': (context) => mutateReferences(context, 'add'),
  'reference remove': (context) => mutateReferences(context, 'remove'),
  'reference find': async (context) => {
    const query = getRequiredStringFlag(context.flags, 'query')
    try {
      parseWorkspaceReferenceQuery(query)
    } catch (error) {
      throw new RuntimeClientError(
        'invalid_argument',
        error instanceof Error ? error.message : 'Invalid reference query.'
      )
    }
    const target = workspaceTarget(context, false)
    const repo = getOptionalStringFlag(context.flags, 'repo')
    if (target.worktree && repo) {
      throw new RuntimeClientError('invalid_argument', 'Pass --worktree or --repo, not both.')
    }
    const result = await context.client.call<RuntimeReferenceFindResult>('reference.find', {
      query,
      ...target,
      repo,
      includeArchived: context.flags.get('include-archived') === true,
      limit: getOptionalPositiveIntegerFlag(context.flags, 'limit')
    })
    printResult(result, context.json, formatFind)
  }
}
