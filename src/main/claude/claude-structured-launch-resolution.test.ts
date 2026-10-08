import {
  IDENTITY,
  SESSION_ID,
  record,
  resolverFor,
  identityAt,
  makeExecutable
} from './claude-structured-launch-resolution.test-fixture'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import {
  CLAUDE_DEFAULT_SETTING_SOURCES,
  CLAUDE_SESSION_STATE_EVENTS_ENV,
  CLAUDE_STRUCTURED_BASE_OPTIONS,
  claudeSessionIdForOrcaSession,
  createClaudeStructuredLaunchResolver
} from './claude-structured-launch-resolution'
import { claudeProviderHandle } from '../../shared/agent-session-provider-handle-encoding'

const RESUMABLE = record({
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only each link's handle, so the link's other fields stay unset.
  providerHandleChain: [
    { handle: claudeProviderHandle('provider-current', 'leaf-current') }
  ] as AgentSessionRecord['providerHandleChain']
})

describe('claude structured launch resolution', () => {
  it('resumes a floating session in its pinned folder, not the current floating setting', async () => {
    const pinned = mkdtempSync(join(tmpdir(), 'orca-claude-floating-'))
    const floating = record({
      location: { ...record().location, workspaceId: FLOATING_TERMINAL_WORKTREE_ID },
      launchDirectory: pinned
    })

    const launch = await resolverFor(floating)({ identity: IDENTITY })

    // resolverFor answers `/repos/<id>` — the current setting — which a pinned resume must ignore.
    expect(launch.cwd).toBe(pinned)
  })

  it('pre-mints a stable provider id and pins interactive setting sources', async () => {
    const first = await resolverFor(record())({ identity: IDENTITY })
    const second = await resolverFor(record())({ identity: IDENTITY })

    expect(first.providerSessionId).toBe(claudeSessionIdForOrcaSession(SESSION_ID))
    expect(second.providerSessionId).toBe(first.providerSessionId)
    expect(first).toMatchObject({
      pathToClaudeCodeExecutable: '/usr/local/bin/claude',
      cwd: '/repos/workspace-1',
      claudeConfigDir: '/home/work/.claude',
      resumeLeafUuid: null,
      resumesTranscript: false,
      continuesChain: false
    })
    expect(first.options).toEqual({
      includePartialMessages: true,
      permissionMode: 'default',
      settingSources: [...CLAUDE_DEFAULT_SETTING_SOURCES],
      supportedDialogKinds: [],
      extraArgs: { 'replay-user-messages': null },
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      sessionId: first.providerSessionId
    })
    expect(first.options.resume).toBeUndefined()
    expect(CLAUDE_STRUCTURED_BASE_OPTIONS.includePartialMessages).toBe(true)
    expect(first.env).toMatchObject({ [CLAUDE_SESSION_STATE_EVENTS_ENV]: '1' })
  })

  it('resumes the durable chain head by session id and carries its leaf as bookkeeping', async () => {
    const launch = await resolverFor(
      record({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only each link's handle, so the link's other fields stay unset.
        providerHandleChain: [
          { handle: claudeProviderHandle('provider-old', 'leaf-old') },
          {
            handle: claudeProviderHandle('provider-current', 'leaf-current')
          }
        ] as AgentSessionRecord['providerHandleChain']
      })
    )({ identity: identityAt('leaf-current') })

    expect(launch).toMatchObject({
      providerSessionId: 'provider-current',
      resumeLeafUuid: 'leaf-current',
      resumesTranscript: true,
      continuesChain: true
    })
    expect(launch.options.resume).toBe('provider-current')
    // Claude owns where the conversation continues; a stored leaf would cut or branch it.
    expect(launch.options).not.toHaveProperty('resumeSessionAt')
    expect(launch.options.sessionId).toBeUndefined()
  })

  it('names the child by the Orca session id, over any id the configured overlay carries', async () => {
    // The Orca-minted id, never the provider's: the provider id rotates on /clear.
    const launch = await resolverFor(record(), () => ({
      ORCA_AGENT_SESSION_ID: 'a0b1c2d3-0000-4000-8000-00000000abcd'
    }))({ identity: IDENTITY })

    expect(launch.env).toMatchObject({
      ORCA_AGENT_SESSION_ID: SESSION_ID,
      ORCA_CLI_COMMAND: expect.stringMatching(/^[^:;]*[\\/]cli[\\/]bin[\\/]orca-dev$/)
    })
    expect(launch.env?.ORCA_AGENT_SESSION_ID).not.toBe(launch.providerSessionId)
  })

  it('forces session-state events on when the inherited overlay disables them', async () => {
    const launch = await resolverFor(record(), () => ({
      [CLAUDE_SESSION_STATE_EVENTS_ENV]: '0'
    }))({ identity: IDENTITY })

    expect(launch.env).toMatchObject({ [CLAUDE_SESSION_STATE_EVENTS_ENV]: '1' })
  })

  it('launches when only the bookkeeping leaf moved, and refuses a changed session', async () => {
    const resolve = resolverFor(RESUMABLE)

    // A failed turn-end or exit write leaves the identity's leaf behind the record's.
    await expect(resolve({ identity: identityAt('leaf-stale') })).resolves.toMatchObject({
      providerSessionId: 'provider-current',
      resumeLeafUuid: 'leaf-current'
    })
    await expect(
      resolve({
        identity: {
          ...IDENTITY,
          providerHandle: claudeProviderHandle('provider-other', 'leaf-current')
        }
      })
    ).rejects.toThrow('durable resume identity changed before spawn')
  })

  it('keeps session-only resume when the durable handle has no leaf', async () => {
    const launch = await resolverFor(
      record({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only each link's handle, so the link's other fields stay unset.
        providerHandleChain: [
          {
            handle: claudeProviderHandle('provider-current', null)
          }
        ] as AgentSessionRecord['providerHandleChain']
      })
    )({ identity: identityAt(null) })

    expect(launch.options.resume).toBe('provider-current')
    expect(launch.options).not.toHaveProperty('resumeSessionAt')
  })

  it('launches a leafless head fresh under its own id when Claude never wrote its transcript', async () => {
    // A start that failed before its first turn: `--resume` would exit "No conversation found".
    const hasTranscript = vi.fn(async () => false)
    const launch = await resolverFor(
      record({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only each link's handle.
        providerHandleChain: [
          { handle: claudeProviderHandle('provider-current', null) }
        ] as AgentSessionRecord['providerHandleChain']
      }),
      undefined,
      false,
      hasTranscript
    )({ identity: identityAt(null) })

    expect(hasTranscript).toHaveBeenCalledWith({
      providerSessionId: 'provider-current',
      claudeConfigDir: expect.any(String)
    })
    expect(launch.options.resume).toBeUndefined()
    expect(launch.options.sessionId).toBe('provider-current')
    expect(launch).toMatchObject({
      providerSessionId: 'provider-current',
      resumeLeafUuid: null,
      resumesTranscript: false,
      // Launching the id fresh does not start a new conversation: the child continues the chain.
      continuesChain: true
    })
  })

  it('re-reads saved Arguments after a refusal and on resume instead of using a stale record', async () => {
    let args = ['--model', 'one', '--model', 'two']
    const resolve = resolverFor(
      record({ ...RESUMABLE, launchArgs: ['--model', 'stale'] }),
      undefined,
      false,
      async () => true,
      () => args
    )
    await expect(resolve({ identity: identityAt('leaf-current') })).rejects.toThrow(/Arguments/)
    args = ['--effort', 'high']
    expect((await resolve({ identity: identityAt('leaf-current') })).options.extraArgs).toEqual({
      effort: 'high',
      'replay-user-messages': null
    })
    args = []
    expect((await resolve({ identity: identityAt('leaf-current') })).options.extraArgs).toEqual({
      'replay-user-messages': null
    })
  })

  it('passes configured arguments when resuming a transcript', async () => {
    const launch = await resolverFor(
      record({
        ...RESUMABLE,
        launchArgs: [
          '--effort',
          'high',
          '-r',
          'wrong-session',
          '--add-dir',
          '/one',
          '/two',
          '--add-dir',
          '/three'
        ]
      })
    )({ identity: identityAt('leaf-current') })

    expect(launch.options.resume).toBe('provider-current')
    expect(launch.options.additionalDirectories).toEqual(['/one', '/two', '/three'])
    expect(launch.options.extraArgs).toEqual({
      effort: 'high',
      'replay-user-messages': null
    })
  })

  it('pairs a resolved Claude CLI with its sibling Node runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-claude-launch-'))
    const binDir = join(root, 'bin')
    const claudeCommand = join(binDir, process.platform === 'win32' ? 'claude.cmd' : 'claude')
    const nodeCommand = join(binDir, process.platform === 'win32' ? 'node.cmd' : 'node')
    makeExecutable(claudeCommand)
    makeExecutable(nodeCommand)

    const launch = await createClaudeStructuredLaunchResolver({
      resolveLaunchArgs: () => [],
      store: { getRecord: () => record(), pinLaunchDirectory: vi.fn() },
      resolveWorkspacePath: async (id) => `/repos/${id}`,
      resolveCommand: () => claudeCommand,
      resolveAuthPolicy: () => ({ stripAuthEnv: false }),
      resolveEnv: () => ({
        PATH: '/usr/bin',
        CLAUDE_CONFIG_DIR: '/accounts/selected/home'
      })
    })({ identity: IDENTITY })

    expect((launch.env?.PATH ?? launch.env?.Path)?.split(delimiter)[0]).toBe(binDir)
  })

  it('refuses other hosts, WSL, providers, and account-home variables', async () => {
    await expect(
      resolverFor(record({ location: { ...record().location, executionHostId: 'ssh:build' } }))({
        identity: IDENTITY
      })
    ).rejects.toThrow(/local host/)
    await expect(
      resolverFor(record({ location: { ...record().location, wslDistro: 'Ubuntu' } }))({
        identity: IDENTITY
      })
    ).rejects.toThrow(/local host/)
    await expect(
      resolverFor(record({ provider: 'codex' } as Partial<AgentSessionRecord>))({
        identity: IDENTITY
      })
    ).rejects.toThrow(/codex session/)
    await expect(
      resolverFor(record({ accountHome: { variable: 'CODEX_HOME', path: '/tmp/codex' } }))({
        identity: IDENTITY
      })
    ).rejects.toThrow(/CLAUDE_CONFIG_DIR/)
  })
})
