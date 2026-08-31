---
name: write-a-skill
description: Creates reusable agent skills with a clear trigger description, concise instructions, and optional bundled resources. Use when the user asks to create, write, or build a skill.
---

# Write a skill

First establish the task domain, concrete triggers, required tools, and whether
deterministic work warrants scripts. Then create a `SKILL.md` with front matter:

```md
---
name: skill-name
description: States the capability and exactly when to use it.
---
```

Keep the main file focused. Put detailed or rarely used material in one-level
deep references and deterministic helpers in `scripts/`. Review the proposed
skill with the user before treating it as complete. The description must be
specific enough for an agent to select the skill without reading its body.
