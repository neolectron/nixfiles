# Bitwarden-backed secrets for DSH

The existing Bitwarden Home Manager module now installs the official `bw` CLI
and `secret`, in addition to the desktop application. The desktop application's
SSH-agent socket setting is preserved. Desktop and CLI login/unlock are separate.

## Provenance and maintenance

This adopts the MIT-licensed Swift CLI from
[astahmer/secret-cli](https://github.com/astahmer/secret-cli) at
`fe4af4af2b9f7504600e37e373905f8b1b25727b`, the same source revision used by
[astahmer/nixfiles](https://github.com/astahmer/nixfiles) at
`a142d48bef6bcd638f5c6520d5b1f658a527bd5d`.
The source is fetched over public HTTPS with a fixed hash; its MIT notice is
installed with the package. The Nix package, wrapper, shell integration and
fake-vault regression tests here are locally authored. We do not copy the old
TypeScript implementation or unlicensed nixfiles shell/test assets.

`packages/secret/linux.patch` adapts process spawning/socket types for Linux,
disables unsupported biometric/keychain behavior, drains subprocess output
without pipe deadlocks, and makes file replacement fail explicitly and atomically.
Review/reduce that patch when updating the pinned source, then rebuild `.#secret`
and run `nix flake check`. Do not silently track upstream's main branch.

We deliberately do **not** adopt the friend's vault aliases, repo-global config
symlinks, SSH private-key materialization, authorized-keys changes, macOS
Keychain/Touch ID or SecretBar. No Home Manager activation contacts Bitwarden.
The Linux wrapper disables the persistent `bw serve` daemon, automatic biometric
bootstrap and implicit unlock prompts. Explicit `secret unlock` still prompts
through `bw` in your terminal.

## Activate and log in

Use this repository's maintenance procedure to build/check and activate the
NixOS-integrated Home Manager generation. Do not run standalone `home-manager
switch`. System changes use the desktop-authorized rebuild helper, only after
its dry activation succeeds. This does not require restarting DSH.

Open a new terminal after activation, then run these **yourself**:

```sh
bw login
secret unlock --store
secret status --check
```

For a self-hosted vault, configure its server with `bw config server URL` before
logging in. Enter passwords, 2FA codes and any session tokens only in your own
terminal, never in a DSH conversation. The CLI may display a session token during
login; do not copy it into chat.

On Linux `secret unlock --store` explicitly persists the session as a **plaintext
credential** in `~/.config/secret/session`, mode `0600`. It grants access to the
unlocked vault, not just configured aliases. The wrapper checks file ownership
and rejects symlinks or group/world-readable files. Treat it like a password.
`secret lock` locks the CLI vault and removes the stored session. Linux has no
Touch ID cache. Bare `secret unlock` in an integrated bash/zsh captures the token
in that shell's `BW_SESSION` without printing it or storing a session file; it
will not unlock an already-running DSH Host.

A DSH process running as your user with the same HOME finds the stored session
on its next `secret` call; no token needs to be embedded in its profile/settings.
An isolated DSH_HOME/HOME, container or other host does **not** automatically
share that login/session. Launch it with the intended user environment, or
explicitly configure `SECRET_SESSION_FILE` for a suitably protected shared file.
Do not move or reveal credentials to work around that boundary.

## Alias setup

The CLI never implicitly imports your entire vault into DSH. Register only the
aliases you want to expose. Examples (replace the placeholders yourself):

```sh
# Hidden value prompt; creates a personal global alias and Bitwarden item.
secret set example-api-key --global

# Offline metadata only, suitable for DSH's Secret Catalog.
secret print global --json
secret print --all --json
secret lint --json

# Explicit value use. Do not run a plain get in an agent transcript unless needed.
secret get example-api-key --copy
```

Global aliases live in writable `~/.config/secret/config.json`; activation creates
an empty `{"secrets":{}}` file only if none exists, so the Catalog works on first
use. Existing files or symlinks are left untouched. It is not a read-only Home
Manager file. Project aliases live in `.secret.json` (references
and metadata only), and machine-local overrides in `.secret.local.json`
(gitignored). Environments use `--env`, defaulting to `prod`. For an existing
Bitwarden item, put its exact item ID and chosen field into an alias config;
`secret set` instead writes a value to the vault.

The DSH Secret Catalog already supports this CLI's `print`, `get`, `set`, `edit`
and `mv` contract. Plugin settings store only `secret:ALIAS` or
`secret:ALIAS@ENV`. Viewing catalog metadata works while the vault is locked;
value actions need an unlocked session. Do not set global aliases to someone
else's item names or copy their alias catalog.

## Verification boundaries

`packages/secret/test.py` uses a temporary HOME and fake `bw`, never your vault.
The package build runs it automatically. It covers metadata-only catalog calls,
secret reads/writes/rename with synthetic values, stored-session handling,
Linux backend rejection and large stdout/stderr (pipe-capacity regression).
Shell integration is checked separately with fake commands. Real account login,
unlock and a user-selected catalog action require your own local verification.

### Installation receipt — 2026-10-22

The package built with Swift 6.2.4; all seven isolated Python regressions and
bash/zsh shell/completion tests passed. The first-use empty catalog was also
checked against the installed, post-fixup executable with an isolated HOME.
Existing upstream unused-result / unnecessary-var compiler warnings remain.

The integrated Home Manager generation was built and activated after explicit
user approval to include the existing unrelated changes. Before activation:

- Added/removed managed paths: none.
- Changed managed paths: `.bashrc`, `.zshrc`,
  `.config/fontconfig/conf.d/10-hm-fonts.conf`,
  `.config/systemd/user/streamdeck-studio.service`, and its
  `graphical-session.target.wants/streamdeck-studio.service` link.
- Added home-path references:
  `/nix/store/5pr0xwy123a77yw8m62jkdjfsmqirwd1-home-manager-path`,
  `/nix/store/k5yb2ci2rrq3skbk81hqwykdqnyadx0w-secret-2.0.0-unstable-2026-09-26`,
  `/nix/store/wayhqrl1x3bcsix1ha81agl88gwl210k-streamdeck-studio-0.1.0`,
  `/nix/store/ys29pc9ld623rnf0bjv60jc777cm2w55-bitwarden-cli-2026.9.1`.
- Removed/replaced home-path references:
  `/nix/store/bijpkwx21pw1kjw4f761s286dj5y8b2y-streamdeck-studio-0.1.0`,
  `/nix/store/mcxwb73cjsf32p9109dhn42qz0spkc23-home-manager-path`.

Home Manager activation succeeded, including the empty-global-config bootstrap;
the changed Stream Deck service was restarted as part of that approved generation.
No DSH restart was requested or performed. Real Bitwarden credentials were not
provided or read.

`nix flake check --no-write-lock-file` passed. The authorized NixOS dry activation
and subsequent system switch both succeeded. The installed `secret` and `bw`
commands resolve through `/etc/profiles/per-user/neolectron/bin`. The normal
user's CLI reports unauthenticated: desktop login is not CLI login. DSH's native
`secret_list` now succeeds for project metadata without retrieving any values;
existing aliases from the fork still need to resolve to items in your own vault.
No upstream account identities, personal aliases or values were imported by this
port. No flake input pins were changed by this task.
