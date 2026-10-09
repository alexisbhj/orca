import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ORCAD_WINDOWS_CLI_LAUNCHER_FILENAME } from '../../src/shared/orcad-artifacts.ts'
import { runProcessSync } from './script-child-process.mjs'

// Windows has no profile shell launcher; the native one keeps multiline message arguments intact.
export function stageOrcadWindowsCliLauncher(root, outputDir, target) {
  if (!target.startsWith('win32-')) {
    return
  }
  const arch = target.slice('win32-'.length)
  const source = join(root, '.build', 'windows-cli-launcher', arch, 'orca.exe')
  if (process.platform === 'win32') {
    const compile = runProcessSync({
      program: process.execPath,
      args: [
        join(root, 'config/scripts/build-windows-cli-launcher.mjs'),
        '--arch',
        arch,
        '--output',
        source
      ],
      stdio: 'inherit',
      timeoutMs: null
    })
    if (compile.code !== 0) {
      throw new Error('Could not build the Orca server CLI launcher')
    }
  }
  const launcher = join(outputDir, ORCAD_WINDOWS_CLI_LAUNCHER_FILENAME)
  mkdirSync(dirname(launcher), { recursive: true })
  copyFileSync(source, launcher)
}
