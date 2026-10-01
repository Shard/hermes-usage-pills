# hermes-usage-pills
<img width="501" height="140" alt="image" src="https://github.com/user-attachments/assets/738be015-2085-4122-adfd-583ba70789d4" />

Usage pills under the [Hermes Agent](https://github.com/NousResearch/hermes-agent)
Desktop chat composer: one compact pill per connected provider showing its
rate-limit windows, credits or plan state, so several accounts can be watched
at a glance while chatting.

- **Backend** (`dashboard/`): `GET /api/plugins/hermes-usage-pills/usage`,
  read-only. It reads the gateway's own credential pool through Hermes'
  account-usage helpers and never returns credentials. Responses are cached
  for 30 seconds.
- **Desktop** (`desktop/plugin.js`): renders the pills in the composer's
  underside (or top) slot, plus a sidebar pane to choose providers, position,
  alignment and drain edge.

The pills show the providers of whichever gateway the Desktop is connected to.

## Install

On each gateway host (installs the backend half, enabled):

```sh
hermes plugins install Shard/hermes-usage-pills --enable
```

For the Desktop half: when the Desktop's backend is local, the package's
`desktop/` is picked up from the local plugins root. Enable it under
Capabilities ▸ Plugins. For a remote or SSH backend, use the Desktop's
*Install from Git* dialog with the Desktop target checked.

Update with `hermes plugins update hermes-usage-pills`.

Formerly shipped as `provider-usage`; saved pill settings are adopted
automatically on first load.

## Tests

```sh
node --test tests/desktop.test.mjs
PYTHONPATH=~/.hermes/hermes-agent python3 -m unittest discover -s tests   # Hermes env python
```

## License

MIT. Provider marks: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
