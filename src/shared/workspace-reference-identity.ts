import { parseJiraIssueUrl, JIRA_ISSUE_KEY_PATTERN } from './jira-issue-url'
import { parseLinearIssueInput, parseLinearIssueUrlIntent } from './linear/links'
import { getTaskSourceCacheScope } from './task-source-context'
import type { WorkspaceAttachment } from './worktree/types'

export type WorkspaceReferenceQuery =
  | { kind: 'url'; identity: string }
  | { kind: 'issue-key'; identifier: string }

function referenceUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Expected a full reference URL (https://…).')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Reference URLs must use HTTP or HTTPS and must not contain credentials.')
  }
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

function numberedReference(
  url: URL,
  provider: WorkspaceAttachment['provider'],
  type: WorkspaceAttachment['type'],
  path: string,
  rawNumber: string
): WorkspaceAttachment {
  const number = Number(rawNumber)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error('Reference numbers must be positive safe integers.')
  }
  url.pathname = `${path}/${number}`
  return { provider, type, number, url: url.href }
}

const HOST_PROVIDERS: Readonly<Record<string, WorkspaceAttachment['provider']>> = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'linear.app': 'linear',
  'codeberg.org': 'gitea',
  'bitbucket.org': 'bitbucket',
  'dev.azure.com': 'azure-devops'
}

export function parseWorkspaceReferenceUrl(
  input: string,
  providerHint?: WorkspaceAttachment['provider']
): WorkspaceAttachment {
  const url = referenceUrl(input)
  const knownProvider = HOST_PROVIDERS[url.hostname]
  const item = parseReferenceRoute(url, knownProvider ?? providerHint)
  if (
    (knownProvider && item.provider !== knownProvider) ||
    (providerHint && item.provider !== providerHint)
  ) {
    throw new Error('The reference URL does not match its provider.')
  }
  return item
}

function parseReferenceRoute(
  url: URL,
  providerHint?: WorkspaceAttachment['provider']
): WorkspaceAttachment {
  const linear = parseLinearIssueUrlIntent(url.href)
  if (linear) {
    url.pathname = `/${linear.organizationUrlKey.toLowerCase()}/issue/${linear.identifier}`
    return {
      provider: 'linear',
      type: 'issue',
      number: 0,
      identifier: linear.identifier,
      linearIdentifier: linear.identifier,
      linearOrganizationUrlKey: linear.organizationUrlKey.toLowerCase(),
      url: url.href
    }
  }
  const jira = parseJiraIssueUrl(url.href)
  if (jira) {
    url.pathname = `${jira.sitePath}/browse/${jira.issueKey}`
    return {
      provider: 'jira',
      type: 'issue',
      number: 0,
      identifier: jira.issueKey,
      jiraIdentifier: jira.issueKey,
      url: url.href
    }
  }
  const gitlab = /^(\/.+)\/-\/(merge_requests|issues)\/(\d+)(?:\/.*)?$/.exec(url.pathname)
  if (gitlab && url.hostname !== 'github.com' && url.hostname !== 'linear.app') {
    return numberedReference(
      url,
      'gitlab',
      gitlab[2] === 'issues' ? 'issue' : 'mr',
      `${gitlab[1]}/-/${gitlab[2]}`,
      gitlab[3]
    )
  }
  const azure = /^(\/.+\/_git\/[^/]+)\/pullrequest\/(\d+)(?:\/.*)?$/.exec(url.pathname)
  if (azure) {
    return numberedReference(url, 'azure-devops', 'pr', `${azure[1]}/pullrequest`, azure[2])
  }
  const bitbucket = /^(\/.+)\/pull-requests\/(\d+)(?:\/.*)?$/.exec(url.pathname)
  if (
    bitbucket &&
    (url.hostname === 'bitbucket.org' ||
      /\/projects\/[^/]+\/repos\/[^/]+$/.test(bitbucket[1]) ||
      providerHint === 'bitbucket')
  ) {
    return numberedReference(url, 'bitbucket', 'pr', `${bitbucket[1]}/pull-requests`, bitbucket[2])
  }
  const git = /^(\/[^/]+\/[^/]+)\/(pull|pulls|issues)\/(\d+)(?:\/.*)?$/.exec(url.pathname)
  if (git && url.hostname !== 'linear.app' && url.hostname !== 'gitlab.com') {
    const provider =
      url.hostname === 'github.com' || git[2] === 'pull'
        ? 'github'
        : url.hostname === 'codeberg.org' || git[2] === 'pulls'
          ? 'gitea'
          : url.hostname === 'bitbucket.org'
            ? 'bitbucket'
            : providerHint
    if (provider === 'github' || provider === 'gitea' || provider === 'bitbucket') {
      if (
        (git[2] === 'pulls' && provider !== 'gitea') ||
        (git[2] === 'pull' && provider !== 'github')
      ) {
        throw new Error('The reference URL does not match its provider.')
      }
      const path = provider === 'github' ? git[1].toLowerCase() : git[1]
      return numberedReference(
        url,
        provider,
        git[2] === 'issues' ? 'issue' : 'pr',
        `${path}/${git[2]}`,
        git[3]
      )
    }
  }
  throw new Error(
    'Unsupported reference URL. Use a PR, MR or issue URL with an identifiable provider route.'
  )
}

