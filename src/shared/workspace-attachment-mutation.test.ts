import { describe, expect, it } from 'vitest'
import type { WorkspaceAttachment } from './worktree/types'
import {
  getWorkspaceAttachments,
  normalizeWorkspaceAttachmentUpdate
} from './workspace-attachments'

const legacy: WorkspaceAttachment = { provider: 'github', type: 'pr', number: 42 }
const foreign: WorkspaceAttachment = { ...legacy, url: 'https://github.com/foreign/repo/pull/42' }
const first = { kind: 'observed', tabId: 'first' } as const
const second = { kind: 'observed', tabId: 'second' } as const

describe('source-aware reference deltas', () => {
  it('retains an unknown-source link when adding a same-number foreign URL', () => {
    const original = { linkedPR: 42 }
    const base = getWorkspaceAttachments(original)
    const updated = normalizeWorkspaceAttachmentUpdate(original, {
      linkedItemsBase: base,
      linkedItems: [...base, foreign],
      linkedItemsSelectionChanged: false
    })
    expect(updated.linkedItems).toEqual([legacy, foreign])
    expect(getWorkspaceAttachments(updated)).toEqual([legacy, foreign])
    const removed = normalizeWorkspaceAttachmentUpdate(updated, {
      linkedItemsBase: updated.linkedItems,
      linkedItems: [legacy],
      linkedItemsSelectionChanged: false
    })
    expect(getWorkspaceAttachments(removed)).toEqual([legacy])
  })

  it('never transfers observations from an unproven source to a newly added URL', () => {
    const original = { linkedItems: [{ ...legacy, origins: [first] }] }
    const updated = normalizeWorkspaceAttachmentUpdate(original, {
      linkedItemsBase: original.linkedItems,
      linkedItems: [...original.linkedItems, foreign]
    })
    expect(updated.linkedItems).toEqual([{ ...legacy, origins: [first] }, foreign])
    expect(getWorkspaceAttachments(updated)).toEqual(updated.linkedItems)
  })

  it('deduplicates concurrent canonical additions despite different local repository IDs', () => {
    const current = { ...foreign, repoId: 'repo-a', title: 'Fresh', origins: [first] }
    const incoming = { ...foreign, repoId: 'repo-b', origins: [second] }
    const updated = normalizeWorkspaceAttachmentUpdate(
      { linkedItems: [current] },
      {
        linkedItemsBase: [],
        linkedItems: [incoming]
      }
    )
    expect(updated.linkedItems).toEqual([{ ...current, origins: [first, second] }])
  })

  it('does not resurrect canonical links removed during metadata enrichment', () => {
    const updated = normalizeWorkspaceAttachmentUpdate(
      { linkedItems: [] },
      {
        linkedItemsBase: [{ ...foreign, repoId: 'repo-a' }],
        linkedItems: [{ ...foreign, repoId: 'repo-b' }]
      }
    )
    expect(updated.linkedItems).toEqual([])
  })

  it('deduplicates stored canonical references and merges their observations', () => {
    expect(
      getWorkspaceAttachments({
        linkedItems: [
          { ...foreign, repoId: 'repo-a', origins: [first] },
          { ...foreign, repoId: 'repo-b', origins: [second] }
        ]
      })
    ).toEqual([{ ...foreign, repoId: 'repo-b', origins: [first, second] }])
  })

  it('does not duplicate rich compatibility links whose local context differs', () => {
    expect(
      getWorkspaceAttachments({
        linkedItems: [foreign],
        linkedWorkItem: { ...foreign, provider: 'github', title: 'Foreign', url: foreign.url! },
        linkedTaskSourceContext: {
          kind: 'task-source',
          provider: 'github',
          projectId: 'project',
          hostId: 'local',
          providerIdentity: { provider: 'github', owner: 'foreign', repo: 'repo' }
        }
      })
    ).toEqual([foreign])
  })

  it('retains explicit unknown sources through a full collection write', () => {
    const updated = normalizeWorkspaceAttachmentUpdate(
      { linkedPR: 42 },
      { linkedItems: [legacy, foreign] }
    )
    expect(getWorkspaceAttachments(updated)).toEqual([legacy, foreign])
  })

  it('does not collapse explicit unknown sources on unrelated scalar writes', () => {
    const updated = normalizeWorkspaceAttachmentUpdate(
      { linkedItems: [legacy, foreign] },
      { linkedPR: 99 }
    )
    expect(getWorkspaceAttachments(updated)).toEqual([legacy, foreign, { ...legacy, number: 99 }])
  })
})
