---
name: papercuts
description: Logs workflow friction such as broken tools, misleading documentation, and missing helpers. Use when a task hits avoidable friction, then continue working.
---

# Papercuts

When a dead-end tool, wrong working directory, flaky command, or misleading
documentation slows work, record it and continue:

```bash
papercuts add "What failed and what would have prevented it" --tag tooling
```

Use a repository-local `.papercuts.jsonl` for project-specific friction. Use
`--global` for shell, editor, agent, or shared-tooling issues; it stores data
in `~/.papercuts.jsonl` for the active user. Review open items with
`papercuts list --format md`, resolve fixed items, and mark external or
intentionally out-of-scope items `unresolvable` with a reason.

Available commands: `add`, `list`, `resolve`, `unresolvable`, `clean`, and `schema`.
