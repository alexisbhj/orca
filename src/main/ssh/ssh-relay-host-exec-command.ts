import type { SshConnection } from './ssh-connection'
// Why via deploy-helpers: tests mock execCommand there, and this must stay behind that seam.
import { execCommand } from './ssh-relay-deploy-helpers'
import type { RemoteHostPlatform } from './ssh-remote-platform'

/** Runs a command on `host`, leaving self-contained PowerShell command lines unwrapped. */
export function execHostCommand(
  conn: Pick<SshConnection, 'exec' | 'usesSystemSshTransport'>,
  host: RemoteHostPlatform,
  command: string,
  options?: { signal?: AbortSignal; timeoutMs?: number; onStderr?: (stderr: string) => void }
): Promise<string> {
  return execCommand(conn, command, {
    ...options,
    wrapCommand: host.commandDialect !== 'powershell'
  })
}
