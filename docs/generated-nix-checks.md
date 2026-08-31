# Generated Nix checks

Use these focused checks when a script or tool generates a Nix expression.
They separate parsing from evaluation, which makes failures easier to locate.

## Parse without evaluating

```bash
nix-instantiate --parse --expr '<nix-expression>'
```

Use this as a syntax smoke test before evaluating generated output. It is
particularly useful for a generator that emits a `.nix` file or a string of
Nix source.

## Strictly evaluate JSON-compatible data

```bash
nix-instantiate --eval --json --strict --expr '<nix-data-expression>'
```

This evaluates lists and attribute sets intended to become JSON, forcing their
contents recursively. Keep functions, derivations, paths, and string contexts
out of this check; use a target-specific evaluation for those expressions.

For the repository configuration itself, continue to use `nix flake check`.
