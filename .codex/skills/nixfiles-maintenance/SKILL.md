---
name: nixfiles-maintenance
description: Safely maintain this repository's frostbit NixOS host and its NixOS-integrated Home Manager setup. Use for flake-input updates, Nix warning migrations, Home Manager activation reports, NixOS rebuilds, deferred-major-update reports, or weekly system-maintenance runs.
---

# Nixfiles maintenance

Follow `AGENTS.md` first. Preserve the repository architecture: reusable flakes
remain hardware-agnostic, and host-specific values remain under `hosts/`.

## Safety gates

1. Record `git status --short` before changing anything. Do not overwrite,
   stage, or commit pre-existing work.
2. Preserve `flake.nix` input URLs, branches, and release choices. Update
   routine revisions in `flake.lock`; do not perform major-version upgrades.
3. Look up NixOS or Home Manager options before setting them. Make only clear,
   narrow rename/deprecation migrations; use leaf-level `lib.mkDefault` in
   reusable flakes.
4. Do not suppress a warning or guess an ambiguous migration. Stop and report
   it instead.

## Maintenance workflow

1. Report deferred major upgrades separately. Include only verified candidates
   and official release-note sources; distinguish current/proposed release,
   relevant breakage, and expected migration work.
2. Update compatible flake inputs, then run `nix flake check`.
3. Build the Home Manager activation package for the NixOS-integrated user;
   do not call a standalone `home-manager switch` because this repo has no
   `homeConfigurations` output:

   ```bash
   nix build --out-link "$temporary_link" \
     .#nixosConfigurations.frostbit.config.home-manager.users.neolectron.home.activationPackage
   "$temporary_link/activate"
   ```

   Before activation, compare the old and new Home Manager generations. Report
   every added managed path and added `home-path` package/store item; list
   changed and removed paths separately. Remove the temporary output link.
4. Run `nixos-rebuild dry-activate --flake .#frostbit --sudo`, then switch only
   after validation passes. Inspect both outputs for warnings.
5. Re-run the relevant checks after each maintenance fix.

## Commit and report

When the entire update, Home Manager activation, validation, and system switch
succeed, stage only this run's files. Inspect `git diff --cached` and
`git diff --cached --check`, then create a specific Conventional Commit with a
body covering inputs, fixes, Home Manager activation, and validation. Do not
push unless the request explicitly includes it.

Always report deferred major updates, input changes, Home Manager additions,
validation/switch results, warnings, commit hash, changed files, and risks.
