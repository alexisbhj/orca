# GitHub Tree host capabilities: build and consumer handoff

This guide covers the Orca fork only. The consumer plugin and its tickets are not
part of this delivery. Integration branch: `codex/github-tree-host-capabilities`;
[parent issue #1](https://github.com/alexisbhj/orca/issues/1),
[parent PR #6](https://github.com/alexisbhj/orca/pull/6).
Integration is not delivery on main; merging does not install the running build.

## Contracts and detection

| Capability | Contract | Support check and old peers |
| --- | --- | --- |
| [H1: own worker command](https://github.com/alexisbhj/orca/issues/2) | [Panel action, permission, errors and bounds](../plugin-own-command.md) | Declare `commands:invokeOwn`, obtain consent, then use a harmless declared command such as the host fixture's ping. An old host rejects the capability; an old renderer rejects the action. Manifest acceptance alone does not prove the complete path. |
| [H2: left panel](https://github.com/alexisbhj/orca/issues/3) | [Optional placement and lifecycle](../plugin-panel-placement.md) | `plugins.list` preserves explicit `placement`, but there is no negotiated left-layout capability. Confirm the actual left tab in the matching desktop renderer. Old hosts strip the field; old renderers keep panels on the right. Omission means right, not left support. |
| [H3: typed terminal](https://github.com/alexisbhj/orca/issues/4) | [Creation, readiness, reconciliation and prompt receipts](typed-terminal-launch.md) | `status --json` exposes `result.runtime.capabilities`; require `terminal.create.typed.v1` on the execution host. The matching CLI checks this before `terminal.createTyped`, returning `incompatible_runtime` or `runtime_unavailable` without sending the launch. |

There is no common plugin capability-discovery method for all three features.
Do not infer them from an Orca version string, branch name, or successful merge.
Update the desktop client and execution host together for H1/H2. H3 must be
advertised by the host that owns the execution, including SSH hosts. No new
stream opcode, direct network bridge, alternate launcher, or agent-status store
is introduced. A disconnected host is `unverifiable`, never presumed `exited`.

H1 accepts JSON arguments/results up to 60 KiB, depth 100 and 10,000 visited
values; the existing bridge admits 30 messages per plugin per 10 seconds and
64 KiB messages. Activation has a 10-second deadline per attempt; invocation has
a 30-second deadline. Errors and retry limits are detailed in its contract.
Timeout does not cancel effects: never blindly retry a mutating own command.
H2 unmounts hidden panels; reopening creates a fresh authenticated session.
Persist business state through existing plugin storage if it must survive that.
H3 requires a persisted operation ID before creation; prompt submission has its
own receipt identity. Do not substitute one identity for the other, infer
readiness from creation, or bypass a workspace-trust prompt.

H3 operation IDs use exactly 13 decimal timestamp digits, a hyphen, and 32
lowercase hexadecimal digits. A previously unseen operation may be at most 24
hours old and at most 5 minutes in the future according to the execution host's
clock. Malformed/future identities return `agent_session_operation_invalid`;
an old unseen identity returns `agent_session_operation_expired`. Recorded rows
expire at `max(recordedAt, operationTimestamp) + 24 hours + 5 minutes`; this is
bounded retention, not indefinite replay. Exhausted admission returns
`agent_session_operation_capacity`. Keep the request and reconcile promptly;
expiry or capacity refusal never authorizes a replacement operation implicitly.

## Run the matching build

Use a clean checkout of the accepted integration SHA from the final evidence,
with its pinned Node/pnpm/Bun toolchain. Keep the installed Orca application and
its profile untouched. The exact local toolchain and dedicated profile are in
[the launch contract](launch-contract.md#toolchain-et-profil-dédiés).

From that checkout, in a shell with the dedicated toolchain on PATH:

```sh
export ORCA_BACKGROUND_LAUNCH=1
export ORCA_DEV_USER_DATA_PATH="<absolute-dedicated-profile-path>"
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The profile value must be the same for the app and CLI. In another shell, from
the same checkout with the same environment:

```sh
node config/scripts/orca-dev.mjs status --json
node config/scripts/orca-dev.mjs worktree list --json
node config/scripts/orca-dev.mjs terminal create --help
```

Use this wrapper, not a global `orca` command that may target another build.
Record the checkout SHA, build exit status, artifact hashes, runtime app path and
profile before asserting availability. The initial background launch is for
verification; a human can subsequently open the dedicated development app for
normal use. Automated validation must keep windows hidden and unfocused.
On Windows set the same environment variables in PowerShell (`$env:NAME =
'value'`); the wrapper and native execution paths are shared. For cross-architecture
packaging use `pnpm install:release` first; `pnpm build` here is a host build.

## Demonstrate without the consumer plugin

Use a synthetic existing repository or folder workspace in the dedicated
profile. Do not use a project with real pending work. Through Settings → Plugins,
enable the plugin system, install the local fixture directories and review their
permissions using the usual consent flow:

1. Install `examples/plugins/hello-orca`. Open **Hello Orca**, click **Invoke own
   worker command**, and verify `pong: true` with `args.source: "panel"`.
2. Install `examples/plugins/panel-placement`. Open **Left fixture**, return to
   **Navigation**, and open it again. Open **Right fixture** simultaneously.
   Collapse/restore the sidebar and confirm the existing terminal is preserved.
3. Follow [typed creation](typed-terminal-launch.md) against the exact workspace
   selector returned by `worktree list`. Persist a new operation and request,
   create Codex or Claude with compatible explicit model/effort, and repeat the
   request under the same operation to confirm the same pane. Use `terminal wait`
   before one synthetic prompt; retain its receipt for an identical retry.

Capture light/dark renderers through Electron/Playwright CDP and record hidden,
unfocused window state. Close only terminals created by the demonstration,
remove its placement fixture, restore changed settings, and stop only the
dedicated app. The fixtures are host samples, not the final plugin.

## Evidence and release gate

The following records describe their own pinned SHAs, not a claim that any later
checkout has been tested:

- [H1 runtime, consent and captures](https://github.com/alexisbhj/orca/pull/6#issuecomment-6091258087).
- [H2 layout, navigation and retained terminal](https://github.com/alexisbhj/orca/pull/6#issuecomment-6098761873).
- [H3 creation, readiness, restart and prompt retry](https://github.com/alexisbhj/orca/pull/6#issuecomment-6099087389).
- [Integrated CI at `8a9d6f94d6d23cad626e80b6a21e6ebb2716c720`](https://github.com/alexisbhj/orca/actions/runs/38063571255).

The H4 closure record on [issue #5](https://github.com/alexisbhj/orca/issues/5)
must identify the accepted final SHA, exact-SHA CI, integrated runtime evidence,
build/profile, and independent reviews before claiming consumer availability.
If artifacts are reused, explicitly compare the relevant source tree and every
recorded artifact hash and identify the SHA that actually produced the build.
Do not silently relabel older screenshots as newly executed evidence.

Rendered evidence is macOS-local. Windows/Linux CI and transport tests do not
prove a real remote UI session; no SSH latency demonstration is claimed. Claude
launch/transmission/retry was verified, but its provider refused model access;
no successful Claude model answer is claimed. Keep those limits in the handoff.
Publish only sanitized evidence: no runtime tokens, account details, private
paths, raw profile files, or unreviewed terminal transcripts.

The plugin handoff consists of the three contract links, final accepted SHA,
build/profile invocation and the H4 evidence record. No plugin backlog change or
message to another chat is needed. Human merge remains a separate final action.
