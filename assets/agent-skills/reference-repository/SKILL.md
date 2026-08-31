---
name: reference-repository
description: Manages cloned reference repositories for pattern mining and comparison. Use when adding, refreshing, or reading a reference implementation.
---

# Reference repositories

Store shared clones in `~/.references/<name>` so they can be reused across
projects. Use `<project-root>/.references/<name>` only when the user explicitly
asks for a project-local clone. Record each repository's URL, actual path, and
project-specific reason in `reference-repos.md`.

Before reading a reference, read its root `AGENTS.md`. When an existing clone is
behind its upstream default branch, fetch and fast-forward it. Do not update a
clone that is ahead or diverged without user direction. Use targeted searches
and cite exact file locations in comparisons.
