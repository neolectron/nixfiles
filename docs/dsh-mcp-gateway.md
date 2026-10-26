# Private DSH MCP services

This feature owns only `dsh-mcp-gateway.service` and `dsh-mcp-tunnel.service`.
It never starts, restarts or changes the existing DSH runtime or Discord deployment.
The host imports the optional Home Manager module and enables it explicitly.
Missing operator files leave the corresponding unit inactive.

## Ownership and paths

The official `tunnel-client` v0.0.18 Linux-amd64 release and matching static
`cloudflared` companion are pinned in [the package](../packages/tunnel-client/default.nix).
The release ZIP SHA256 is
`3c82307316acd93c88a384b62af1d81d3f4cb0efa975f9c0bfaef922866a04c4`.
The package install check verifies the actual CLI and companion, without network calls.

[One unit definition](../packages/dsh-mcp-services/units.nix) feeds both Home Manager
and the narrow service-artifact export. The gateway uses the existing official
FNM Node 22.23.3, not Nix Node. Under the user's data directory:

- `dsh-mcp-gateway/current/dist/main.js`: operator-published immutable production release,
  including its manifest and production `node_modules`; `current` selects the release.
- `dsh-mcp-gateway/private/config.json`: gateway configuration, listener
  `127.0.0.1:8790`, project/action grants and durable ledger path.
- `dsh-mcp-gateway/private/gateway.env`: only the gateway's independently provisioned key.
- `dsh-mcp-gateway/private/tunnel.yaml`: dedicated tunnel identity and public configuration.
- `dsh-mcp-gateway/private/tunnel.env`: runtime key and full gateway authorization header.

Runtime files remain operator-owned, outside Git and the Nix store. The private
parent must be 0700 and secret/config files 0600. No secret value is evaluated by Nix.
The gateway reads the existing protected DSH SDK launch record through `DSH_HOME`;
never copy that record, launch URL or owner credential into tunnel configuration.

The private tunnel profile must bind only `main` to `http://127.0.0.1:8790/mcp`.
Use `env:CONTROL_PLANE_API_KEY` for its control-plane API key and
`env:DSH_MCP_AUTHORIZATION` for **both** `mcp.extra_headers.Authorization` and
`mcp.discovery_extra_headers.Authorization`. Use a runtime key with Tunnels Read+Use,
not an administrative key. The unit forces health/admin TCP to `127.0.0.1:8791`.
Do not enable remote UI, raw HTTP logging or Harpoon. Scope tunnel/workspace access
before granting task mutation: a static gateway key represents the whole tunnel
population, not the cryptographic identity of an individual Dot.

Gateway shutdown has a 30-second service budget, exceeding its 20-second drain.
Both units restart on failure after five seconds, limited to six starts per minute.
An exhausted limit needs an operator reset/start after correcting the cause.
The tunnel is stopped when its gateway stops; manually restarting the gateway alone
does not promise automatic tunnel recovery. Start/check both owned units together.
The services can read the user's home but can write only their private directory
and isolated temporary directory. Native DSH, not this adapter, runs agent work.

## Focused preparation

From this isolated checkout:

```sh
nix build --no-link --print-out-paths .#tunnel-client .#dsh-mcp-service-files
```

The service-artifact build runs six read-only contract tests. Offline unit validation:

```sh
systemd-analyze --user verify \
  "$artifacts/share/systemd/user/dsh-mcp-gateway.service" \
  "$artifacts/share/systemd/user/dsh-mcp-tunnel.service"
```

No package installation or unit activation follows from these builds. In particular,
do not activate a complete Home Manager generation or NixOS system merely to install
these two units when the primary checkout contains unrelated pending changes.
Normal future integration follows the repository maintenance gates, including
`nix flake check` and the integrated Home Manager/NixOS activation review.

A narrowly reviewed deployment may keep the artifact closure alive with a dedicated
Nix output link, link only the two generated unit files into the user's manager, and
reload/start **only those units** after operator files and access policy are ready.
Check existing destinations first and refuse to overwrite units owned by another
manager. This scoped deployment does not substitute for applying unrelated pending
Home Manager changes. Do not run `home-manager switch`, an entire generation's
activation script, or `systemctl --user restart` against an unbounded unit set.
No activation script is provided here: the deployment owner must review and perform
this handoff with the complete gateway release and tunnel credentials ready.

Before polling, use the exact packaged `tunnel-client help samples` and
`doctor --config <private-profile> --explain` in the service's protected environment.
Doctor is an active diagnostic, not an offline syntax check: do not source secret
environment files into logged shell commands or print its unsanitized output.
Verify loopback health/readiness, then an authorized real cloud MCP health call.
A built package or healthy poller alone does not prove cloud tool access.

## Sources

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels.md)
- [Official v0.0.18 release](https://github.com/openai/tunnel-client/releases/tag/v0.0.18)
- [Tunnel configuration reference](https://github.com/openai/tunnel-client/blob/v0.0.18/docs/configuration.md)
- [Pinned Home Manager systemd generator](https://github.com/nix-community/home-manager/blob/5a9d300bd619c03857521b50c8877a19dbad7078/modules/systemd.nix)

Private OpenAI tunnels support private/custom connections, not public plugin
submission. Preserve the separate existing Discord tunnel, credential and scope.
