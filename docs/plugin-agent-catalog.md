# Reading the agent launch catalog from a worker

`agents.readCatalog()` and `agents.checkLaunch({ agent, model?, effort? })` are
experimental Host API 1.3 methods for plugin workers. They expose the catalog
`terminal.createTyped` (`orca terminal create --agent`) validates against, so a
plugin never keeps its own copy of agents, models and reasoning levels.

Declare `agents:read` in `capabilities` and obtain consent. Both methods are
read-only, not audited, and refused to sandboxed panels (`panel_forbidden`); a
panel reaches them through one of its worker's own commands.

```js
export default function activate(orca) {
  orca.commands.register('pickAgent', async () => {
    const catalog = await orca.host.call('agents.readCatalog', {})
    const check = await orca.host.call('agents.checkLaunch', {
      agent: 'codex',
      model: 'gpt-5.5',
      effort: 'high'
    })
    return { catalog, check }
  })
}
```

## Catalog (`version: 1`)

| Field                          | Meaning                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accountAccessVerified: false` | Always false. See below.                                                                                                                             |
| `agents[].id`                  | Exactly the agents `terminal.createTyped` accepts (today `codex`, `claude`).                                                                         |
| `modelSelection`               | `false`: the agent only runs its own configured model; `--model` is refused.                                                                         |
| `effortRequiresModel: true`    | An effort without a model is refused.                                                                                                                |
| `defaultModel`                 | `{ id, source: 'cli-default' }` when Orca knows what the CLI runs with no model, else `{ id: null, source: 'agent-config' }`.                        |
| `models[]`                     | Known ids with `efforts[]` (empty: effort refused for that model), `defaultEffort` and `defaultEffortIsCliDefault`.                                  |
| `customModels`                 | `{ accepted: true, maxLength, efforts, … }` when any other well-formed id is passed verbatim to the CLI (Codex, Claude), else `{ accepted: false }`. |

`defaultEffort` is what a picker should preselect. Omitting `effort` sends no
flag: the agent CLI then applies its own default. Lists are capped at 16 agents,
64 models and 16 efforts per menu; the whole answer stays well under 64 KiB.

## Dry run

`agents.checkLaunch` runs the same function `terminal.createTyped` runs before
spawning, and nothing else. It judges agent, model and effort only, not the
worktree or target authorization, and touches no operation record, session, terminal or worktree.
It answers `{ valid: true, choice: { agent, model, effort } }` or
`{ valid: false, code, message }` with the code and message `terminal.createTyped`
would raise (for example `invalid_argument` /
`Agent claude model haiku does not support effort high.`). A non-string field or
an unknown key is refused earlier with `invalid_params`.

## What the catalog does not prove

The catalog lists values Orca knows how to pass to an agent CLI. It never
contacts the provider: a listed or accepted custom model can still be refused
by the account at launch (plan, region, retired model). Treat a launch failure
as the authoritative answer on access.

## Which Orca answers

Host API calls travel over the worker's own IPC channel to the Orca process
that forked it, so the catalog is that instance's. Workers also receive
`ORCA_USER_DATA_PATH` (a path, never a token) set to the hosting profile, so an
`orca` CLI the worker runs reaches the same instance, for example a dev build
started with `ORCA_DEV_USER_DATA_PATH`. That CLI uses the runtime token, so it
bypasses plugin capabilities and the audit log: it is not a sanctioned plugin
path, and `terminal.createTyped` is not a plugin capability.

Plugins run in the Orca process that hosts them: the desktop app (also for SSH
workspaces) or the server under `orca serve`, whose catalog then answers. That
process also validates `terminal.createTyped` for a CLI targeting its profile,
so the answers agree.
A CLI pointed at another Orca (`--environment`, a paired server) is validated by
that host, possibly another version: treat the check as advisory there and the
launch as authoritative.

## Detection and older hosts

| Code                | Meaning                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `unknown_method`    | host predates Host API 1.3: unsupported                             |
| `capability_denied` | `agents:read` not declared                                          |
| `consent_required`  | plugin disabled or consent missing/stale                            |
| `unavailable`       | this host binding does not serve the catalog (desktop and serve do) |

An older host also rejects a manifest declaring `agents:read`. No wire opcode
or runtime RPC method was added.

## Host fixture

`examples/plugins/agent-catalog` is a worker with three commands: `catalog`,
`check` and `profile` (the `ORCA_USER_DATA_PATH` it received).
`tests/e2e/plugin-agent-catalog.spec.ts` installs and consents it in the built
app, and `src/main/plugins/plugin-agent-catalog-worker.integration.test.ts`
forks it against the real host bindings.
