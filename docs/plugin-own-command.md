# Invoking a plugin's own command from a panel

`invokeOwnCommand({ commandId, args? })` is an experimental Host API 1.1 method.
Declare `commands:invokeOwn` in `capabilities`, declare the worker command in
`contributes.commands`, register its handler in the worker, and obtain consent
for the updated manifest. Existing manifests and actions keep their behavior.
The action also works through the existing worker Host API.

A panel uses the existing bridge:

```js
window.parent.postMessage({
  type: 'orca-panel-action',
  requestId: 'command-1',
  action: 'invokeOwnCommand',
  params: { commandId: 'hello-ping', args: { source: 'panel' } }
}, '*')
```

Listen for `orca-panel-action-result` from `event.source === window.parent`.
The host echoes `requestId`; success carries `{ ok: true, value }`, failure
`{ ok: false, errorCode, error }`. Concurrent calls can complete in any order.
The identity comes exclusively from the authenticated panel session. No
`pluginKey` parameter is accepted. Only a declared worker command with a
registered handler can run; aliases to built-in commands are not worker commands.
Consent, enabled state and revision are checked before activation and again
before invocation; a revoked session cannot start queued work.

Arguments and results must be JSON (return `null` when there is no result).
Each JSON value is limited to 60 KiB UTF-8, depth 100 and 10,000 visited values,
leaving room within the existing 64 KiB message budget. The bridge still admits
30 messages per plugin per 10 seconds. Oversized calls return `invalid_request`,
invalid arguments `invalid_params`, and exhausted admission `rate_limited`.
Missing consent/capability returns `consent_required`/`capability_denied` at the
Host API gate; revoked or stale panel sessions return `invalid_request` or
`unavailable`. Missing commands/handlers, invalid results, worker failures and
timeouts return `action_failed`; failure text is bounded to 1,024 characters.

Worker activation keeps its 10-second deadline per activation attempt, and
invocation its 30-second deadline. **A timeout does not cancel or prove the
absence of effects.** Do not automatically retry mutations. Reconcile their
outcome using the command's own operation identity if it supplies one.

The sandbox CSP is unchanged, including `connect-src 'none'`. No direct network,
localhost endpoint or extra bridge is needed. All transports use the same host
registry and dispatcher. No wire opcode was introduced. Older hosts reject the
new manifest capability, and older renderers reject the unfamiliar action;
treat either refusal as unavailable support and update the host/client together.
There is no fallback to arbitrary commands or direct network access.

## Host fixture

`examples/plugins/hello-orca` is independent of any consumer plugin. Install it
in the isolated development profile, review its permissions, open Hello Orca,
and click **Invoke own worker command**. The result shows `pong: true` and
`args.source: "panel"`. `tests/e2e/plugin-demo.spec.ts` exercises this path through
the actual iframe, preload, main process and worker, and asserts the CSP.
Use the dedicated build/profile and background launch described in
[the launch contract](agents/launch-contract.md); do not use the global CLI.
