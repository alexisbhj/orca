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
the panel; restoring it opens a fresh authenticated session. Disabled, removed,
or failed plugin-list refreshes remove the active contribution immediately and
fall back to Navigation. Right contributions remain in the right activity bar.
No business plugin identity or source-control provider is special-cased.

`plugins.list` preserves an explicitly declared placement as an optional field.
Older hosts strip the unknown manifest field, and older clients show all panels
on the right. A missing field is therefore the right default, not proof of left
placement support. Update both host and client to use the left layout. There is
no new stream opcode or RPC method, and plugin permissions are unchanged.

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
