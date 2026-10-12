// Host fixture for agents.readCatalog / agents.checkLaunch; independent of any consumer plugin.
export default function activate(orca) {
  orca.commands.register('catalog', () => orca.host.call('agents.readCatalog', {}))
  orca.commands.register('check', (choice) => orca.host.call('agents.checkLaunch', choice))
  // Path only: the CLI resolves this Orca's runtime from it, never from a token in env.
  orca.commands.register('profile', () => ({
    userDataPath: process.env.ORCA_USER_DATA_PATH ?? null
  }))
}
