---
name: jj
description: Gives safety rules for Jujutsu history surgery in multi-workspace repositories. Use before abandon, rebase, operation restore, or conflict cleanup.
---

# JJ history surgery

- Resolve destructive targets to a **commit ID**, never only a change ID; divergent
  change IDs can select an unexpected copy.
- Before restructuring, save the current operation ID with `jj op log -n 1`.
  `jj op restore <id>` restores the state after that operation.
- Work with one writer per workspace. Cross-workspace changes can leave stale
  working copies; re-materialize them with `jj new <tip>`.
- Re-check tree equality after each rewrite with `jj diff --from <new> --to <old> --stat`.

Check conflicts by explicit commit ranges, because hidden commits can make revset
algebra look clean:

```bash
jj log -r '<range>' --no-graph -T 'if(conflict,"C",".\\n")' | grep -c '^C$'
```

Fix conflicts oldest-first. For each candidate to abandon, first confirm it is
not an ancestor of the kept head: `jj log -r '<candidate> & ::<head>' --no-graph`.
Do not pass shell-like paths containing `$` directly to Jujutsu file-set commands.
