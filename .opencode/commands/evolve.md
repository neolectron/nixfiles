---
description: Review accumulated learnings and propose new skills, agents, or config improvements
agent: system-assistant
subtask: true
---

Search through all stored memories and propose concrete improvements to the OpenCode setup.

## Step 1: Gather Evidence

Use the memory tool to search for accumulated learnings:

```
memory({ mode: "search", query: "pattern" })
memory({ mode: "search", query: "workflow" })
memory({ mode: "search", query: "mistake" })
memory({ mode: "search", query: "tool-insight" })
memory({ mode: "search", query: "preference" })
memory({ mode: "search", query: "architecture" })
```

Also check the user's profile:
```
memory({ mode: "profile" })
```

## Step 2: Cluster and Analyze

Group related memories together. Look for:

- **Repeated patterns across sessions** — if the same approach keeps coming up, it's a candidate for a skill
- **Recurring mistakes** — if the same error keeps happening, it needs a rule or a hook
- **Workflow sequences** — if 3+ steps are always done together, it's a candidate for a command
- **Missing capabilities** — if the user keeps wishing for something, it's a candidate for an MCP server or custom tool
- **Architectural preferences** — if strong preferences emerge, they should be in the architect agent's vision section

## Step 3: Generate Proposals

For each proposal, provide:

### Proposed Skills
```markdown
**Skill: <name>**
- Why: <evidence from memories>
- Trigger: <when this skill would activate>
- Draft: <3-5 line summary of what the SKILL.md would contain>
```

### Proposed Agents
```markdown
**Agent: <name>**
- Why: <evidence from memories>
- Mode: subagent | primary
- Permissions: <what tools it needs>
- Draft: <3-5 line summary of its role>
```

### Proposed MCP Servers
```markdown
**MCP: <name>**
- Why: <what capability is missing>
- Source: <npm package or URL if known>
- Config: <draft opencode.json snippet>
```

### Proposed Config Changes
```markdown
**Config: <what to change>**
- Why: <evidence from memories>
- Change: <exact JSON diff>
```

### Proposed Commands
```markdown
**Command: /<name>**
- Why: <workflow that keeps repeating>
- Agent: <which agent runs it>
- Draft: <what the command prompt would say>
```

## Step 4: Present Summary

```
## Evolution Proposals

### Ready to Implement (high confidence, strong evidence)
<list proposals with 3+ supporting memories>

### Worth Considering (moderate evidence)
<list proposals with 1-2 supporting memories>

### Speculative (weak signal, might be premature)
<list proposals based on single observations>
```

## Important
- Do NOT auto-apply anything. Present proposals only.
- Be honest about confidence. A single observation is not a pattern.
- Prefer small, focused skills over broad ones.
- Prefer existing MCP servers / community skills over building custom ones.
- Link back to the specific memories that support each proposal.