function externalUrl(item: WorkspaceAttachment): string | undefined {
  if (item.url) {
    return item.url
  }
  const identity = item.taskSourceContext?.providerIdentity
  const identifier = item.identifier ?? item.linearIdentifier ?? item.jiraIdentifier
  if (item.provider === 'linear' && item.linearOrganizationUrlKey && identifier) {
    return `https://linear.app/${encodeURIComponent(item.linearOrganizationUrlKey)}/issue/${encodeURIComponent(identifier)}`
  }
  if (!identity || identity.provider !== item.provider) {
    return undefined
  }
  switch (identity.provider) {
    case 'github':
      return `https://${identity.host ?? 'github.com'}/${identity.owner}/${identity.repo}/${item.type === 'pr' ? 'pull' : 'issues'}/${item.number}`
    case 'gitlab':
      return identity.webUrl
        ? `${identity.webUrl.replace(/\/+$/, '')}/-/${item.type === 'mr' ? 'merge_requests' : 'issues'}/${item.number}`
        : undefined
    case 'jira':
      return identity.siteUrl && identifier
        ? `${identity.siteUrl.replace(/\/+$/, '')}/browse/${identifier}`
        : undefined
    case 'linear':
      return undefined
  }
}

export function getWorkspaceReferenceIdentity(item: WorkspaceAttachment): string {
  const candidate = externalUrl(item)
  if (candidate) {
    try {
      const parsed = parseWorkspaceReferenceUrl(candidate, item.provider)
      const identifier = item.identifier ?? item.linearIdentifier ?? item.jiraIdentifier
      if (
        parsed.provider === item.provider &&
        parsed.type === item.type &&
        (parsed.identifier
          ? parsed.identifier === identifier?.toUpperCase()
          : parsed.number === item.number)
      ) {
        const url = new URL(parsed.url!)
        return JSON.stringify([parsed.provider, parsed.type, url.host, url.pathname])
      }
    } catch {
      // Legacy links without a provable source remain removable by their opaque key.
    }
  }
  return JSON.stringify([
    'legacy',
    item.provider,
    item.type,
    item.identifier ?? item.linearIdentifier ?? item.jiraIdentifier ?? item.number,
    item.taskSourceContext ? getTaskSourceCacheScope(item.taskSourceContext) : '',
    item.repoId ?? '',
    item.linearWorkspaceId ?? '',
    item.linearOrganizationUrlKey ?? '',
    item.url ?? ''
  ])
}

export function parseWorkspaceReferenceQuery(input: string): WorkspaceReferenceQuery {
  const value = input.trim()
  const linear = parseLinearIssueInput(value)
  if (JIRA_ISSUE_KEY_PATTERN.test(value) || (linear && !value.includes('://'))) {
    return { kind: 'issue-key', identifier: value.toUpperCase() }
  }
  return { kind: 'url', identity: getWorkspaceReferenceIdentity(parseWorkspaceReferenceUrl(value)) }
}

export function matchesWorkspaceReferenceQuery(
  item: WorkspaceAttachment,
  query: WorkspaceReferenceQuery
): boolean {
  if (query.kind === 'url') {
    return getWorkspaceReferenceIdentity(item) === query.identity
  }
  return (
    item.type === 'issue' &&
    (item.identifier ?? item.linearIdentifier ?? item.jiraIdentifier)?.toUpperCase() ===
      query.identifier
  )
}
