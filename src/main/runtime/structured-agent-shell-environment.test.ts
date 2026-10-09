import { describe, expect, it, vi } from 'vitest'
import * as loginShell from '../startup/login-shell-environment'
import type * as runProcessModule from '../../shared/child-process/run-process'
import { __resetPersistedWindowsPathCacheForTests } from '../pty/windows-environment-path'
import { __setWindowsPathRegistryLoaderForTests } from '../pty/windows-path-registry-reader'
import {
  createStructuredAgentEnvironmentResolvers,
  structuredAgentBaseEnvironment
} from './structured-agent-shell-environment'

const { runProcessMock } = vi.hoisted(() => ({ runProcessMock: vi.fn() }))

vi.mock('../../shared/child-process/run-process', async (importOriginal) => ({
  ...(await importOriginal<typeof runProcessModule>()),
  runProcess: runProcessMock
}))

const INHERIT_ALL = { inheritAll: true, names: [] }

/** The value if the promise settles without any timer firing; undefined if it is still waiting. */
async function settledWithoutWaiting<T>(promise: Promise<T>): Promise<T | undefined> {
  let value: T | undefined
  void promise.then((resolved) => {
    value = resolved
  })
  await vi.advanceTimersByTimeAsync(0)
  return value
}

const shellEnv = {
  PATH: '/shell/bin',
  LANG: 'en_US.UTF-8',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  CODEX_LB_API_KEY: 'lb-key',
  ANTHROPIC_API_KEY: 'shell-key',
  CLAUDE_CONFIG_DIR: '/shell/claude',
  UNSET: undefined
}

const processEnv = { PATH: '/orca/bin', HOME: '/home/me', ORCA_USER_DATA_PATH: '/orca' }

describe('structuredAgentBaseEnvironment', () => {
  it('is the whole shell snapshot, and nothing else, when inheriting all', () => {
    expect(
      structuredAgentBaseEnvironment({
        shellEnv,
        policy: INHERIT_ALL,
        processEnv,
        platform: 'darwin'
      })
    ).toEqual({
      PATH: '/shell/bin',
      LANG: 'en_US.UTF-8',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      CODEX_LB_API_KEY: 'lb-key',
      ANTHROPIC_API_KEY: 'shell-key',
      CLAUDE_CONFIG_DIR: '/shell/claude'
    })
  })

  it('passes only the baseline and listed shell names over Orca env when off', () => {
    expect(
      structuredAgentBaseEnvironment({
        shellEnv,
        policy: { inheritAll: false, names: ['CODEX_LB_API_KEY'] },
        processEnv,
        platform: 'darwin'
      })
    ).toEqual({
      PATH: '/shell/bin',
      HOME: '/home/me',
      ORCA_USER_DATA_PATH: '/orca',
      LANG: 'en_US.UTF-8',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      CODEX_LB_API_KEY: 'lb-key'
    })
  })

  it('matches names case-insensitively on Windows without duplicating Path', () => {
    expect(
      structuredAgentBaseEnvironment({
        shellEnv: { PATH: 'C:\\shell', codex_lb_api_key: 'lb-key' },
        policy: { inheritAll: false, names: ['CODEX_LB_API_KEY'] },
        processEnv: { Path: 'C:\\orca', USERPROFILE: 'C:\\Users\\me' },
        platform: 'win32'
      })
    ).toEqual({ PATH: 'C:\\shell', USERPROFILE: 'C:\\Users\\me', codex_lb_api_key: 'lb-key' })
  })
})

