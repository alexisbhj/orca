# Typed terminal creation

`terminal create --agent codex|claude` creates one fresh terminal agent in an existing Orca workspace (Git checkout or folder workspace). It creates no branch or worktree and sends no prompt. The native startup plan supplies configured arguments, environment and hooks; explicit compatible model/effort picks override saved arguments. The ordinary `--command`/`--shell` path is unchanged.

## Create and reconcile

Persist the operation ID and complete request **before** sending it. An operation ID is `<Unix milliseconds>-<32 lowercase hexadecimal digits>` with fresh random entropy; the existing native ledger admits new IDs for its bounded admission window. `--attempt-id` is a caller-defined nonempty string of at most 128 characters identifying the transport attempt. A different attempt ID does not authorize another launch.

```text
orca terminal create --worktree id:<workspace-id> --agent codex --model gpt-5.4 --effort high --operation-id <persisted-id> --attempt-id attempt-1 --json
```

`--model` and `--effort` are optional; effort requires a model so compatibility can be checked. Claude uses the same flags, for example `--agent claude --model opus --effort high`. Provider-specific model IDs follow Orca's existing catalog policy; unsupported effort combinations fail. `--command`, `--shell`, and `--title` cannot accompany `--agent`. `--focus` is optional; otherwise the launch is backgrounded.

The CLI checks `terminal.create.typed.v1` on the connected host before sending the strict `terminal.createTyped` RPC:

```json
{
  "worktree": "id:<workspace-id>",
  "agent": "codex",
  "model": "gpt-5.4",
  "effort": "high",
  "operationId": "<persisted-id>",
  "attemptId": "attempt-1",
  "presentation": "background"
}
```

No prompt, shell command, workspace creation, session reuse, or structured surface can be requested through this method. Old hosts are refused, with no fallback. Remote CLI calls require an explicit workspace selector. SSH/folder routing remains native; no client-side filesystem inference or alternate status store is introduced.

A successful result contains `operationId`, the current `attemptId`, `terminal.handle`, optional `terminal.paneKey`, `terminal.worktreeId`, and the native `launch` result (terminal outcome and mode receipt). The handle feeds `terminal show`, `wait`, and `send`; the pane key is the durable surface identity. The launch receipt confirms creation, **not readiness or process liveness**.

After a timeout or interruption, repeat the exact request with the **same operation ID** (a new attempt ID is allowed). The native ledger replays the recorded result across runtime restarts, updating the handle from the surviving pane when available. Concurrent identical requests join one execution. Changed effect fields under the same ID fail with `agent_session_operation_conflict`. If the host cannot establish the outcome, it returns `agent_session_operation_unknown`; an expired identity is refused too. Neither result permits an automatic fresh operation. A new operation requires a deliberate caller decision, never a timeout fallback. Loss of SSH contact remains unverifiable.

## Readiness and one prompt delivery

```text
orca terminal show --terminal <handle> --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
```

Inspect `result.wait.satisfied`. An unsatisfied/blocked wait is not permission to send. If the native wait reports a workspace-trust or other interactive prompt, ask the human to resolve it in that terminal, then wait again. Use the existing captured-transcript readiness detector; do not infer readiness from elapsed time or fabricate a terminal screen.

Only after `satisfied: true`:

```text
orca terminal send --terminal <handle> --text "<prompt>" --enter --wait-submit 30 --json
```

Persist its send receipt. Acceptance, observed submission and turn start are distinct. An observation timeout never authorizes resending. After ambiguous transport failure, repeat the identical send with the reported `--retry-request <id>`; that native receipt binds the exact prompt and terminal incarnation. A response advertising `provider: old-host` provides no safe retry guarantee: stop instead of issuing a fresh send. Creation operation IDs and prompt retry IDs are separate identities.
