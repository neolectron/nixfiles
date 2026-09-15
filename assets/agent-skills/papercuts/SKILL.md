---
name: papercuts
description: Short-lived action inbox for concrete, fixable workflow friction. Use only when a specific next action exists.
---

# Papercuts

Record friction only when it has an exact target and a concrete next action. A papercut is not a backlog or a diary.

```bash
papercuts add --where <target> --fix "<next action>" [--ttl 24h|3d] "<observed evidence>"
```

If the fix is not clear, do not record it. Fix it immediately, promote it to a real task, or let it disappear.

## Commands

```bash
papercuts add --where <target> --fix "<next action>" [--ttl 24h|3d] "<observed evidence>"
papercuts list [--format md|json]
papercuts close <id-prefix>
```

`close` deletes the entry. Use it after fixing the issue or after creating the real task that owns it.

## Admission

Do not record one-off shell mistakes, guessed paths, known baseline failures, or external limitations without an owner. Record tooling friction only when it recurs or has a clear repository/tooling fix.

Each entry must name:

- `where`: repository, file, command, or service
- `why`: observed failure or evidence
- `fix`: one concrete next action

## Lifecycle

- Default TTL is 3 days; maximum TTL is 7 days.
- Use a 24-hour TTL for a blocker that must be promoted quickly.
- `list`, `add`, and `close` remove expired entries automatically.
- Repeated entries are deduplicated and show an occurrence count.
- The store is machine-local at `~/.local/state/papercuts.jsonl`; it must not dirty a repository or create a JJ commit.

Each agent session may run `papercuts list --format md`; only live entries appear.