describe('createStructuredAgentEnvironmentResolvers', () => {
  it('rereads the saved Windows PATH with reg.exe when the native addon is missing', async () => {
    // An Orca server slot ships no registry addon, so this is the path a Windows SSH host takes.
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    __setWindowsPathRegistryLoaderForTests(() => {
      throw new Error('Cannot find module @orca/windows-registry')
    })
    runProcessMock.mockImplementation(async (spec: { args: string[] }) => ({
      code: 0,
      signal: null,
      stderr: '',
      timedOut: false,
      stdout: spec.args[1]?.startsWith('HKCU')
        ? '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_SZ    C:\\Users\\me\\new-cli\r\n'
        : '\r\nHKEY_LOCAL_MACHINE\\...\r\n    Path    REG_SZ    C:\\Windows\\System32\r\n'
    }))
    const capture = vi
      .spyOn(loginShell, 'resolveLoginShellEnvironment')
      .mockImplementation(async (options) => options?.env ?? {})
    try {
      const resolvers = createStructuredAgentEnvironmentResolvers({
        resolveShellEnvironmentPolicy: () => INHERIT_ALL
      })
      const env = await resolvers.resolveBaseEnvironment()
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path')!
      expect(env[pathKey]?.split(';')).toContain('C:\\Users\\me\\new-cli')
      expect(runProcessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          program: expect.stringMatching(/reg\.exe$/i),
          args: ['query', 'HKCU\\Environment', '/v', 'Path']
        })
      )
      expect(capture).toHaveBeenCalledWith({
        force: true,
        env: expect.objectContaining({ [pathKey]: env[pathKey] })
      })
    } finally {
      runProcessMock.mockReset()
      capture.mockRestore()
      __setWindowsPathRegistryLoaderForTests()
      __resetPersistedWindowsPathCacheForTests()
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it('serves the last snapshot to every start after the first and refreshes it past the TTL', async () => {
    const capture = vi
      .spyOn(loginShell, 'resolveLoginShellEnvironment')
      .mockResolvedValueOnce({ PATH: '/shell/A' })
      .mockResolvedValueOnce({ PATH: '/shell/B' })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const resolvers = createStructuredAgentEnvironmentResolvers({})
      expect((await resolvers.resolveBaseEnvironment()).PATH).toBe('/shell/A')
      expect((await resolvers.resolveClaudeInheritedEnv()).PATH).toBe('/shell/A')
      expect(capture).toHaveBeenCalledOnce()
      expect(capture).toHaveBeenCalledWith(expect.objectContaining({ force: true }))
      vi.advanceTimersByTime(10_000)
      // The stale start still gets the old snapshot; the install shows up on the next one.
      expect((await resolvers.resolveBaseEnvironment()).PATH).toBe('/shell/A')
      expect(capture).toHaveBeenCalledTimes(2)
      await new Promise((resolve) => setImmediate(resolve))
      expect((await resolvers.resolveBaseEnvironment()).PATH).toBe('/shell/B')
    } finally {
      vi.useRealTimers()
      capture.mockRestore()
    }
  })

  it('makes only the first start wait on a slow profile', async () => {
    vi.useFakeTimers()
    try {
      let captures = 0
      const capture = vi.fn(
        () =>
          new Promise<NodeJS.ProcessEnv>((resolve) => {
            captures += 1
            const path = `/capture-${captures}`
            setTimeout(() => resolve({ PATH: path }), 2000)
          })
      )
      const resolvers = createStructuredAgentEnvironmentResolvers({ resolveEnvironment: capture })
      const first = resolvers.resolveBaseEnvironment()
      expect(await settledWithoutWaiting(first)).toBeUndefined()
      await vi.advanceTimersByTimeAsync(2000)
      expect((await first).PATH).toBe('/capture-1')
      for (const expected of ['/capture-1', '/capture-2', '/capture-3']) {
        // Each start is past the TTL, so it starts a 2 s refresh but must not wait for it.
        await vi.advanceTimersByTimeAsync(12_000)
        expect((await settledWithoutWaiting(resolvers.resolveBaseEnvironment()))?.PATH).toBe(
          expected
        )
      }
      expect(capture).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not hold later starts behind a hung profile', async () => {
    vi.useFakeTimers()
    try {
      // The first capture ends at the login-shell timeout with Orca's own env; later ones hang.
      const capture = vi
        .fn<() => Promise<NodeJS.ProcessEnv>>(() => new Promise(() => {}))
        .mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve({ PATH: '/fallback' }), 5000))
        )
      const resolvers = createStructuredAgentEnvironmentResolvers({ resolveEnvironment: capture })
      const first = resolvers.resolveBaseEnvironment()
      await vi.advanceTimersByTimeAsync(5000)
      expect((await first).PATH).toBe('/fallback')
      for (let start = 0; start < 3; start += 1) {
        await vi.advanceTimersByTimeAsync(10_000)
        expect((await settledWithoutWaiting(resolvers.resolveBaseEnvironment()))?.PATH).toBe(
          '/fallback'
        )
      }
      // The hung refresh is shared, not restarted per start.
      expect(capture).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares concurrent first captures and retries after a failed first capture', async () => {
    let release: (env: NodeJS.ProcessEnv) => void = () => {}
    const capture = vi.fn<() => Promise<NodeJS.ProcessEnv>>()
    capture.mockRejectedValueOnce(new Error('shell failed'))
    const resolvers = createStructuredAgentEnvironmentResolvers({ resolveEnvironment: capture })
    await expect(resolvers.resolveBaseEnvironment()).rejects.toThrow('shell failed')
    capture.mockImplementationOnce(
      () =>
        new Promise<NodeJS.ProcessEnv>((resolve) => {
          release = resolve
        })
    )
    const first = resolvers.resolveBaseEnvironment()
    const second = resolvers.resolveClaudeInheritedEnv()
    release({ PATH: '/repaired' })
    expect((await first).PATH).toBe('/repaired')
    expect((await second).PATH).toBe('/repaired')
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('keeps the last snapshot when a background refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const capture = vi
        .fn<() => Promise<NodeJS.ProcessEnv>>()
        .mockResolvedValueOnce({ PATH: '/good' })
        .mockRejectedValueOnce(new Error('shell failed'))
        .mockResolvedValueOnce({ PATH: '/fixed' })
      const resolvers = createStructuredAgentEnvironmentResolvers({ resolveEnvironment: capture })
      await resolvers.resolveBaseEnvironment()
      vi.advanceTimersByTime(10_000)
      expect((await resolvers.resolveBaseEnvironment()).PATH).toBe('/good')
      await new Promise((resolve) => setImmediate(resolve))
      // The failed refresh left the snapshot stale, so this start retries in the background.
      expect((await resolvers.resolveBaseEnvironment()).PATH).toBe('/good')
      await new Promise((resolve) => setImmediate(resolve))
      expect((await resolvers.resolveBaseEnvironment()).PATH).toBe('/fixed')
      expect(capture).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rereads settings on every acquisition while the shell snapshot is cached', async () => {
    let overlay = 'A'
    const resolveEnvironment = vi.fn(async () => ({ PATH: '/shell/A' }))
    const resolvers = createStructuredAgentEnvironmentResolvers({
      resolveEnvironment,
      resolveShellEnvironmentPolicy: () => INHERIT_ALL,
      resolveLaunchEnvOverlay: () => ({ CURRENT_SETTING: overlay })
    })
    expect(await resolvers.resolveCodexEnvironment()).toEqual({
      PATH: '/shell/A',
      CURRENT_SETTING: 'A'
    })
    overlay = 'B'
    expect(await resolvers.resolveCodexEnvironment()).toEqual({
      PATH: '/shell/A',
      CURRENT_SETTING: 'B'
    })
    expect(resolveEnvironment).toHaveBeenCalledOnce()
  })

  it('gives Codex and Claude the same base, with overlays on Codex only', async () => {
    const resolvers = createStructuredAgentEnvironmentResolvers({
      resolveEnvironment: async () => ({ PATH: '/shell/bin', SHELL_ONLY: '1' }),
      resolveShellEnvironmentPolicy: () => INHERIT_ALL,
      resolveCodexOverrides: () => ({ CODEX_PROFILE: 'p' })
    })
    expect(await resolvers.resolveClaudeInheritedEnv()).toEqual({
      PATH: '/shell/bin',
      SHELL_ONLY: '1'
    })
    expect(await resolvers.resolveCodexEnvironment()).toEqual({
      PATH: '/shell/bin',
      SHELL_ONLY: '1',
      CODEX_PROFILE: 'p'
    })
  })
})
