---
name: taste-from-sessions
description: Infers durable user coding preferences from local agent sessions and maintains a repository's AGENTS_TASTE.md. Use for an initial preference backfill or a selective update after a completed task.
argument-hint: "[repo-path]"
---

# Taste from sessions

Maintain `AGENTS_TASTE.md` with high-confidence preferences that are not already
documented in `AGENTS.md`, `CLAUDE.md`, Codex/OpenCode instructions, or project
rules. Use the current repository unless a path is supplied.

Inspect only bounded excerpts from sessions that can be unambiguously associated
with that repository. Likely local roots include `~/.codex`, `~/.config/opencode`,
and `~/.local/share/opencode`; inspect other harnesses only when clearly present.
Never scan all of `$HOME`, access credentials, use the network, or copy prompts,
source, session IDs, URLs, or personal data into taste.

Persist only explicit or repeated, durable preferences. Write one concise,
imperative bullet per rule. After a normal task, update the file only if a new
durable preference was actually communicated; otherwise make no change.
