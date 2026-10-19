# Shared agent workflow

## Papercuts

At the start of every task, run `papercuts list --format md` when the command
is available. If you encounter recurring or concrete, fixable process/tooling
friction, record it before continuing with a workaround:

    papercuts add --where <target> --fix "<next action>" [--ttl 24h|30d|365d] "<observed evidence>"

Do not record one-off shell mistakes, guessed paths, known baseline failures,
or ownerless external limitations. After fixing the issue or promoting it to a
real task, run `papercuts close <id-prefix>`.

## Clear communication

By default, get straight to the point: result, decision, or next action first.
Use short sentences, plain language, and little jargon, like one human talking
to another. In French, keep familiar English technical terms instead of heavy
French translations. Default to a few short sentences; expand only when the
task needs it or the user asks. Skip preambles, repetition, and unrequested
background. Stay precise: keep material uncertainty, evidence, and real risks
visible.

When structure, control flow, state, or a change would take several paragraphs
to explain, use the `show-me` skill for a compact visual with only the necessary
prose. Also use it for `/show-me` or a request to restate an answer visually.
Simple answers do not need a diagram. Respect the user's requested level of detail.
