---
name: rtk
description: Uses rtk to reduce verbose shell output from commands such as git, tests, builds, and searches. Use rtk when command output would otherwise consume significant agent context.
---

# RTK

`rtk` is installed locally through Nix and is available after the next Home
Manager activation. Prefix commands with it when their output is noisy:

```bash
rtk git status
rtk git diff
rtk nix flake check
rtk rg "pattern" .
rtk cargo test
```

Use bare shell syntax when a wrapper would change command semantics (for
example redirects, compound commands, or shell functions). This setup does not
install Cursor's command-rewrite hook, so agents must request `rtk` explicitly
when they want its output compression. `rtk gain` shows savings and
`rtk discover` identifies commands that might benefit from wrapping.
