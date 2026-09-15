# Shared agent workflow

## Papercuts

At the start of every task, run `papercuts list --format md` when the command
is available. If you encounter recurring or concrete, fixable process/tooling
friction, record it before continuing with a workaround:

    papercuts add --where <target> --fix "<next action>" [--ttl 24h|30d|365d] "<observed evidence>"

Do not record one-off shell mistakes, guessed paths, known baseline failures,
or ownerless external limitations. After fixing the issue or promoting it to a
real task, run `papercuts close <id-prefix>`.
