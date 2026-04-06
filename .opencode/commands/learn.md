---
description: Extract patterns and learnings from the current session and save them to memory
agent: system-assistant
subtask: true
---

Analyze the current session and extract valuable learnings. For each finding, save it to persistent memory using the `memory` tool.

## What to Extract

Look through the conversation history for:

1. **Patterns discovered** — recurring solutions, architectural decisions, code patterns that worked well
2. **Mistakes made** — what went wrong, what was tried and failed, what to avoid next time
3. **Preferences expressed** — the user stated how they like things done (naming, structure, workflow)
4. **Reusable workflows** — multi-step processes that could be automated or templated
5. **Tool/integration insights** — MCP servers, skills, or tools that were useful (or missing)

## How to Save

For each finding, call:
```
memory({ mode: "add", content: "<structured finding>", tags: "<type>" })
```

Use these tag categories:
- `pattern` — a reusable solution or approach
- `mistake` — something that went wrong and how to prevent it
- `preference` — a user preference or convention
- `workflow` — a multi-step process worth remembering
- `tool-insight` — something learned about a tool, MCP, skill, or integration
- `architecture` — an architectural decision or principle

## Output Format

After saving, present a summary:

### Learnings Extracted
- **X patterns** saved
- **X mistakes** documented
- **X preferences** recorded
- **X workflows** captured
- **X tool insights** noted

### Suggestions
If any learnings suggest creating a new skill, agent, or installing an MCP server, mention it. The user can run `/evolve` to act on these suggestions.

## Important
- Be specific. "Use TypeScript" is useless. "This project uses strict TypeScript with no-any rule and barrel exports" is useful.
- Include context. "Failed approach: tried X because Y, but Z was the actual issue" is valuable.
- Don't save trivial things. Focus on insights that would save time in future sessions.
