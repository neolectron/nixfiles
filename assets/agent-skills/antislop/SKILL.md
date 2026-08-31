---
name: antislop
description: Records code anti-patterns and their preferred replacements. Use after fixing a recurring sloppy, risky, or mechanically detectable pattern.
---

# Antislop

After correcting a clear anti-pattern, record the rule before moving on:

```bash
antislop add "Avoid X; use Y instead" --tag <area> --severity minor|major|blocker
```

Use a repository-local `.antislop.jsonl` for rules tied to that codebase. Use
`--global` for language, editor, or agent-tooling rules; it stores data in
`~/.antislop.jsonl`, relative to the active user's home directory.

Use `--pattern` and `--prescription` when the issue can later become a
deterministic linter or AST rule. Review active rules with
`antislop list --format md`; resolve or supersede a rule only after its reason
is no longer applicable.

Available commands: `add`, `list`, `resolve`, `supersede`, `clean`, and `schema`.
