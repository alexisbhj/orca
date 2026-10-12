import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { getBrowserWorktreeSelector } from '../selectors'
import { RuntimeClientError } from '../runtime-client'
import { TerminalTypedCreate } from '../../shared/rpc-contract/terminal-typed-create-params'
import { TERMINAL_TYPED_CREATE_CAPABILITY } from '../../shared/terminal-typed-create-capability'
import type { AgentLaunchResult } from '../../shared/agent-launch-intent'

export const terminalTypedCreateHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  for (const incompatible of ['command', 'shell', 'title']) {
    if (flags.has(incompatible)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--${incompatible} cannot be combined with --agent.`
      )
    }
  }
  const parsed = TerminalTypedCreate.safeParse({
    worktree: await getBrowserWorktreeSelector(flags, cwd, client),
    agent: getRequiredStringFlag(flags, 'agent'),
    model: getOptionalStringFlag(flags, 'model'),
    effort: getOptionalStringFlag(flags, 'effort'),
    operationId: getRequiredStringFlag(flags, 'operation-id'),
    attemptId: getRequiredStringFlag(flags, 'attempt-id'),
    presentation: flags.get('focus') === true ? 'focused' : 'background'
  })
  if (!parsed.success) {
    throw new RuntimeClientError(
      'invalid_argument',
      parsed.error.issues[0]?.message ?? 'Invalid terminal launch.'
    )
  }
  const status = await client.getCliStatus()
  if (!status.result.runtime.reachable) {
    throw new RuntimeClientError(
      'runtime_unavailable',
      'The execution host is unreachable; no typed terminal launch was sent.'
    )
  }
  if (!status.result.runtime.capabilities?.includes(TERMINAL_TYPED_CREATE_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'The execution host does not support typed terminal creation. Update Orca on that host.'
    )
  }
  const result = await client.call<{ terminal: { handle: string }; launch: AgentLaunchResult }>(
    'terminal.createTyped',
    parsed.data
  )
  printResult(result, json, (value) => `Terminal ${value.terminal.handle}`)
}
