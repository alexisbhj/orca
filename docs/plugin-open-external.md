# Opening an external link from a panel

`openExternal({ url })` is an experimental Host API 1.2 method. It asks Orca to
open an `https:` link in the default browser of the computer showing Orca. The
panel stays a document: the shell still blocks `<a href>`, `window.open`, form
submission and navigation, and the CSP is unchanged (`default-src 'none'`,
`connect-src 'none'`).

Declare `links:openExternal` in `capabilities` and obtain consent for the
updated manifest. The plugin identity comes only from the authenticated panel
session; a `pluginKey` or any other extra parameter is refused.

```js
window.parent.postMessage(
  {
    type: 'orca-panel-action',
    requestId: 'open-1',
    action: 'openExternal',
    params: { url: 'https://example.com/docs' }
  },
  '*'
)
```

Listen for `orca-panel-action-result` from `event.source === window.parent`.
Success is `{ ok: true, value: { opened: true } }`: the host handed the URL to
the operating system, which does not prove a browser displayed it.

## Accepted URLs

Only absolute `https://` URLs with a host, at most 2,048 characters both as
sent and once normalized. Refused,
with `invalid_params` and an explicit message prefixed by `url:`:

- any other scheme (`http:`, `file:`, `javascript:`, `data:`…), an uppercase
  scheme, or slash-less forms such as `https:example.com`;
- credentials (`user@`, `user:pw@`, a bare `@` in the host part);
- a percent-encoded host, backslashes, spaces, control or invisible characters;
- a host Orca would rewrite before opening: numeric or hex IPv4
  (`https://2130706433/`), non-ASCII names (send the `xn--` form), the default
  port `:443`;
- missing host or unparseable URLs.

The host opens the normalized form (`https://Example.com` → `https://example.com/`).

## Errors and budgets

| Code                               | Meaning                                                                |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `capability_denied`                | `links:openExternal` not declared                                      |
| `consent_required`                 | plugin disabled or consent missing/stale                               |
| `invalid_params`                   | refused URL or extra field                                             |
| `invalid_request` / `rate_limited` | 64 KiB message cap or 30 messages/10 s panel budget                    |
| `rate_limited`                     | more than 3 openings per plugin in 10 s                                |
| `unavailable`                      | session invalidated, or this host/client cannot open links (see below) |

Calls that pass the capability, consent and URL checks are recorded in the
plugin audit log with the URL host only: `attempt`, then `ok` or `error` (a
`rate_limited` or caller `unavailable` refusal is an `error`). Calls refused earlier
(`capability_denied`, `consent_required`, `invalid_params`, panel message
budgets) have no effect and are not audited, like every other mutating method.

## Detection and older hosts

Probe with `panel.getCapabilities` (see [panel placement](plugin-panel-placement.md)):
`value.capabilities` contains `panel.openExternal.v1` only when the host that
served this panel will open links for its displaying client. An older renderer
refuses the unknown action with `invalid_request`; an older host rejects the
manifest capability. Treat any refusal, missing capability or timeout as
unsupported. No wire opcode, RPC method or permission was added.

## Where the link opens

Plugins and their panels run in the local desktop process, including for SSH
workspaces, so the link opens on the desktop showing Orca, never on the SSH
host. A panel displayed by a paired client over runtime RPC is shown on another
machine: the execution host would open the link on the wrong display, so it
answers `unavailable` without effect and does not advertise the capability.
Workers have no displaying client and get `unavailable` too.

## Host fixture

`examples/plugins/open-external` is independent of any consumer plugin: one
panel with **Probe host support**, **Open https://example.com/**, a refused
`file:` request and a direct link that stays blocked.
`tests/e2e/plugin-open-external.spec.ts` drives it through the real iframe,
preload and main process with `shell.openExternal` replaced by a recorder.
Use the dedicated build/profile and background launch described in
[the launch contract](agents/launch-contract.md).
