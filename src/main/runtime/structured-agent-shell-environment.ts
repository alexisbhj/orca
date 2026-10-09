import { resolveLoginShellEnvironment } from '../startup/login-shell-environment'
import { mergePersistedWindowsPathAsync } from '../pty/windows-environment-path'
import {
  nativeChatShellEnvironmentPolicy,
  type NativeChatShellEnvironmentPolicy
} from '../../shared/native-chat-shell-environment'

// Why: with the whole shell off, the child must still find its CLI and keep locale and agent socket.
const BASELINE_SHELL_VARIABLES = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SSH_AUTH_SOCK']

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const defined: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      defined[key] = value
    }
  }
  return defined
}

/** Overlays shell variables on Orca's env; win32 names are case-insensitive, so drop the base spelling. */
function overlayShellVariables(
  base: Record<string, string>,
  shellVariables: Record<string, string>,
  platform: NodeJS.Platform
): Record<string, string> {
  const merged = { ...base }
  if (platform === 'win32') {
    const overlaid = new Set(Object.keys(shellVariables).map((key) => key.toUpperCase()))
    for (const key of Object.keys(merged)) {
      if (overlaid.has(key.toUpperCase())) {
        delete merged[key]
      }
    }
  }
  return { ...merged, ...shellVariables }
}

function pickShellVariables(
  shellEnv: NodeJS.ProcessEnv,
  names: readonly string[],
  platform: NodeJS.Platform
): Record<string, string> {
  const normalize = (key: string): string => (platform === 'win32' ? key.toUpperCase() : key)
  const allowed = new Set([...BASELINE_SHELL_VARIABLES, ...names].map(normalize))
  const picked: Record<string, string> = {}
  for (const [key, value] of Object.entries(definedEnv(shellEnv))) {
    if (allowed.has(normalize(key))) {
      picked[key] = value
    }
  }
  return picked
}

/**
 * The env every structured chat child starts from, before its provider pins an account.
 * Inheriting everything is the login-shell snapshot as-is; otherwise Orca's own env plus
 * the baseline and listed shell variables.
 */
export function structuredAgentBaseEnvironment(input: {
  shellEnv: NodeJS.ProcessEnv
  policy: NativeChatShellEnvironmentPolicy
  processEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): Record<string, string> {
  if (input.policy.inheritAll) {
    return definedEnv(input.shellEnv)
  }
  const platform = input.platform ?? process.platform
  return overlayShellVariables(
    definedEnv(input.processEnv ?? process.env),
    pickShellVariables(input.shellEnv, input.policy.names, platform),
    platform
  )
}

export type StructuredAgentEnvironmentSources = {
  resolveEnvironment?: () => Promise<NodeJS.ProcessEnv>
  resolveShellEnvironmentPolicy?: () => NativeChatShellEnvironmentPolicy
  resolveLaunchEnv?: () => Promise<NodeJS.ProcessEnv>
  resolveLaunchEnvOverlay?: () => Promise<Record<string, string>> | Record<string, string>
  resolveCodexOverrides?: () => NodeJS.ProcessEnv
}

async function captureHostShellEnvironment(): Promise<NodeJS.ProcessEnv> {
  if (process.platform !== 'win32') {
    return resolveLoginShellEnvironment({ force: true })
  }
  const env = { ...process.env }
  await mergePersistedWindowsPathAsync(env, { forceRefresh: true })
  return resolveLoginShellEnvironment({ force: true, env })
}

// Why: long enough that a burst of starts shares one capture, short enough that a CLI
// installed on the host reaches new chats without a restart.
const SHELL_ENVIRONMENT_TTL_MS = 10_000

/**
 * Stale-while-refresh: only the first acquisition waits for the login shell; later ones get
 * the last snapshot at once and, once it is older than the TTL, refresh it in the background.
 */
export function createStructuredAgentEnvironmentResolvers(
  sources: StructuredAgentEnvironmentSources
): {
  resolveCodexEnvironment: () => Promise<NodeJS.ProcessEnv>
  resolveClaudeInheritedEnv: () => Promise<Record<string, string>>
  /** The shared base every agent's child env starts from, before its own overlay. */
  resolveBaseEnvironment: () => Promise<Record<string, string>>
} {
  let snapshot: { env: NodeJS.ProcessEnv; capturedAt: number } | null = null
  let pendingEnvironment: Promise<NodeJS.ProcessEnv> | null = null
  const resolveEnvironment = sources.resolveEnvironment ?? captureHostShellEnvironment
  const refresh = (): Promise<NodeJS.ProcessEnv> => {
    pendingEnvironment ??= resolveEnvironment()
      .then((env) => {
        snapshot = { env, capturedAt: Date.now() }
        return env
      })
      .finally(() => {
        pendingEnvironment = null
      })
    return pendingEnvironment
  }
  const resolveShellEnvironment = (): Promise<NodeJS.ProcessEnv> => {
    if (!snapshot) {
      return refresh()
    }
    if (Date.now() - snapshot.capturedAt >= SHELL_ENVIRONMENT_TTL_MS) {
      // A failed background refresh keeps the last snapshot.
      refresh().catch(() => {})
    }
    return Promise.resolve(snapshot.env)
  }
  const resolveBase = async (): Promise<Record<string, string>> =>
    structuredAgentBaseEnvironment({
      shellEnv: await resolveShellEnvironment(),
      policy: sources.resolveShellEnvironmentPolicy?.() ?? nativeChatShellEnvironmentPolicy(null)
    })
  return {
    resolveCodexEnvironment: async () => ({
      ...(await resolveBase()),
      ...(await sources.resolveLaunchEnv?.()),
      ...(await sources.resolveLaunchEnvOverlay?.()),
      ...sources.resolveCodexOverrides?.()
    }),
    resolveClaudeInheritedEnv: resolveBase,
    resolveBaseEnvironment: resolveBase
  }
}
