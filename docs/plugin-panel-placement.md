# Plugin panel placement

A panel contribution can request `"placement": "left"` or `"placement": "right"`.
Omitting placement keeps the existing right-sidebar behavior.

```json
{
  "id": "navigation",
  "title": "My navigation",
  "entry": "panel.html",
  "placement": "left"
}
```

Left contributions appear beside a **Navigation** tab in the existing resizable
left sidebar. Navigation opens Orca's native workspace and agent controls.
The terminal remains alongside the sidebar. Use the existing sidebar toggle
(default **⌘B** on macOS, **Ctrl+B** on Linux/Windows) to temporarily give the
terminal more width, then restore the sidebar and its selected tab. Arrow keys
navigate the tab list using the existing Tabs primitive.

Both placements use the same sandbox, consent checks, theme, workspace context,
and panel session lifecycle. Switching tabs or collapsing the sidebar unmounts
the panel; restoring it reloads through the existing authenticated session mechanism. Disabled, removed,
or failed plugin-list refreshes remove the active contribution immediately and
fall back to Navigation. Right contributions remain in the right activity bar.
No business plugin identity or source-control provider is special-cased.

## Detection from the sandboxed panel

`plugins.list` reports manifest intent, not connected-client support. Probe the
renderer displaying the panel over its existing postMessage action bridge:

```js
window.parent.postMessage(
  {
    type: 'orca-panel-action',
    requestId: 'placement-probe',
    action: 'panel.getCapabilities'
  },
  '*'
)
```

Listen before sending. Accept only a reply from `window.parent` with type
`orca-panel-action-result`, the matching request ID, `ok: true`, and
`value.capabilities` containing `panel.placement.left.v1`. This confirms left
layout support for this client/host pair; it does not say this particular panel
requested left placement. Parameters must be omitted or `{}`.

The renderer answers locally after the approved panel session has loaded. It
intersects its own layout support with the optional `supportedPlacements` field
returned by the execution host on `plugins.readPanelEntry` / the existing IPC
surface. No new RPC method, stream opcode, permission or worker API is added.
The guest supplies neither plugin identity nor session token. The usual iframe
identity check, document lifetime, 64 KiB message limit and 30 messages/10 seconds
budget still apply. Invalid parameters yield `invalid_params`; budget refusals
yield `invalid_request` or `rate_limited`.

| Displaying client | Execution host                          | Probe result                                                                           |
| ----------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| Current           | Current                                 | `panel.placement.left.v1`                                                              |
| Current           | Older, without the optional host signal | Empty capabilities, or no bridge reply if authenticated panel sessions are unavailable |
| Older             | Current                                 | Unsupported action (`invalid_request`) or no reply                                     |
| Older             | Older                                   | Unsupported action or no reply                                                         |

Treat any error, missing field or timeout as unconfirmed support, never as a
positive signal. Use a bounded timeout (for example 5 seconds) and repeat after
remount/reconnect; do not cache a positive reply across sessions. An older client
ignores the additive host field and keeps panels on the right. An older host
strips unknown manifest placement, preserving the right default. Update both
host and client for confirmed left placement. This applies to SSH-connected
clients as well as local desktop clients; a worker alone cannot attest to the
layout of a particular connected renderer.

## Host fixture

Install `examples/plugins/panel-placement` in the dedicated development profile
and enable it through the usual consent UI. It declares **Left fixture** and
**Right fixture**, sharing one static sandbox document with no worker or network.
Select Left fixture, return to Navigation, and reopen Left fixture. Toggle the
sidebar twice and verify the selected panel returns while the terminal retains
its session. Open Right fixture simultaneously to verify coexistence. Disable
or remove the fixture to verify native navigation remains accessible.

Use the background Electron/CDP procedure in
[the launch contract](agents/launch-contract.md), with light and dark screenshots.
