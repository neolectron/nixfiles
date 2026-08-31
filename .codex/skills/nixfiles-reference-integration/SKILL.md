---
name: nixfiles-reference-integration
description: Compare this Nixfiles repository with astahmer/nixfiles and vincent-HD/.nixfiles, report recent upstream features, or implement selected reference ideas safely. Use for weekly reference comparisons, numbered integration choices, upstream Nix configuration research, and the test-commit-push lifecycle for selected features.
---

# Nixfiles reference integration

Follow `AGENTS.md` and preserve the repository's flake/host boundaries.

## Weekly comparison

1. Keep the reference repositories read-only. Reuse or maintain mirrors only
   when their `origin` exactly matches:
   - `https://github.com/astahmer/nixfiles.git`
   - `https://github.com/vincent-HD/.nixfiles.git`
2. Fetch their default branches, then inspect commits from the prior seven
   days and the relevant text diffs. Do not run their Nix configurations.
3. Report concrete features only. Exclude lockfile churn, formatting, generated
   material, and unverified intent. Number actionable ideas sequentially across
   both repositories; include source paths, commit links, benefits, and risks.
4. Compare against concrete local paths before claiming an advantage. Do not
   recommend secrets, personal account data, hardware values, major upgrades,
   or wholesale copies.

## Selected integration

Treat a user reply containing selected numbers as authorization to implement
only those ideas.

1. Require a clean worktree and index first. If existing work is present, stop
   instead of mixing it with the feature.
2. Inspect the selected upstream code and create a narrow adaptation that fits
   this repository; do not copy machine-specific configuration.
3. Run all relevant available checks: formatting, syntax/JSON checks, focused
   Nix evaluation, and `nix flake check` where feasible. Identify any baseline
   failure separately from a change-caused failure.
4. Stage only the files changed for the feature after tests pass. Inspect the
   staged diff and whitespace errors, then make a specific Conventional Commit
   with an informative body. Never leave stale staged files.
5. Push after successful automated validation when no material manual check is
   needed. For GUI or hardware behavior, commit first and ask the user to
   confirm it works before pushing.

Report the implementation, tests, commit hash, push status, and any manual
verification requested.
